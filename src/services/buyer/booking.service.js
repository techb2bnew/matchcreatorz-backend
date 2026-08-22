'use strict';
const { Op }                          = require('sequelize');
const { sequelize, Booking, BookingMilestone, BookingWorkEntry, User, Service, Job, Review } = require('../../models');
const notify                          = require('../../helpers/notification.helper');
const wallet                          = require('../wallet/wallet.service');
const { computeFee }                  = require('../../config/fee');
const { settleWorkEntry }             = require('../shared/workEntry.service');
const { settleMilestone }             = require('../shared/milestone.service');

// The platform's fee is parked in the primary admin's wallet so the admin wallet
// reflects real platform revenue. Cached after first lookup.
let _platformAdminId;
const platformAdminId = async () => {
  if (_platformAdminId !== undefined) return _platformAdminId;
  const admin = await User.findOne({ where: { role: 'ADMIN' }, order: [['id', 'ASC']], attributes: ['id'] });
  _platformAdminId = admin ? admin.id : null;
  return _platformAdminId;
};

const INCLUDE = [
  { model: User,    as: 'buyer',   attributes: ['id', 'name'] },
  { model: User,    as: 'seller',  attributes: ['id', 'name'] },
  { model: Service, as: 'service', attributes: ['id', 'title', 'images'], required: false },
  { model: Job,     as: 'job',     attributes: ['id', 'title'],           required: false },
  { model: BookingMilestone, as: 'milestones', required: false, separate: true, order: [['position', 'ASC']] },
  { model: BookingWorkEntry, as: 'workEntries', required: false, separate: true, order: [['work_date', 'DESC']] },
  // Lets the frontend know a booking is already reviewed without relying on
  // session-local state (which resets on reload and can't tell truth from guess).
  { model: Review, as: 'review', attributes: ['id', 'rating'], required: false },
];

const STATUS_MAP = {
  active:    ['pending', 'ongoing', 'amidst_completion', 'in_dispute'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

exports.listBookings = async (buyerId, { tab = 'active', page = 1, limit = 20 }) => {
  const statuses = STATUS_MAP[tab] || STATUS_MAP.active;
  const offset   = (Number(page) - 1) * Number(limit);

  const { count, rows } = await Booking.findAndCountAll({
    where:    { buyer_id: buyerId, status: { [Op.in]: statuses } },
    include:  INCLUDE,
    order:    [['created_at', 'DESC']],
    limit:    Number(limit),
    offset,
    distinct: true,
  });

  return { data: rows, total: count, page: Number(page), limit: Number(limit) };
};

exports.getBooking = async (buyerId, id) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId }, include: INCLUDE });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  return booking;
};

exports.createBooking = async (buyerId, { service_id, job_id, notes }) => {
  // A direct booking must reference a real, active service. Seller, title, amount
  // and delivery are all derived server-side from the service — never trusted from the client.
  if (!service_id)
    throw Object.assign(new Error('service_id is required to create a booking'), { status: 400 });

  const service = await Service.findByPk(Number(service_id), {
    attributes: ['id', 'seller_id', 'title', 'price', 'delivery_days', 'status'],
  });
  if (!service)
    throw Object.assign(new Error('Service not found'), { status: 404 });
  if (service.status !== 'active')
    throw Object.assign(new Error('This service is not available for booking'), { status: 400 });
  if (service.seller_id === buyerId)
    throw Object.assign(new Error('You cannot book your own service'), { status: 400 });

  const amount = Number(service.price);
  const fee    = computeFee(amount);

  // No wallet charge here — payment is deferred until the seller actually
  // submits work (see submitWork). payment_status stays 'unpaid' until then.
  const booking = await Booking.create({
    buyer_id:      buyerId,
    seller_id:     service.seller_id,
    service_id:    service.id,
    job_id:        job_id || null,
    title:         service.title,
    amount,
    platform_fee:  fee,
    delivery_days: service.delivery_days || null,
    notes:         notes || null,
    status:        'pending',
  });
  // Notify seller of new booking
  const seller = await User.findByPk(service.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.bookingCreated(seller, booking);

  // Bump the service order counter
  await Service.increment('orders_count', { by: 1, where: { id: service.id } }).catch(() => {});

  return booking;
};

exports.acceptWork = async (buyerId, id) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.status !== 'amidst_completion')
    throw Object.assign(new Error('Booking is not awaiting acceptance'), { status: 400 });

  const milestoneCount = await BookingMilestone.count({ where: { booking_id: booking.id } });
  if (milestoneCount > 0)
    throw Object.assign(new Error('This booking uses milestones — accept each milestone individually'), { status: 400 });

  // Charge the buyer right now, then immediately release to the seller — both
  // in one transaction so a failed charge (insufficient balance) rolls back
  // cleanly and the buyer can just try Accept again after adding funds.
  // `wasHeld` covers legacy bookings from before this flow existed, where the
  // full amount was already collected up front — don't charge those again.
  const amount  = Number(booking.amount);
  const fee     = Number(booking.platform_fee);
  const earning = wallet.round2(amount - fee);
  const adminId = await platformAdminId();
  const wasHeld = booking.payment_status === 'held';

  await sequelize.transaction(async (t) => {
    if (!wasHeld) {
      await wallet.debit(buyerId, amount, {
        type: 'booking_payment', booking_id: booking.id,
        note: `Payment for booking #${booking.id} — ${booking.title}`,
      }, t);
    }
    await booking.update({ status: 'completed', payment_status: 'released' }, { transaction: t });
    await wallet.credit(booking.seller_id, earning, {
      type: 'earning', booking_id: booking.id,
      note: `Earning from booking #${booking.id} — ${booking.title}`,
    }, t);
    if (adminId && fee > 0) {
      await wallet.credit(adminId, fee, {
        type: 'platform_fee', booking_id: booking.id,
        note: `Platform fee from booking #${booking.id}`,
      }, t);
    }
    if (booking.job_id) {
      await Job.update({ status: 'COMPLETED' }, { where: { id: booking.job_id }, transaction: t });
    }
  });

  // Notify seller work was accepted
  const seller = await User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.workAccepted(seller, booking);
  return booking;
};

