'use strict';
// The single place all Escrow.com-calling logic lives — mirrors how
// settleWorkEntry/settleMilestone centralize wallet-settlement logic.
//
// NOTE: the "funded"/"released" status checks below and releaseTransaction()
// in escrowCom.helper.js are provisional — Escrow.com's docs don't fully spell
// out the transaction/item status enum or exactly which ship/receive/accept
// calls are required before funds actually move to the seller. This needs one
// round of verification against a real sandbox transaction before go-live
// (see the plan's "open items"); the code is written so only the small
// TRANSACTION_FUNDED_STATUSES / releaseTransaction internals need adjusting,
// not the surrounding settlement flow.
const { sequelize, AppSetting, Booking, BookingMilestone, User, Job, WalletTransaction } = require('../../models');
const escrowComHelper = require('../../helpers/escrowCom.helper');
const stripeHelper    = require('../../helpers/stripe.helper');
const env             = require('../../config/env');
const wallet          = require('../wallet/wallet.service');
const notify          = require('../../helpers/notification.helper');
const { settleMilestone, platformAdminId } = require('./milestone.service');

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
// Escrow.com is configured. Hourly bookings always stay wallet-mode — there's
// no upfront total to escrow.
const resolvePaymentMode = async (jobType) => {
  if (jobType === 'hourly') return 'wallet';
  const enabled = await isEscrowEnabled();
  return enabled && escrowComHelper.isEnabled() ? 'escrow' : 'wallet';
};

const emailFor = async (userId) => {
  const user = await User.findByPk(userId, { attributes: ['email'] });
  return user ? user.email : null;
};

// Provisional — confirm the real values against a sandbox transaction payload.
const TRANSACTION_FUNDED_STATUSES = ['funded', 'agreed_and_funded', 'payment_received'];

const isFunded = (txn) => TRANSACTION_FUNDED_STATUSES.includes(txn && txn.status);

