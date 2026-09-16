'use strict';
const { Op }                          = require('sequelize');
const { sequelize, Booking, BookingMilestone, BookingWorkEntry, User, Service, Job, Review } = require('../../models');
const notify                          = require('../../helpers/notification.helper');
const wallet                          = require('../wallet/wallet.service');
const { computeFee }                  = require('../../config/fee');
const { settleWorkEntry }             = require('../shared/workEntry.service');
const { settleMilestone, createMilestones: createMilestonesShared } = require('../shared/milestone.service');
const { settleBooking }               = require('../shared/booking.service');
const escrow                          = require('../shared/escrow.service');
const stripeHelper                    = require('../../helpers/stripe.helper');

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
  const fee    = await computeFee(amount);

  const payment_mode = await escrow.resolvePaymentMode();

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
    payment_mode,
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

// (Re)creates a Checkout Session for an escrow-mode, still-unpaid booking's
// whole-booking hold. Serves both the initial post-accept redirect and a
// retry after the buyer abandons the first attempt.
exports.createEscrowCheckout = async (buyerId, id) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.payment_mode !== 'escrow')
    throw Object.assign(new Error('This booking is not in escrow mode'), { status: 400 });
  if (booking.payment_status !== 'unpaid')
    throw Object.assign(new Error('This booking has already been paid'), { status: 400 });

  const session = await escrow.createHoldCheckout(booking);
  return { client_secret: session.clientSecret, session_id: session.id };
};

// Confirm a session by id — return-fallback if the webhook is slow (mirrors
// wallet/topup.service.js:confirmTopup). Every escrow checkout (whole
// booking, a milestone, or a work entry — hold or direct charge) redirects
// back through this SAME generic route, so it must dispatch by
// session.metadata.kind exactly like the webhook does in wallet.controller.js
// — treating every session as a whole-booking hold (the previous behavior)
// meant a milestone/entry checkout's return-page confirm could wrongly stamp
// a second, bogus whole-booking-amount hold onto the booking itself.
exports.confirmEscrowCheckout = async (buyerId, id, sessionId) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

  const session = await stripeHelper.getCheckoutSession(sessionId);
  switch (session.metadata?.kind) {
    case 'escrow_hold': {
      const full = await stripeHelper.getCheckoutSessionWithIntent(sessionId);
      return escrow.confirmHold(full);
    }
    case 'escrow_booking_charge':
      return escrow.confirmBookingCharge(session);
    case 'escrow_milestone_hold': {
      const full = await stripeHelper.getCheckoutSessionWithIntent(sessionId);
      return escrow.confirmMilestoneHold(full);
    }
    case 'escrow_milestone_charge':
      return escrow.confirmMilestoneCharge(session);
    case 'escrow_entry_hold': {
      const full = await stripeHelper.getCheckoutSessionWithIntent(sessionId);
      return escrow.confirmWorkEntryHold(full);
    }
    case 'escrow_entry_charge':
      return escrow.confirmWorkEntryCharge(session);
    default:
      return { confirmed: false, reason: 'missing_metadata' };
  }
};