exports.rejectWork = async (buyerId, id, dispute_reason) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.status !== 'amidst_completion')
    throw Object.assign(new Error('Booking is not awaiting acceptance'), { status: 400 });

  await booking.update({ status: 'in_dispute', dispute_reason: dispute_reason || null });
  // Notify seller dispute was raised, and admin so it can be resolved
  const [seller, buyer] = await Promise.all([
    User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] }),
    User.findByPk(buyerId, { attributes: ['name'] }),
  ]);
  if (seller) notify.disputeRaised(seller, booking);
  notify.disputeRaisedAdmin(buyer && buyer.name, booking);
  return booking;
};

// ── Hourly work entries ──────────────────────────────────────────────────
exports.approveWorkEntry = async (buyerId, id, entryId) => {
  try {
    return await sequelize.transaction(async (t) => {
      const booking = await Booking.findOne({
        where: { id, buyer_id: buyerId }, lock: t.LOCK.UPDATE, transaction: t,
      });
      if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

      const entry = await BookingWorkEntry.findOne({
        where: { id: entryId, booking_id: booking.id }, lock: t.LOCK.UPDATE, transaction: t,
      });
      if (!entry) throw Object.assign(new Error('Work entry not found'), { status: 404 });

      // Approve either the original logged hours (nothing countered yet), or
      // the seller's counter-back (buyer countered, seller proposed a
      // different number, buyer now agrees to that number).
      let settleHours;
      if (entry.status === 'pending') settleHours = Number(entry.hours);
      else if (entry.status === 'countered' && entry.counter_by === 'seller') settleHours = Number(entry.counter_hours);
      else throw Object.assign(new Error(`Entry is already ${entry.status}`), { status: 400 });

      return settleWorkEntry(booking, entry, { hours: settleHours, t });
    });
  } catch (err) {
    // The row-lock above already prevents a genuine concurrent double-approve
    // (the second request blocks, then sees status !== 'pending' above) — this
    // is the DB-level backstop for any path that doesn't share that lock.
    if (err.name === 'SequelizeUniqueConstraintError')
      throw Object.assign(new Error('This entry was already processed'), { status: 409 });
    throw err;
  }
};

// Buyer proposes paying for fewer hours than the seller logged (e.g. logged
// 5h, buyer will only pay for 3h) — mirrors the Bid counter-offer pattern
// (job.controller.js:counterBid): plain field overwrite, no transaction
// needed since nothing is settled yet.
exports.counterWorkEntry = async (buyerId, id, entryId, { counter_hours, counter_note } = {}) => {
  const hours = Number(counter_hours);
  if (!hours || hours <= 0)
    throw Object.assign(new Error('A valid counter hours value is required'), { status: 400 });

  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

  const entry = await BookingWorkEntry.findOne({ where: { id: entryId, booking_id: booking.id } });
  if (!entry) throw Object.assign(new Error('Work entry not found'), { status: 404 });
  // Buyer can counter the original submission, or re-counter after the
  // seller counters back — but not while the buyer's own counter is still
  // awaiting the seller's response.
  const canCounter = entry.status === 'pending' || (entry.status === 'countered' && entry.counter_by === 'seller');
  if (!canCounter)
    throw Object.assign(new Error(`Entry is already ${entry.status}`), { status: 400 });
  if (hours > Number(entry.hours))
    throw Object.assign(new Error('Counter hours cannot exceed the hours logged'), { status: 400 });

  await entry.update({
    status: 'countered', counter_hours: hours, counter_by: 'buyer', counter_note: counter_note || null,
  });

  const seller = await User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.workEntryCountered(seller, booking, entry, 'buyer');
  return entry;
};

