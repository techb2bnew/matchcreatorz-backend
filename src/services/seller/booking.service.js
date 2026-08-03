'use strict';
const { Op }                          = require('sequelize');
const { sequelize, Booking, BookingMilestone, User, Service, Job } = require('../../models');
const notify                          = require('../../helpers/notification.helper');
const wallet                          = require('../wallet/wallet.service');
const env                             = require('../../config/env');

const FEE_PERCENT = (Number(env.PLATFORM_FEE_PERCENT) || 10) / 100;

const INCLUDE = [
  { model: User,    as: 'buyer',   attributes: ['id', 'name'] },
  { model: User,    as: 'seller',  attributes: ['id', 'name'] },
  { model: Service, as: 'service', attributes: ['id', 'title', 'images'], required: false },
  { model: Job,     as: 'job',     attributes: ['id', 'title'],           required: false },
  { model: BookingMilestone, as: 'milestones', required: false, separate: true, order: [['position', 'ASC']] },
];

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

exports.submitWork = async (sellerId, id, { attachments, notes, delivery_days, hours_worked } = {}) => {
  const booking = await Booking.findOne({ where: { id, seller_id: sellerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
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

  if (booking.job_type === 'hourly') {
    const hours = Number(hours_worked);
    if (!hours || hours <= 0)
      throw Object.assign(new Error('hours_worked is required for hourly bookings'), { status: 400 });

    // `amount` holds the agreed $/hr rate until first submission, after which it
    // holds the computed total — recover the rate algebraically on resubmission
    // (e.g. after a dispute) instead of needing a separate rate column.
    const rate = booking.hours_worked != null
      ? Number(booking.amount) / Number(booking.hours_worked)
      : Number(booking.amount);

    const total = wallet.round2(hours * rate);
    patch.amount        = total;
    patch.platform_fee  = wallet.round2(total * FEE_PERCENT);
    patch.hours_worked  = hours;
  }

  // No wallet charge here — the buyer is only charged (and the escrow released
  // to the seller, in one step) when they click Accept.
  await booking.update(patch);
  // Notify buyer that work has been (re)submitted for review
  const buyer = await User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (buyer) notify.workSubmitted(buyer, booking);
  return booking;
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

exports.cancelBooking = async (sellerId, id, cancel_reason) => {
  const booking = await Booking.findOne({ where: { id, seller_id: sellerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  // 'ongoing' is included because bid/offer-sourced bookings now skip 'pending'
  // entirely — without this the seller would have no way to back out at all.
  if (!['pending', 'ongoing'].includes(booking.status))
    throw Object.assign(new Error('Cannot cancel booking at this stage'), { status: 400 });

  // Refund the held escrow back to the buyer.
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
        note: `Refund for booking #${booking.id} cancelled by seller`,
      }, t);
    }
  });

  // Notify buyer that seller cancelled
  const buyer = await User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (buyer) notify.bookingCancelledBySeller(buyer, booking);
  return booking;
};