exports.acceptWork = async (buyerId, id, paymentType) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.status !== 'amidst_completion')
    throw Object.assign(new Error('Booking is not awaiting acceptance'), { status: 400 });

  const milestoneCount = await BookingMilestone.count({ where: { booking_id: booking.id } });
  if (milestoneCount > 0)
    throw Object.assign(new Error('This booking uses milestones — accept each milestone individually'), { status: 400 });

  if (booking.payment_mode === 'escrow') {
    // First click (nothing paid or held yet) — the buyer picks how to pay
    // right now, not back when the booking was created. Whatever they choose
    // is persisted, since a 'hold' choice needs a second click later to
    // capture + release it.
    if (booking.payment_status === 'unpaid') {
      // "Pay & Hold" only exists while the admin's Delayed Payments toggle is
      // on — enforced here too (not just hidden in the UI), so a stale
      // client can never force a hold once it's been turned off.
      const type = (paymentType === 'hold' && await escrow.isEscrowEnabled()) ? 'hold' : 'direct';
      if (booking.payment_type !== type) await booking.update({ payment_type: type });

      if (type === 'hold') {
        const session = await escrow.createHoldCheckout(booking);
        return { escrow: true, client_secret: session.clientSecret, session_id: session.id };
      }
      // 'direct' — a single real charge, released the moment it's paid.
      const session = await escrow.createBookingChargeCheckout(booking);
      return { escrow: true, client_secret: session.clientSecret, session_id: session.id };
    }

    if (booking.payment_type === 'hold' && booking.payment_status === 'held') {
      // Second click, mirrors the milestone flow: the hold from the first
      // click is confirmed — capture it now and release the payout. Capture
      // BEFORE opening any DB transaction (a Stripe network call must never
      // happen while holding a row lock).
      const { stripeFee } = await escrow.captureHold(booking);
      return sequelize.transaction((t) => settleBooking(booking, { t, stripeFee }));
    }

    // A 'direct' charge is still awaiting Stripe confirmation (webhook or
    // return-page) — nothing more for this endpoint to do until then.
    throw Object.assign(new Error('Payment for this booking is already in progress'), { status: 400 });
  }

  // Wallet mode — unchanged behavior, now via the shared settle function.
  return sequelize.transaction((t) => settleBooking(booking, { t }));
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
exports.approveWorkEntry = async (buyerId, id, entryId, paymentType) => {
  // Escrow diversion: a read-only pre-check outside any lock/transaction — a
  // Stripe network call must never happen while holding a DB row lock. Wallet
  // mode is completely untouched below (this block only runs when escrow).
  const preBooking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (preBooking && preBooking.payment_mode === 'escrow') {
    const entry = await BookingWorkEntry.findOne({ where: { id: entryId, booking_id: preBooking.id } });
    if (!entry) throw Object.assign(new Error('Work entry not found'), { status: 404 });

    let settleHours;
    if (entry.status === 'pending') settleHours = Number(entry.hours);
    else if (entry.status === 'countered' && entry.counter_by === 'seller') settleHours = Number(entry.counter_hours);
    else throw Object.assign(new Error(`Entry is already ${entry.status}`), { status: 400 });

    const amount = wallet.round2(settleHours * Number(entry.rate));

    // First click (nothing paid or held yet) — the buyer picks how to pay
    // right now, mirroring acceptMilestone.
    if (entry.payment_status === 'unpaid') {
      // "Pay & Hold" only exists while the admin's Delayed Payments toggle is
      // on — enforced here too (not just hidden in the UI), so a stale
      // client can never force a hold once it's been turned off.
      const type = (paymentType === 'hold' && await escrow.isEscrowEnabled()) ? 'hold' : 'direct';
      if (entry.payment_type !== type) await entry.update({ payment_type: type });

      if (type === 'hold') {
        const session = await escrow.createWorkEntryHoldCheckout(preBooking, entry, { amount });
        return { escrow: true, client_secret: session.clientSecret, session_id: session.id };
      }
      const session = await escrow.createWorkEntryChargeCheckout(preBooking, entry, { amount });
      return { escrow: true, client_secret: session.clientSecret, session_id: session.id };
    }

    if (entry.payment_type === 'hold' && entry.payment_status === 'held') {
      // Second click: the hold from the first click is confirmed — capture it
      // now and release the payout. Capture BEFORE opening any DB transaction.
      const { stripeFee } = await escrow.captureWorkEntryHold(entry);

      try {
        return await sequelize.transaction(async (t) => {
          const booking = await Booking.findOne({ where: { id, buyer_id: buyerId }, lock: t.LOCK.UPDATE, transaction: t });
          if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
          const lockedEntry = await BookingWorkEntry.findOne({
            where: { id: entryId, booking_id: booking.id }, lock: t.LOCK.UPDATE, transaction: t,
          });
          if (!lockedEntry) throw Object.assign(new Error('Work entry not found'), { status: 404 });
          if (!['pending', 'countered'].includes(lockedEntry.status))
            throw Object.assign(new Error(`Entry is already ${lockedEntry.status}`), { status: 400 });

          return settleWorkEntry(booking, lockedEntry, { hours: settleHours, t, stripeFee });
        });
      } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError')
          throw Object.assign(new Error('This entry was already processed'), { status: 409 });
        throw err;
      }
    }

    // A 'direct' charge is still awaiting Stripe confirmation (webhook) —
    // nothing more for this endpoint to do until then.
    throw Object.assign(new Error('Payment for this entry is already in progress'), { status: 400 });
  }

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
// Same "split into stages" feature the seller has — either party can set
// milestones up on an ongoing booking, mirrors seller/booking.service.js.
exports.createMilestones = async (buyerId, id, milestones) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

  // Escrow: a whole-booking hold may already have been placed at commitment
  // time (before the buyer decided to split into milestones). Payment now
  // happens per-milestone instead, so release that hold before proceeding.
  if (booking.payment_mode === 'escrow' && booking.payment_status === 'held') {
    await escrow.cancelHold(booking);
    await booking.update({ payment_status: 'unpaid', escrow_payment_intent_id: null, escrow_held_at: null });
  }

  return createMilestonesShared(booking, milestones, 'buyer');
};

