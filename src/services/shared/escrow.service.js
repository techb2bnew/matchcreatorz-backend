'use strict';
// The single place all Stripe-calling escrow logic lives — mirrors how
// settleWorkEntry/settleMilestone centralize wallet-settlement logic.
const { sequelize, AppSetting, Booking, BookingMilestone, BookingWorkEntry, User, WalletTransaction } = require('../../models');
const stripeHelper = require('../../helpers/stripe.helper');
const env          = require('../../config/env');
const { settleMilestone } = require('./milestone.service');
const { settleBooking }   = require('./booking.service');
const { settleWorkEntry } = require('./workEntry.service');

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

// A booking gets escrow mode when the toggle is on AND Stripe is configured —
// fixed-price, milestone, and (now) hourly bookings are all eligible; the
// difference between them is only in how/when payment is collected.
const resolvePaymentMode = async () => {
  const enabled = await isEscrowEnabled();
  return enabled && stripeHelper.isEnabled() ? 'escrow' : 'wallet';
};

const buyerEmailFor = async (buyerId) => {
  const buyer = await User.findByPk(buyerId, { attributes: ['email'] });
  return buyer ? buyer.email : null;
};

const successUrlFor = (booking) => `${env.CLIENT_URL}/buyer/bookings/${booking.id}?escrow=success&session_id={CHECKOUT_SESSION_ID}`;
const cancelUrlFor  = (booking) => `${env.CLIENT_URL}/buyer/bookings/${booking.id}?escrow=cancel`;

// ══════════════════════════════════════════════════════════════════════════
// Whole booking (no milestones)
// ══════════════════════════════════════════════════════════════════════════