exports.disputeWorkEntry = async (buyerId, id, entryId, dispute_reason) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

  const entry = await BookingWorkEntry.findOne({ where: { id: entryId, booking_id: booking.id } });
  if (!entry) throw Object.assign(new Error('Work entry not found'), { status: 404 });
  if (!['pending', 'countered'].includes(entry.status))
    throw Object.assign(new Error(`Entry is already ${entry.status}`), { status: 400 });

  // Only this entry goes into dispute — Booking.status is untouched, since
  // other entries on the same contract are unaffected.
  await entry.update({ status: 'disputed', dispute_reason: dispute_reason || null });

  const [seller, buyer] = await Promise.all([
    User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] }),
    User.findByPk(buyerId, { attributes: ['name'] }),
  ]);
  if (seller) notify.disputeRaised(seller, booking);
  notify.disputeRaisedAdmin(buyer && buyer.name, booking);
  return entry;
};

// ── Milestones ────────────────────────────────────────────────────────────
exports.acceptMilestone = async (buyerId, id, milestoneId) => {
  try {
    return await sequelize.transaction(async (t) => {
      const booking = await Booking.findOne({
        where: { id, buyer_id: buyerId }, lock: t.LOCK.UPDATE, transaction: t,
      });
      if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

      const milestone = await BookingMilestone.findOne({
        where: { id: milestoneId, booking_id: booking.id }, lock: t.LOCK.UPDATE, transaction: t,
      });
      if (!milestone) throw Object.assign(new Error('Milestone not found'), { status: 404 });

      // Approve either the original submitted amount (nothing countered yet),
      // or the seller's counter-back (buyer countered, seller proposed a
      // different amount, buyer now agrees to that amount).
      let settleAmount;
      if (milestone.status === 'submitted') settleAmount = Number(milestone.amount);
      else if (milestone.status === 'countered' && milestone.counter_by === 'seller') settleAmount = Number(milestone.counter_amount);
      else throw Object.assign(new Error(`Milestone is already ${milestone.status}`), { status: 400 });

      return settleMilestone(booking, milestone, { amount: settleAmount, t });
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      throw Object.assign(new Error('This milestone was already processed'), { status: 409 });
    throw err;
  }
};

// Buyer proposes paying less than the submitted milestone amount (e.g.
// submitted at $150, buyer will only pay $100) — mirrors counterWorkEntry.
exports.counterMilestone = async (buyerId, id, milestoneId, { counter_amount, counter_note } = {}) => {
  const amount = Number(counter_amount);
  if (!amount || amount <= 0)
    throw Object.assign(new Error('A valid counter amount is required'), { status: 400 });

  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

  const milestone = await BookingMilestone.findOne({ where: { id: milestoneId, booking_id: booking.id } });
  if (!milestone) throw Object.assign(new Error('Milestone not found'), { status: 404 });
  // Buyer can counter the original submission, or re-counter after the
  // seller counters back — but not while the buyer's own counter is still
  // awaiting the seller's response.
  const canCounter = milestone.status === 'submitted' || (milestone.status === 'countered' && milestone.counter_by === 'seller');
  if (!canCounter)
    throw Object.assign(new Error(`Milestone is already ${milestone.status}`), { status: 400 });
  if (amount > Number(milestone.amount))
    throw Object.assign(new Error('Counter amount cannot exceed the submitted amount'), { status: 400 });

  await milestone.update({
    status: 'countered', counter_amount: amount, counter_by: 'buyer', counter_note: counter_note || null,
  });

  const seller = await User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.milestoneCountered(seller, booking, milestone, 'buyer');
  return milestone;
};

exports.rejectMilestone = async (buyerId, id, milestoneId, dispute_reason) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

  const milestone = await BookingMilestone.findOne({ where: { id: milestoneId, booking_id: booking.id } });
  if (!milestone) throw Object.assign(new Error('Milestone not found'), { status: 404 });
  if (!['submitted', 'countered'].includes(milestone.status))
    throw Object.assign(new Error('Milestone is not awaiting acceptance'), { status: 400 });

  await milestone.update({ status: 'rejected', dispute_reason: dispute_reason || null });

  const [seller, buyer] = await Promise.all([
    User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] }),
    User.findByPk(buyerId, { attributes: ['name'] }),
  ]);
  if (seller) notify.disputeRaised(seller, booking);
  notify.disputeRaisedAdmin(buyer && buyer.name, booking);
  return milestone;
};

exports.cancelBooking = async (buyerId, id, cancel_reason) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (!['pending', 'ongoing'].includes(booking.status))
    throw Object.assign(new Error('Cannot cancel booking at this stage'), { status: 400 });

  // Refund the held escrow back to the buyer's wallet.
  await sequelize.transaction(async (t) => {
    const wasHeld = booking.payment_status === 'held';
    await booking.update({
      status: 'cancelled',
      cancel_reason: cancel_reason || null,
      payment_status: wasHeld ? 'refunded' : booking.payment_status,
    }, { transaction: t });
    if (wasHeld) {
      await wallet.credit(booking.buyer_id, Number(booking.amount), {
        type: 'booking_refund', booking_id: booking.id,
        note: `Refund for cancelled booking #${booking.id}`,
      }, t);
    }
  });

  // Notify seller booking was cancelled by buyer
  const seller = await User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.bookingCancelledByBuyer(seller, booking);
  return booking;
};
