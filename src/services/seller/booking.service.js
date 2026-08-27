'use strict';
const { Op }                          = require('sequelize');
const { sequelize, Booking, BookingMilestone, BookingWorkEntry, User, Service, Job } = require('../../models');
const notify                          = require('../../helpers/notification.helper');
const wallet                          = require('../wallet/wallet.service');
const { computeFee }                  = require('../../config/fee');
const { settleWorkEntry }             = require('../shared/workEntry.service');
const { settleMilestone }             = require('../shared/milestone.service');
const escrow                          = require('../shared/escrow.service');

const INCLUDE = [
  { model: User,    as: 'buyer',   attributes: ['id', 'name'] },
  { model: User,    as: 'seller',  attributes: ['id', 'name'] },
  { model: Service, as: 'service', attributes: ['id', 'title', 'images'], required: false },
  { model: Job,     as: 'job',     attributes: ['id', 'title'],           required: false },
  { model: BookingMilestone, as: 'milestones', required: false, separate: true, order: [['position', 'ASC']] },
  { model: BookingWorkEntry, as: 'workEntries', required: false, separate: true, order: [['work_date', 'DESC']] },
];

// Monday–Sunday window containing `date` (plain Date math — same style
// already used in wallet.service.js:listTransactions / admin/booking.controller.js).
const weekWindow = (date) => {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diffToMonday);
  const end   = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
};