exports.acceptMilestone = async (buyerId, id, milestoneId, paymentType) => {
  // Escrow diversion: a read-only pre-check outside any lock/transaction — a
  // Stripe network call must never happen while holding a DB row lock. Wallet
  // mode is completely untouched below (this block only runs when escrow).
  const preBooking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (preBooking && preBooking.payment_mode === 'escrow') {
    const milestone = await BookingMilestone.findOne({ where: { id: milestoneId, booking_id: preBooking.id } });
    if (!milestone) throw Object.assign(new Error('Milestone not found'), { status: 404 });

    let settleAmount;
    if (milestone.status === 'submitted') settleAmount = Number(milestone.amount);
    else if (milestone.status === 'countered' && milestone.counter_by === 'seller') settleAmount = Number(milestone.counter_amount);
    else throw Object.assign(new Error(`Milestone is already ${milestone.status}`), { status: 400 });

    // First click (nothing paid or held yet) — the buyer picks how to pay
    // right now, not back when the milestone was set up. Whatever they pick
    // is persisted, since a 'hold' choice needs a second click later to
    // capture + release it.
    if (milestone.payment_status === 'unpaid') {
      // "Pay & Hold" only exists while the admin's Delayed Payments toggle is
      // on — enforced here too (not just hidden in the UI), so a stale
      // client can never force a hold once it's been turned off.
      const type = (paymentType === 'hold' && await escrow.isEscrowEnabled()) ? 'hold' : 'direct';
      if (milestone.payment_type !== type) await milestone.update({ payment_type: type });

      if (type === 'hold') {
        const session = await escrow.createMilestoneHoldCheckout(preBooking, milestone, { amount: settleAmount });
        return { escrow: true, client_secret: session.clientSecret, session_id: session.id };
      }
      // 'direct' — a single real charge, released the moment it's paid.
      const session = await escrow.createMilestoneChargeCheckout(preBooking, milestone, { amount: settleAmount });
      return { escrow: true, client_secret: session.clientSecret, session_id: session.id };
    }

    if (milestone.payment_type === 'hold' && milestone.payment_status === 'held') {
      // Second click, mirrors the whole-booking acceptWork flow: the hold
      // from the first click is confirmed — capture it now and release the
      // payout. Capture BEFORE opening any DB transaction (a Stripe network
      // call must never happen while holding a row lock).
      const { stripeFee } = await escrow.captureMilestoneHold(milestone);

      try {
        return await sequelize.transaction(async (t) => {
          const booking = await Booking.findOne({
            where: { id, buyer_id: buyerId }, lock: t.LOCK.UPDATE, transaction: t,
          });
          if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
          const lockedMilestone = await BookingMilestone.findOne({
            where: { id: milestoneId, booking_id: booking.id }, lock: t.LOCK.UPDATE, transaction: t,
          });
          if (!lockedMilestone) throw Object.assign(new Error('Milestone not found'), { status: 404 });
          if (!['submitted', 'countered'].includes(lockedMilestone.status))
            throw Object.assign(new Error(`Milestone is already ${lockedMilestone.status}`), { status: 400 });

          return settleMilestone(booking, lockedMilestone, { amount: settleAmount, t, stripeFee });
        });
      } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError')
          throw Object.assign(new Error('This milestone was already processed'), { status: 409 });
        throw err;
      }
    }

    // A 'direct' charge is still awaiting Stripe confirmation (webhook or
    // return-page) — nothing more for this endpoint to do until then.
    throw Object.assign(new Error('Payment for this milestone is already in progress'), { status: 400 });
  }

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

  // The buyer can reject after already placing a 'hold' (changed their mind
  // before the second, capturing click) — release that hold now rather than
  // leaving it to sit on their card until Stripe auto-expires it in 7 days.
  const hadActiveHold = milestone.payment_type === 'hold' && milestone.payment_status === 'held';
  if (hadActiveHold) await escrow.cancelMilestoneHold(milestone);

  await milestone.update({
    status: 'rejected',
    dispute_reason: dispute_reason || null,
    payment_status: hadActiveHold ? 'unpaid' : milestone.payment_status,
    escrow_payment_intent_id: hadActiveHold ? null : milestone.escrow_payment_intent_id,
  });

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
        note: `Refund for cancelled booking #${booking.id}`,
      }, t);
    }
  });

  // Notify seller booking was cancelled by buyer
  const seller = await User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.bookingCancelledByBuyer(seller, booking);
  return booking;
};