// ── Whole-booking pay transaction — created lazily at Accept Work time, NOT
// at bid-accept. Mirrors createMilestonePayTransaction below. ───────────────
const createBookingPayTransaction = async (booking) => {
  if (!escrowComHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const [buyerEmail, sellerEmail] = await Promise.all([emailFor(booking.buyer_id), emailFor(booking.seller_id)]);

  const txn = await escrowComHelper.createPayTransaction({
    amount:          Number(booking.amount),
    title:           booking.title,
    buyerEmail, sellerEmail,
    brokerFeeAmount: Number(booking.platform_fee),
    // No session/transaction id templating (Escrow.com has no Stripe-style
    // {CHECKOUT_SESSION_ID} placeholder) — the confirm step below looks the
    // transaction up from the booking row instead of trusting a query param.
    returnUrl:       `${env.CLIENT_URL}/buyer/bookings/${booking.id}?escrow=success`,
    metadata:        { kind: 'booking', booking_id: String(booking.id) },
  });

  await booking.update({ escrow_transaction_id: txn.transaction_id });
  return { checkout_url: txn.landing_page, session_id: txn.transaction_id };
};

// ── Per-milestone pay transaction — created lazily when the milestone is
// accepted (buyer approves the submitted/countered amount). ─────────────────
const createMilestonePayTransaction = async (booking, milestone, { amount } = {}) => {
  if (!escrowComHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const [buyerEmail, sellerEmail] = await Promise.all([emailFor(booking.buyer_id), emailFor(booking.seller_id)]);

  // Milestone broker fee mirrors the booking's overall fee rate.
  const feeRate  = booking.amount > 0 ? Number(booking.platform_fee) / Number(booking.amount) : 0;
  const feeShare = wallet.round2(amount * feeRate);

  const txn = await escrowComHelper.createPayTransaction({
    amount,
    title:           `${booking.title} — ${milestone.title}`,
    buyerEmail, sellerEmail,
    brokerFeeAmount: feeShare,
    // milestone_id in the return URL lets the frontend confirm against the
    // milestone-specific endpoint instead of the whole-booking one.
    returnUrl:       `${env.CLIENT_URL}/buyer/bookings/${booking.id}?escrow=success&milestone_id=${milestone.id}`,
    metadata:        { kind: 'milestone', booking_id: String(booking.id), milestone_id: String(milestone.id) },
  });

  await milestone.update({ escrow_transaction_id: txn.transaction_id });
  return { checkout_url: txn.landing_page, session_id: txn.transaction_id };
};

// ── Confirm + settle the whole-booking transaction (webhook OR
// return-fallback) — idempotent. ─────────────────────────────────────────────
const confirmBookingPayment = async (bookingId) => {
  const preBooking = await Booking.findByPk(bookingId);
  if (!preBooking || !preBooking.escrow_transaction_id) return { confirmed: false, reason: 'no_transaction' };
  if (preBooking.payment_status === 'released') return { confirmed: false, reason: 'already_processed' };

  const txn = await escrowComHelper.getTransaction(preBooking.escrow_transaction_id);
  if (!isFunded(txn)) return { confirmed: false, reason: 'not_yet_funded' };

  // Our own app already established buyer approval before this transaction
  // was ever created (see acceptWork's diversion) — so funded == approved-
  // and-payable from our workflow's perspective. Best-effort drive the
  // transaction to release; if Escrow.com requires an explicit
  // ship/receive/accept sequence first, that happens inside releaseTransaction.
  await escrowComHelper.releaseTransaction(preBooking.escrow_transaction_id).catch((err) => {
    console.error('escrow.confirmBookingPayment releaseTransaction:', err && err.message);
  });

  const result = await sequelize.transaction(async (t) => {
    const booking = await Booking.findOne({ where: { id: bookingId }, lock: t.LOCK.UPDATE, transaction: t });
    if (!booking || booking.payment_status === 'released') return { confirmed: false, reason: 'already_processed' };

    const amount  = Number(booking.amount);
    const fee     = Number(booking.platform_fee);
    const earning = wallet.round2(amount - fee);
    const adminId = await platformAdminId();

    await booking.update({ status: 'completed', payment_status: 'released' }, { transaction: t });
    await wallet.credit(booking.seller_id, earning, {
      type: 'earning', booking_id: booking.id, note: `Earning from booking #${booking.id} — ${booking.title}`,
    }, t);
    if (adminId && fee > 0) {
      await wallet.credit(adminId, fee, {
        type: 'platform_fee', booking_id: booking.id, note: `Platform fee from booking #${booking.id}`,
      }, t);
    }
    if (booking.job_id) {
      await Job.update({ status: 'COMPLETED' }, { where: { id: booking.job_id }, transaction: t });
    }
    return { confirmed: true, bookingId };
  });

  if (result.confirmed) {
    const seller = await User.findByPk(preBooking.seller_id, {
      attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'],
    });
    if (seller) notify.workAccepted(seller, preBooking);
  }
  return result;
};

// ── Confirm + settle a milestone transaction (webhook OR return-fallback) —
// idempotent. Reuses settleMilestone (same one wallet-mode acceptMilestone
// uses) — its `wasHeld` gate already skips the wallet.debit(buyer) once
// payment_status is marked 'held' below, since Escrow.com already collected
// real money for this milestone. ─────────────────────────────────────────────
const confirmMilestonePayment = async (bookingId, milestoneId) => {
  const milestone = await BookingMilestone.findOne({ where: { id: milestoneId, booking_id: bookingId } });
  if (!milestone || !milestone.escrow_transaction_id) return { confirmed: false, reason: 'no_transaction' };
  if (!['submitted', 'countered'].includes(milestone.status)) return { confirmed: false, reason: 'already_processed' };

  const txn = await escrowComHelper.getTransaction(milestone.escrow_transaction_id);
  if (!isFunded(txn)) return { confirmed: false, reason: 'not_yet_funded' };

  await escrowComHelper.releaseTransaction(milestone.escrow_transaction_id).catch((err) => {
    console.error('escrow.confirmMilestonePayment releaseTransaction:', err && err.message);
  });

  return sequelize.transaction(async (t) => {
    const booking = await Booking.findOne({ where: { id: bookingId }, lock: t.LOCK.UPDATE, transaction: t });
    const ms      = await BookingMilestone.findOne({
      where: { id: milestoneId, booking_id: bookingId }, lock: t.LOCK.UPDATE, transaction: t,
    });
    if (!booking || !ms) return { confirmed: false, reason: 'not_found' };
    if (!['submitted', 'countered'].includes(ms.status)) return { confirmed: false, reason: 'already_processed' };

    const amount = Number(ms.status === 'countered' && ms.counter_by === 'seller' ? ms.counter_amount : ms.amount);
    await ms.update({ payment_status: 'held' }, { transaction: t });
    return { confirmed: true, bookingId, milestoneId, milestone: await settleMilestone(booking, ms, { amount, t }) };
  });
};

// ── Cancel a not-yet-funded transaction — Escrow.com network call, always
// invoked OUTSIDE any open DB transaction/row-lock. ──────────────────────────
const cancelBookingTransaction = async (booking) => {
  if (!booking.escrow_transaction_id) return;
  try {
    await escrowComHelper.cancelTransaction(booking.escrow_transaction_id);
  } catch (err) {
    console.error('escrow.cancelBookingTransaction:', err && err.message);
  }
};

const cancelMilestoneTransaction = async (milestone) => {
  if (!milestone.escrow_transaction_id) return;
  try {
    await escrowComHelper.cancelTransaction(milestone.escrow_transaction_id);
  } catch (err) {
    console.error('escrow.cancelMilestoneTransaction:', err && err.message);
  }
};

// ── Legacy Stripe confirm handlers ───────────────────────────────────────────
// Bookings/milestones whose Stripe Checkout Session was already created
// before the Escrow.com migration may still complete (and fire a Stripe
// webhook) afterward — this keeps those settling correctly. New transactions
// never reach these; see createBookingPayTransaction/createMilestonePayTransaction.
const confirmLegacyStripeHold = async (session) => {
  if (!session) return { confirmed: false };
  const bookingId = Number(session.metadata?.booking_id);
  if (!bookingId) return { confirmed: false, reason: 'missing_metadata' };

  const booking = await Booking.findByPk(bookingId);
  if (!booking) return { confirmed: false, reason: 'booking_not_found' };
  if (booking.payment_status === 'held' || booking.escrow_payment_intent_id)
    return { confirmed: false, reason: 'already_processed' };

  const full = await stripeHelper.getCheckoutSessionWithIntent(session.id);
  const pi = full.payment_intent;
  if (!pi || pi.status !== 'requires_capture') return { confirmed: false, reason: 'not_yet_authorized' };

  await booking.update({ payment_status: 'held', escrow_payment_intent_id: pi.id });
  return { confirmed: true, bookingId };
};

const confirmLegacyStripeMilestoneCharge = async (session) => {
  if (!session || session.payment_status !== 'paid') return { confirmed: false };
  const bookingId   = Number(session.metadata?.booking_id);
  const milestoneId = Number(session.metadata?.milestone_id);
  if (!bookingId || !milestoneId) return { confirmed: false, reason: 'missing_metadata' };

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

module.exports = {
  isEscrowEnabled,
  resolvePaymentMode,
  createBookingPayTransaction,
  createMilestonePayTransaction,
  confirmBookingPayment,
  confirmMilestonePayment,
  cancelBookingTransaction,
  cancelMilestoneTransaction,
  confirmLegacyStripeHold,
  confirmLegacyStripeMilestoneCharge,
};