const createHoldCheckout = async (booking, { successUrl, cancelUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createEscrowCheckout({
    amount: Number(booking.amount),
    title: `Escrow hold — ${booking.title}`,
    description: 'MatchCreatorz escrow payment (held until work is approved)',
    metadata: { kind: 'escrow_hold', booking_id: String(booking.id) },
    hold: true,
    email,
    successUrl: successUrl || successUrlFor(booking),
    cancelUrl:  cancelUrl  || cancelUrlFor(booking),
  });
};

// 'direct' — a single real charge, released the moment it's paid.
const createBookingChargeCheckout = async (booking, { successUrl, cancelUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createEscrowCheckout({
    amount: Number(booking.amount),
    title: `Payment — ${booking.title}`,
    description: 'MatchCreatorz direct payment (charged now, released to the seller immediately)',
    metadata: { kind: 'escrow_booking_charge', booking_id: String(booking.id) },
    hold: false,
    email,
    successUrl: successUrl || successUrlFor(booking),
    cancelUrl:  cancelUrl  || cancelUrlFor(booking),
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

// ── Confirm + settle a whole-booking direct charge (webhook only, by design,
// same as confirmMilestoneCharge) — idempotent. ─────────────────────────────
const confirmBookingCharge = async (session) => {
  if (!session || session.payment_status !== 'paid') return { confirmed: false };
  const bookingId = Number(session.metadata?.booking_id);
  if (!bookingId) return { confirmed: false, reason: 'missing_metadata' };

  try {
    return await sequelize.transaction(async (t) => {
      const booking = await Booking.findOne({ where: { id: bookingId }, lock: t.LOCK.UPDATE, transaction: t });
      if (!booking) return { confirmed: false, reason: 'not_found' };
      if (booking.status !== 'amidst_completion') return { confirmed: false, reason: 'already_processed' };

      // Mark held BEFORE settling — settleBooking's `wasHeld` gate then
      // correctly skips the wallet.debit(buyer), since Stripe already
      // charged the card for this booking.
      await booking.update({
        payment_status: 'held',
        escrow_payment_intent_id: session.payment_intent,
      }, { transaction: t });

      return { confirmed: true, bookingId, booking: await settleBooking(booking, { t }) };
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

// ══════════════════════════════════════════════════════════════════════════
// Milestones
// ══════════════════════════════════════════════════════════════════════════

const createMilestoneChargeCheckout = async (booking, milestone, { amount, successUrl, cancelUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createEscrowCheckout({
    amount: Number(amount),
    title: `Milestone payment — ${milestone.title}`,
    description: `MatchCreatorz escrow milestone charge (${booking.title})`,
    metadata: { kind: 'escrow_milestone_charge', booking_id: String(booking.id), milestone_id: String(milestone.id) },
    hold: false,
    email,
    successUrl: successUrl || successUrlFor(booking),
    cancelUrl:  cancelUrl  || cancelUrlFor(booking),
  });
};

const createMilestoneHoldCheckout = async (booking, milestone, { amount, successUrl, cancelUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createEscrowCheckout({
    amount: Number(amount),
    title: `Milestone hold — ${milestone.title}`,
    description: `MatchCreatorz escrow milestone hold (${booking.title}) — held until you release payment`,
    metadata: { kind: 'escrow_milestone_hold', booking_id: String(booking.id), milestone_id: String(milestone.id) },
    hold: true,
    email,
    successUrl: successUrl || successUrlFor(booking),
    cancelUrl:  cancelUrl  || cancelUrlFor(booking),
  });
};

const confirmMilestoneHold = async (session) => {
  if (!session) return { confirmed: false };
  const bookingId   = Number(session.metadata?.booking_id);
  const milestoneId = Number(session.metadata?.milestone_id);
  if (!bookingId || !milestoneId) return { confirmed: false, reason: 'missing_metadata' };

  const milestone = await BookingMilestone.findOne({ where: { id: milestoneId, booking_id: bookingId } });
  if (!milestone) return { confirmed: false, reason: 'not_found' };
  if (milestone.payment_status === 'held' || milestone.escrow_payment_intent_id)
    return { confirmed: false, reason: 'already_processed' };

  const full = await stripeHelper.getCheckoutSessionWithIntent(session.id);
  const pi = full.payment_intent;
  if (!pi || pi.status !== 'requires_capture') return { confirmed: false, reason: 'not_yet_authorized' };

  await milestone.update({ payment_status: 'held', escrow_payment_intent_id: pi.id });
  return { confirmed: true, bookingId, milestoneId };
};

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

const captureMilestoneHold = async (milestone) => {
  if (!milestone.escrow_payment_intent_id)
    throw Object.assign(new Error('No escrow hold to capture for this milestone'), { statusCode: 400 });
  await stripeHelper.capturePaymentIntent(milestone.escrow_payment_intent_id);
};

const cancelMilestoneHold = async (milestone) => {
  if (!milestone.escrow_payment_intent_id) return;
  try {
    await stripeHelper.cancelPaymentIntent(milestone.escrow_payment_intent_id);
  } catch (err) {
    console.error('escrow.cancelMilestoneHold:', err && err.message);
  }
};

// ══════════════════════════════════════════════════════════════════════════
// Hourly work entries
// ══════════════════════════════════════════════════════════════════════════

const createWorkEntryChargeCheckout = async (booking, entry, { amount, successUrl, cancelUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createEscrowCheckout({
    amount: Number(amount),
    title: `Work payment — ${entry.work_date}`,
    description: `MatchCreatorz hourly work payment (booking #${booking.id})`,
    metadata: { kind: 'escrow_entry_charge', booking_id: String(booking.id), work_entry_id: String(entry.id) },
    hold: false,
    email,
    successUrl: successUrl || successUrlFor(booking),
    cancelUrl:  cancelUrl  || cancelUrlFor(booking),
  });
};

const createWorkEntryHoldCheckout = async (booking, entry, { amount, successUrl, cancelUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createEscrowCheckout({
    amount: Number(amount),
    title: `Work hold — ${entry.work_date}`,
    description: `MatchCreatorz hourly work hold (booking #${booking.id}) — held until you release payment`,
    metadata: { kind: 'escrow_entry_hold', booking_id: String(booking.id), work_entry_id: String(entry.id) },
    hold: true,
    email,
    successUrl: successUrl || successUrlFor(booking),
    cancelUrl:  cancelUrl  || cancelUrlFor(booking),
  });
};

const confirmWorkEntryHold = async (session) => {
  if (!session) return { confirmed: false };
  const bookingId = Number(session.metadata?.booking_id);
  const entryId   = Number(session.metadata?.work_entry_id);
  if (!bookingId || !entryId) return { confirmed: false, reason: 'missing_metadata' };

  const entry = await BookingWorkEntry.findOne({ where: { id: entryId, booking_id: bookingId } });
  if (!entry) return { confirmed: false, reason: 'not_found' };
  if (entry.payment_status === 'held' || entry.escrow_payment_intent_id)
    return { confirmed: false, reason: 'already_processed' };

  const full = await stripeHelper.getCheckoutSessionWithIntent(session.id);
  const pi = full.payment_intent;
  if (!pi || pi.status !== 'requires_capture') return { confirmed: false, reason: 'not_yet_authorized' };

  await entry.update({ payment_status: 'held', escrow_payment_intent_id: pi.id });
  return { confirmed: true, bookingId, entryId };
};

const confirmWorkEntryCharge = async (session) => {
  if (!session || session.payment_status !== 'paid') return { confirmed: false };
  const bookingId = Number(session.metadata?.booking_id);
  const entryId   = Number(session.metadata?.work_entry_id);
  if (!bookingId || !entryId) return { confirmed: false, reason: 'missing_metadata' };

  const already = await WalletTransaction.findOne({ where: { work_entry_id: entryId, type: 'earning' } });
  if (already) return { confirmed: false, reason: 'already_processed' };

  try {
    return await sequelize.transaction(async (t) => {
      const booking = await Booking.findOne({ where: { id: bookingId }, lock: t.LOCK.UPDATE, transaction: t });
      const entry = await BookingWorkEntry.findOne({
        where: { id: entryId, booking_id: bookingId }, lock: t.LOCK.UPDATE, transaction: t,
      });
      if (!booking || !entry) return { confirmed: false, reason: 'not_found' };
      if (!['pending', 'countered'].includes(entry.status)) return { confirmed: false, reason: 'already_processed' };

      const hours = Number(session.metadata?.hours) || Number(entry.hours);
      await entry.update({
        payment_status: 'held',
        escrow_payment_intent_id: session.payment_intent,
      }, { transaction: t });

      return { confirmed: true, bookingId, entryId, entry: await settleWorkEntry(booking, entry, { hours, t }) };
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return { confirmed: false, reason: 'already_processed' };
    throw err;
  }
};

const captureWorkEntryHold = async (entry) => {
  if (!entry.escrow_payment_intent_id)
    throw Object.assign(new Error('No escrow hold to capture for this work entry'), { statusCode: 400 });
  await stripeHelper.capturePaymentIntent(entry.escrow_payment_intent_id);
};

const cancelWorkEntryHold = async (entry) => {
  if (!entry.escrow_payment_intent_id) return;
  try {
    await stripeHelper.cancelPaymentIntent(entry.escrow_payment_intent_id);
  } catch (err) {
    console.error('escrow.cancelWorkEntryHold:', err && err.message);
  }
};

module.exports = {
  isEscrowEnabled,
  resolvePaymentMode,
  createHoldCheckout,
  createBookingChargeCheckout,
  confirmHold,
  confirmBookingCharge,
  captureHold,
  cancelHold,
  createMilestoneChargeCheckout,
  createMilestoneHoldCheckout,
  confirmMilestoneCharge,
  confirmMilestoneHold,
  captureMilestoneHold,
  cancelMilestoneHold,
  createWorkEntryChargeCheckout,
  createWorkEntryHoldCheckout,
  confirmWorkEntryCharge,
  confirmWorkEntryHold,
  captureWorkEntryHold,
  cancelWorkEntryHold,
};