const STATUS_MAP = {
  active:    ['pending', 'ongoing', 'amidst_completion', 'in_dispute'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

exports.listBookings = async (sellerId, { tab = 'active', page = 1, limit = 20 }) => {
  const statuses = STATUS_MAP[tab] || STATUS_MAP.active;
  const offset   = (Number(page) - 1) * Number(limit);

  const { count, rows } = await Booking.findAndCountAll({
    where:    { seller_id: sellerId, status: { [Op.in]: statuses } },
    include:  INCLUDE,
    order:    [['created_at', 'DESC']],
    limit:    Number(limit),
    offset,
    distinct: true,
  });

  return { data: rows, total: count, page: Number(page), limit: Number(limit) };
};

exports.getBooking = async (sellerId, id) => {
  const booking = await Booking.findOne({ where: { id, seller_id: sellerId }, include: INCLUDE });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  return booking;
};

exports.acceptOrder = async (sellerId, id) => {
  const booking = await Booking.findOne({ where: { id, seller_id: sellerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.status !== 'pending')
    throw Object.assign(new Error('Booking is not pending'), { status: 400 });

  await booking.update({ status: 'ongoing' });
  // Notify buyer that seller accepted
  const buyer = await User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (buyer) notify.bookingAccepted(buyer, booking);
  return booking;
};

exports.submitWork = async (sellerId, id, { attachments, notes, delivery_days } = {}) => {
  const booking = await Booking.findOne({ where: { id, seller_id: sellerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.job_type === 'hourly')
    throw Object.assign(new Error('Hourly bookings submit per-day work entries — use POST /bookings/:id/work-entries instead'), { status: 400 });
  if (!['ongoing', 'in_dispute'].includes(booking.status))
    throw Object.assign(new Error('Booking must be ongoing or in dispute to submit work'), { status: 400 });

  const milestoneCount = await BookingMilestone.count({ where: { booking_id: booking.id } });
  if (milestoneCount > 0)
    throw Object.assign(new Error('This booking uses milestones — submit each milestone individually'), { status: 400 });

  const patch = {
    status: 'amidst_completion',
    attachments: Array.isArray(attachments) ? attachments : booking.attachments,
    submission_notes: notes || booking.submission_notes,
    delivery_days: delivery_days ? Math.max(1, Math.round(Number(delivery_days))) : booking.delivery_days,
  };

  // No wallet charge here — the buyer is only charged (and the escrow released
  // to the seller, in one step) when they click Accept.
  await booking.update(patch);
  // Notify buyer that work has been (re)submitted for review
  const buyer = await User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (buyer) notify.workSubmitted(buyer, booking);
  return booking;
};

// ── Hourly work entries ──────────────────────────────────────────────────
// A seller logs one dated entry at a time (date + description + hours)
// against an hourly booking. Payment is never touched here — only on the
// buyer's approve, the seller's accept-counter, or an admin's dispute
// resolution (all three route through services/shared/workEntry.service.js).
exports.submitWorkEntry = async (sellerId, id, { work_date, description, hours, attachments } = {}) => {
  const h = Number(hours);
  if (!work_date) throw Object.assign(new Error('work_date is required'), { status: 400 });
  if (!h || h <= 0) throw Object.assign(new Error('hours must be a positive number'), { status: 400 });

  return sequelize.transaction(async (t) => {
    // Row-lock the booking for the duration of the weekly-limit check + entry
    // insert, so two concurrent submissions for the same booking can't both
    // read a stale weekly sum and both pass the limit check.
    const booking = await Booking.findOne({
      where: { id, seller_id: sellerId }, lock: t.LOCK.UPDATE, transaction: t,
    });
    if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
    if (booking.job_type !== 'hourly')
      throw Object.assign(new Error('This booking is not hourly'), { status: 400 });
    if (!['ongoing', 'in_dispute'].includes(booking.status))
      throw Object.assign(new Error('Booking must be ongoing or in dispute to log work'), { status: 400 });
    if (booking.hourly_rate == null)
      throw Object.assign(new Error('This contract has no hourly rate set — contact support'), { status: 400 });

    if (booking.weekly_hour_limit != null) {
      const { start, end } = weekWindow(work_date);
      const sum = await BookingWorkEntry.sum('hours', {
        where: {
          booking_id: booking.id,
          work_date: { [Op.gte]: start, [Op.lt]: end },
          status: { [Op.in]: ['pending', 'countered', 'approved', 'disputed'] },
        },
        transaction: t,
      }) || 0;
      if (Number(sum) + h > Number(booking.weekly_hour_limit))
        throw Object.assign(new Error(
          `This would exceed the weekly limit of ${booking.weekly_hour_limit}h (already logged ${sum}h this week)`
        ), { status: 400 });
    }

    const rate   = Number(booking.hourly_rate);
    const amount = wallet.round2(h * rate);

    const entry = await BookingWorkEntry.create({
      booking_id:  booking.id,
      work_date,
      description: description || null,
      hours:       h,
      rate,
      amount,
      platform_fee: computeFee(amount),
      status:      'pending',
      attachments: Array.isArray(attachments) ? attachments : [],
      submitted_at: new Date(),
    }, { transaction: t });

    return entry;
  }).then(async (entry) => {
    const booking = await Booking.findByPk(entry.booking_id);
    const buyer = await User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
    if (buyer) notify.workEntrySubmitted(buyer, booking, entry);
    return entry;
  });
};

// Seller accepts the buyer's counter (they logged 5h, buyer offered to pay
// for 3h, seller agrees) — settles at the countered hours.
exports.acceptWorkEntryCounter = async (sellerId, id, entryId) => {
  return sequelize.transaction(async (t) => {
    const booking = await Booking.findOne({
      where: { id, seller_id: sellerId }, lock: t.LOCK.UPDATE, transaction: t,
    });
    if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

    const entry = await BookingWorkEntry.findOne({
      where: { id: entryId, booking_id: booking.id }, lock: t.LOCK.UPDATE, transaction: t,
    });
    if (!entry) throw Object.assign(new Error('Work entry not found'), { status: 404 });
    if (entry.status !== 'countered' || entry.counter_by !== 'buyer')
      throw Object.assign(new Error('There is no buyer counter to accept on this entry'), { status: 400 });

    await settleWorkEntry(booking, entry, { hours: Number(entry.counter_hours), t });
    return entry;
  });
};

// Seller re-counters the buyer's counter (buyer offered 3h, seller proposes
// 5h instead) — same negotiation pattern as the Bid counter-offer flow
// (job.controller.js:counterBid/counterBidBySeller): plain field overwrite,
// ball moves back to the buyer, who can then approve at the new counter_hours
// or counter again themselves.
exports.counterWorkEntryBySeller = async (sellerId, id, entryId, { counter_hours, counter_note } = {}) => {
  const hours = Number(counter_hours);
  if (!hours || hours <= 0)
    throw Object.assign(new Error('A valid counter hours value is required'), { status: 400 });

  const booking = await Booking.findOne({ where: { id, seller_id: sellerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

  const entry = await BookingWorkEntry.findOne({ where: { id: entryId, booking_id: booking.id } });
  if (!entry) throw Object.assign(new Error('Work entry not found'), { status: 404 });
  if (entry.status !== 'countered' || entry.counter_by !== 'buyer')
    throw Object.assign(new Error('There is no buyer counter to respond to on this entry'), { status: 400 });
  if (hours > Number(entry.hours))
    throw Object.assign(new Error('Counter hours cannot exceed the hours logged'), { status: 400 });

  await entry.update({ counter_hours: hours, counter_by: 'seller', counter_note: counter_note || null });

  const buyer = await User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (buyer) notify.workEntryCountered(buyer, booking, entry, 'seller');
  return entry;
};

// ── Milestones ────────────────────────────────────────────────────────────
// Seller optionally splits a booking's total amount into stages, once work
// has started. Each stage is submitted (with proof-of-work) and approved
// independently — payout for a stage releases as soon as it's accepted,
// instead of waiting for the entire booking to finish.
exports.createMilestones = async (sellerId, id, milestones) => {
  const booking = await Booking.findOne({ where: { id, seller_id: sellerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (!['ongoing', 'in_dispute'].includes(booking.status))
    throw Object.assign(new Error('Booking must be ongoing to set up milestones'), { status: 400 });
  if (booking.job_type === 'hourly')
    throw Object.assign(new Error('Hourly bookings don\'t support milestones — submit hours as a single delivery'), { status: 400 });

  const existing = await BookingMilestone.count({ where: { booking_id: booking.id } });
  if (existing > 0)
    throw Object.assign(new Error('Milestones are already set up for this booking'), { status: 400 });

  // Escrow: a whole-booking hold may already have been placed at commitment
  // time (before the seller decided to split into milestones). Payment now
  // happens per-milestone instead, so release that hold before proceeding.
  if (booking.payment_mode === 'escrow' && booking.payment_status === 'held') {
    await escrow.cancelHold(booking);
    await booking.update({ payment_status: 'unpaid' });
  }

  if (!Array.isArray(milestones) || milestones.length < 2)
    throw Object.assign(new Error('Provide at least 2 milestones'), { status: 400 });

  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const clean = milestones.map((m, i) => ({
    title: String(m.title || '').trim() || `Milestone ${i + 1}`,
    amount: round2(m.amount),
    duration_days: m.duration_days ? Math.max(1, Math.round(Number(m.duration_days))) : null,
    position: i,
  }));
  if (clean.some((m) => !m.amount || m.amount <= 0))
    throw Object.assign(new Error('Every milestone needs a positive amount'), { status: 400 });

  const sum = round2(clean.reduce((s, m) => s + m.amount, 0));
  if (sum !== round2(booking.amount))
    throw Object.assign(new Error(`Milestone amounts must add up to the booking total (${booking.amount})`), { status: 400 });

  const rows = await BookingMilestone.bulkCreate(
    clean.map((m) => ({ ...m, booking_id: booking.id })),
  );

  const buyer = await User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (buyer) notify.workSubmitted(buyer, booking); // reuse: "seller updated this booking" ping

  return rows;
};

exports.submitMilestone = async (sellerId, id, milestoneId, { attachments, notes, duration_days } = {}) => {
  const booking = await Booking.findOne({ where: { id, seller_id: sellerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

  const milestone = await BookingMilestone.findOne({ where: { id: milestoneId, booking_id: booking.id } });
  if (!milestone) throw Object.assign(new Error('Milestone not found'), { status: 404 });
  if (!['pending', 'rejected'].includes(milestone.status))
    throw Object.assign(new Error(`Milestone is already ${milestone.status}`), { status: 400 });

  // No wallet charge here — the buyer is only charged (and this stage's
  // escrow released to the seller, in one step) when they accept it.
  await milestone.update({
    status: 'submitted',
    attachments: Array.isArray(attachments) ? attachments : milestone.attachments,
    notes: notes || milestone.notes,
    duration_days: duration_days ? Math.max(1, Math.round(Number(duration_days))) : milestone.duration_days,
    dispute_reason: null,
    submitted_at: new Date(),
  });

  const buyer = await User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (buyer) notify.workSubmitted(buyer, booking);
  return milestone;
};

// Seller accepts the buyer's counter (submitted at $150, buyer offered $100,
// seller agrees) — settles at the countered amount.
exports.acceptMilestoneCounterBySeller = async (sellerId, id, milestoneId) => {
  // Escrow diversion: the seller agreeing to the buyer's counter can't itself
  // charge the buyer's card (no buyer browser session to redirect here). Fold
  // the counter into the milestone's own amount and hand it back to 'submitted'
  // so the buyer's normal Accept & Pay flow (acceptMilestone) picks it up and
  // creates the Stripe Checkout. Wallet mode is untouched below.
  const preBooking = await Booking.findOne({ where: { id, seller_id: sellerId } });
  if (preBooking && preBooking.payment_mode === 'escrow') {
    const milestone = await BookingMilestone.findOne({ where: { id: milestoneId, booking_id: preBooking.id } });
    if (!milestone) throw Object.assign(new Error('Milestone not found'), { status: 404 });
    if (milestone.status !== 'countered' || milestone.counter_by !== 'buyer')
      throw Object.assign(new Error('There is no buyer counter to accept on this milestone'), { status: 400 });

    await milestone.update({
      amount: Number(milestone.counter_amount),
      status: 'submitted',
      counter_amount: null, counter_by: null, counter_note: null,
    });

    const buyer = await User.findByPk(preBooking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
    if (buyer) notify.workSubmitted(buyer, preBooking); // reuse: "please review/pay" ping
    return milestone;
  }

  try {
    return await sequelize.transaction(async (t) => {
      const booking = await Booking.findOne({
        where: { id, seller_id: sellerId }, lock: t.LOCK.UPDATE, transaction: t,
      });
      if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

      const milestone = await BookingMilestone.findOne({
        where: { id: milestoneId, booking_id: booking.id }, lock: t.LOCK.UPDATE, transaction: t,
      });
      if (!milestone) throw Object.assign(new Error('Milestone not found'), { status: 404 });
      if (milestone.status !== 'countered' || milestone.counter_by !== 'buyer')
        throw Object.assign(new Error('There is no buyer counter to accept on this milestone'), { status: 400 });

      return settleMilestone(booking, milestone, { amount: Number(milestone.counter_amount), t });
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      throw Object.assign(new Error('This milestone was already processed'), { status: 409 });
    throw err;
  }
};

// Seller re-counters the buyer's counter (buyer offered $100, seller proposes
// $125 instead) — same negotiation pattern as counterWorkEntryBySeller: plain
// field overwrite, ball moves back to the buyer.
exports.counterMilestoneBySeller = async (sellerId, id, milestoneId, { counter_amount, counter_note } = {}) => {
  const amount = Number(counter_amount);
  if (!amount || amount <= 0)
    throw Object.assign(new Error('A valid counter amount is required'), { status: 400 });

  const booking = await Booking.findOne({ where: { id, seller_id: sellerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

  const milestone = await BookingMilestone.findOne({ where: { id: milestoneId, booking_id: booking.id } });
  if (!milestone) throw Object.assign(new Error('Milestone not found'), { status: 404 });
  if (milestone.status !== 'countered' || milestone.counter_by !== 'buyer')
    throw Object.assign(new Error('There is no buyer counter to respond to on this milestone'), { status: 400 });
  if (amount > Number(milestone.amount))
    throw Object.assign(new Error('Counter amount cannot exceed the submitted amount'), { status: 400 });

  await milestone.update({ counter_amount: amount, counter_by: 'seller', counter_note: counter_note || null });

  const buyer = await User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (buyer) notify.milestoneCountered(buyer, booking, milestone, 'seller');
  return milestone;
};

exports.cancelBooking = async (sellerId, id, cancel_reason) => {
  const booking = await Booking.findOne({ where: { id, seller_id: sellerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  // 'ongoing' is included because bid/offer-sourced bookings now skip 'pending'
  // entirely — without this the seller would have no way to back out at all.
  if (!['pending', 'ongoing'].includes(booking.status))
    throw Object.assign(new Error('Cannot cancel booking at this stage'), { status: 400 });

  // Refund the held escrow back to the buyer.
  const wasHeld = booking.payment_status === 'held';
  const isEscrow = booking.payment_mode === 'escrow';

  // Escrow: release the Stripe hold BEFORE opening the DB transaction — a
  // Stripe network call must never happen while holding row locks.
  if (wasHeld && isEscrow) {
    await escrow.cancelHold(booking);
  }

  await sequelize.transaction(async (t) => {
    await booking.update({
      status: 'cancelled',
      cancel_reason: cancel_reason || null,
      payment_status: wasHeld ? 'refunded' : booking.payment_status,
    }, { transaction: t });
    if (wasHeld && !isEscrow) {
      await wallet.credit(booking.buyer_id, Number(booking.amount), {
        type: 'booking_refund', booking_id: booking.id,
        note: `Refund for booking #${booking.id} cancelled by seller`,
      }, t);
    }
  });

  // Notify buyer that seller cancelled
  const buyer = await User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (buyer) notify.bookingCancelledBySeller(buyer, booking);
  return booking;
};