// ── Voluntary hold cancellation ──────────────────────────────────────────
// A buyer who chose "Pay & Hold" can change their mind any time before the
// second (capturing) click — release the card authorization without
// affecting the booking/milestone/entry itself, so the buyer (or seller, for
// a submitted item) can pick up right where they left off and pay again
// later. Distinct from cancelBooking (which ends the booking outright) and
// from reject/dispute (which passes judgment on the delivered work) — this
// only ever touches the payment.
exports.cancelHoldPayment = async (buyerId, id) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (!(booking.payment_mode === 'escrow' && booking.payment_type === 'hold' && booking.payment_status === 'held'))
    throw Object.assign(new Error('No active hold to cancel for this booking'), { status: 400 });

  // Stripe network call before any DB write — same discipline as every other
  // escrow path in this file.
  await escrow.cancelHold(booking);
  await booking.update({ payment_status: 'unpaid', escrow_payment_intent_id: null, escrow_held_at: null });

  const seller = await User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.holdCancelledByBuyer(seller, booking);
  return booking;
};

exports.cancelMilestoneHoldPayment = async (buyerId, id, milestoneId) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

  const milestone = await BookingMilestone.findOne({ where: { id: milestoneId, booking_id: booking.id } });
  if (!milestone) throw Object.assign(new Error('Milestone not found'), { status: 404 });
  if (!(milestone.payment_type === 'hold' && milestone.payment_status === 'held'))
    throw Object.assign(new Error('No active hold to cancel for this milestone'), { status: 400 });

  await escrow.cancelMilestoneHold(milestone);
  await milestone.update({ payment_status: 'unpaid', escrow_payment_intent_id: null, escrow_held_at: null });

  const seller = await User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.holdCancelledByBuyer(seller, booking);
  return milestone;
};

exports.cancelWorkEntryHoldPayment = async (buyerId, id, entryId) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });

  const entry = await BookingWorkEntry.findOne({ where: { id: entryId, booking_id: booking.id } });
  if (!entry) throw Object.assign(new Error('Work entry not found'), { status: 404 });
  if (!(entry.payment_type === 'hold' && entry.payment_status === 'held'))
    throw Object.assign(new Error('No active hold to cancel for this work entry'), { status: 400 });

  await escrow.cancelWorkEntryHold(entry);
  await entry.update({ payment_status: 'unpaid', escrow_payment_intent_id: null, escrow_held_at: null });

  const seller = await User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.holdCancelledByBuyer(seller, booking);
  return entry;
};
