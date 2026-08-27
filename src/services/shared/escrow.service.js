'use strict';
// The single place all Stripe-calling escrow logic lives — mirrors how
// settleWorkEntry/settleMilestone centralize wallet-settlement logic.
const { sequelize, AppSetting, Booking, BookingMilestone, User, WalletTransaction } = require('../../models');
const stripeHelper = require('../../helpers/stripe.helper');
const env          = require('../../config/env');
const { settleMilestone } = require('./milestone.service');

// ── Enabled flag — short in-process cache so a booking-creation request
// doesn't need a DB round-trip on the hot path. ──────────────────────────
let _cache = { value: false, at: 0 };
const CACHE_TTL_MS = 20000;

const isEscrowEnabled = async () => {
  const now = Date.now();
  if (now - _cache.at < CACHE_TTL_MS) return _cache.value;
  const row = await AppSetting.findOne({ where: { key: 'escrow_settings' } });
  const enabled = !!(row && row.value && row.value.enabled);
  _cache = { value: enabled, at: now };
  return enabled;
};

// A fixed-price/milestone booking gets escrow mode when the toggle is on AND
// Stripe is configured. Hourly bookings always stay wallet-mode — there's no
// upfront total to hold/charge.
const resolvePaymentMode = async (jobType) => {
  if (jobType === 'hourly') return 'wallet';
  const enabled = await isEscrowEnabled();
  return enabled && stripeHelper.isEnabled() ? 'escrow' : 'wallet';
};

const buyerEmailFor = async (buyerId) => {
  const buyer = await User.findByPk(buyerId, { attributes: ['email'] });
  return buyer ? buyer.email : null;
};

// ── Whole-booking hold (manual capture) ─────────────────────────────────
const createHoldCheckout = async (booking, { successUrl, cancelUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createEscrowHoldCheckout({
    amount: Number(booking.amount),
    booking: { id: booking.id, title: booking.title, buyerEmail: email },
    successUrl: successUrl || `${env.CLIENT_URL}/buyer/bookings/${booking.id}?escrow=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl:  cancelUrl  || `${env.CLIENT_URL}/buyer/bookings/${booking.id}?escrow=cancel`,
  });
};

// ── Per-milestone charge (normal auto-capture — this IS the charge) ──────
const createMilestoneChargeCheckout = async (booking, milestone, { amount, successUrl, cancelUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createMilestoneChargeCheckout({
    amount: Number(amount),
    booking: { id: booking.id, title: booking.title, buyerEmail: email },
    milestone: { id: milestone.id, title: milestone.title },
    successUrl: successUrl || `${env.CLIENT_URL}/buyer/bookings/${booking.id}?escrow=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl:  cancelUrl  || `${env.CLIENT_URL}/buyer/bookings/${booking.id}?escrow=cancel`,
  });
};

// ── Confirm the whole-booking hold (webhook OR return-fallback) — idempotent ──
const confirmHold = async (session) => {
  if (!session) return { confirmed: false };
  const bookingId = Number(session.metadata?.booking_id);
  if (!bookingId) return { confirmed: false, reason: 'missing_metadata' };

  const booking = await Booking.findByPk(bookingId);
  if (!booking) return { confirmed: false, reason: 'booking_not_found' };
  if (booking.payment_status === 'held' || booking.escrow_payment_intent_id)
    return { confirmed: false, reason: 'already_processed' };

  // A manual-capture session's own session.payment_status does NOT read 'paid'
  // at hold-time — check the expanded PaymentIntent's status instead.
  const full = await stripeHelper.getCheckoutSessionWithIntent(session.id);
  const pi = full.payment_intent;
  if (!pi || pi.status !== 'requires_capture') return { confirmed: false, reason: 'not_yet_authorized' };

  await booking.update({ payment_status: 'held', escrow_payment_intent_id: pi.id });
  return { confirmed: true, bookingId };
};

// ── Confirm + settle a milestone charge (webhook OR return-fallback) — idempotent ──
const confirmMilestoneCharge = async (session) => {
  if (!session || session.payment_status !== 'paid') return { confirmed: false };
  const bookingId   = Number(session.metadata?.booking_id);
  const milestoneId = Number(session.metadata?.milestone_id);
  if (!bookingId || !milestoneId) return { confirmed: false, reason: 'missing_metadata' };

  // DB-level backstop (partial unique index on milestone_id+type) also guards
  // this — this check just avoids a wasted transaction on a clean retry.
  const already = await WalletTransaction.findOne({ where: { milestone_id: milestoneId, type: 'earning' } });
  if (already) return { confirmed: false, reason: 'already_processed' };

  try {
    return await sequelize.transaction(async (t) => {
      const booking = await Booking.findOne({ where: { id: bookingId }, lock: t.LOCK.UPDATE, transaction: t });
      const milestone = await BookingMilestone.findOne({
        where: { id: milestoneId, booking_id: bookingId }, lock: t.LOCK.UPDATE, transaction: t,
      });
      if (!booking || !milestone) return { confirmed: false, reason: 'not_found' };
      if (!['submitted', 'countered'].includes(milestone.status)) return { confirmed: false, reason: 'already_processed' };

      const amount = Number(session.metadata?.amount) || Number(milestone.amount);
      // Mark held BEFORE settling — settleMilestone's existing `wasHeld` gate
      // then correctly skips the wallet.debit(buyer), since Stripe already
      // charged the card for this milestone.
      await milestone.update({
        payment_status: 'held',
        escrow_payment_intent_id: session.payment_intent,
      }, { transaction: t });

      return { confirmed: true, bookingId, milestoneId, milestone: await settleMilestone(booking, milestone, { amount, t }) };
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return { confirmed: false, reason: 'already_processed' };
    throw err;
  }
};

// ── Capture / cancel the whole-booking hold — Stripe network calls, always
// invoked OUTSIDE any open DB transaction/row-lock. ───────────────────────
const captureHold = async (booking) => {
  if (!booking.escrow_payment_intent_id)
    throw Object.assign(new Error('No escrow hold to capture for this booking'), { statusCode: 400 });
  await stripeHelper.capturePaymentIntent(booking.escrow_payment_intent_id);
  await booking.update({ escrow_captured_at: new Date() });
};

const cancelHold = async (booking) => {
  if (!booking.escrow_payment_intent_id) return;
  try {
    await stripeHelper.cancelPaymentIntent(booking.escrow_payment_intent_id);
  } catch (err) {
    // Already captured/canceled on Stripe's side (e.g. auto-expired after 7
    // days) — nothing more to do, the booking-side update still proceeds.
    console.error('escrow.cancelHold:', err && err.message);
  }
};

module.exports = {
  isEscrowEnabled,
  resolvePaymentMode,
  createHoldCheckout,
  createMilestoneChargeCheckout,
  confirmHold,
  confirmMilestoneCharge,
  captureHold,
  cancelHold,
};
