'use strict';
// The single place all Stripe-calling escrow logic lives — mirrors how
// settleWorkEntry/settleMilestone centralize wallet-settlement logic.
const { Op } = require('sequelize');
const { sequelize, AppSetting, Booking, BookingMilestone, BookingWorkEntry, User, WalletTransaction } = require('../../models');
const stripeHelper = require('../../helpers/stripe.helper');
const env          = require('../../config/env');
const { computeFee } = require('../../config/fee');
const wallet       = require('../wallet/wallet.service');
const notify       = require('../../helpers/notification.helper');
const { settleMilestone } = require('./milestone.service');
const { settleBooking }   = require('./booking.service');
const { settleWorkEntry } = require('./workEntry.service');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Stripe doesn't always attach the balance_transaction to a charge the
// instant it succeeds — there can be a brief lag before it's readable. The
// return-page fallback (unlike the webhook, which usually arrives a bit
// later) can run fast enough to beat that lag, so extractStripeFee comes
// back null on the first try even though the fee genuinely exists moments
// later. A couple of short retries covers that window without meaningfully
// delaying settlement in the common case where it's already there.
const fetchStripeFeeWithRetry = async (paymentIntentId, label) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await sleep(1200);
    try {
      const pi = await stripeHelper.getPaymentIntentWithFee(paymentIntentId);
      const fee = stripeHelper.extractStripeFee(pi);
      if (fee != null) return fee;
    } catch (err) {
      console.error(`${label}: failed to fetch Stripe fee (attempt ${attempt + 1}):`, err && err.message);
    }
  }
  return null;
};

// ── Settings — short in-process cache so a booking-creation request doesn't
// need a DB round-trip on the hot path. ───────────────────────────────────
let _cache = { value: { enabled: true, hold_days: 7 }, at: 0 };
const CACHE_TTL_MS = 20000;

// Stripe hard-caps a manual-capture PaymentIntent's authorization at 7 days —
// after that it auto-cancels the hold on Stripe's own side regardless of
// what this app wants, so the admin can never configure something longer
// than Stripe will actually honor. Floor of 1 day so a misconfigured 0/blank
// value can't cancel holds instantly.
const MAX_HOLD_DAYS = 7;

const getEscrowSettings = async () => {
  const now = Date.now();
  if (now - _cache.at < CACHE_TTL_MS) return _cache.value;
  const row = await AppSetting.findOne({ where: { key: 'escrow_settings' } });
  const enabled = !!(row && row.value && row.value.enabled);
  const holdDays = Math.min(MAX_HOLD_DAYS, Math.max(1, Number(row?.value?.hold_days) || MAX_HOLD_DAYS));
  const value = { enabled, hold_days: holdDays };
  _cache = { value, at: now };
  return value;
};

const isEscrowEnabled  = async () => (await getEscrowSettings()).enabled;
const getEscrowHoldDays = async () => (await getEscrowSettings()).hold_days;

// Every booking is paid via Stripe (escrow mode) — there is no buyer wallet
// balance to fall back to any more (top-up was intentionally removed, buyers
// pay by card directly). Silently falling back to 'wallet' here used to leave
// bookings permanently stuck: a buyer with no way to ever fund that balance
// could never pay for them.
//
// The admin's escrow_settings.enabled toggle still exists, but it's no
// longer a wallet-vs-escrow switch — with no wallet to fall back to, "off"
// now means "don't allow new bookings at all" (e.g. Stripe misconfigured or
// payments deliberately paused platform-wide), never a silent switch to a
// payment mode nothing can settle.
const resolvePaymentMode = async () => {
  if (!stripeHelper.isEnabled())
    throw Object.assign(new Error('Payments are not configured — contact support before creating a booking'), { statusCode: 500 });
  if (!(await isEscrowEnabled()))
    throw Object.assign(new Error('Payments are currently disabled by the platform — please try again later'), { statusCode: 503 });
  return 'escrow';
};

const buyerEmailFor = async (buyerId) => {
  const buyer = await User.findByPk(buyerId, { attributes: ['email'] });
  return buyer ? buyer.email : null;
};

// Still needed: embedded Checkout completion redirects the browser here, same
// as hosted mode's success_url — there's no separate cancel URL any more,
// since "cancel" is now just the buyer closing our own modal (no Stripe-side
// redirect involved at all).
const returnUrlFor = (booking) => `${env.CLIENT_URL}/buyer/bookings/${booking.id}?escrow=success&session_id={CHECKOUT_SESSION_ID}`;

// The informational `escrow_hold` rows are written the moment a hold is placed
// and carry "(pending release)" in their note. Without this they'd keep
// reading as pending forever — so the wallet's Hold Payments tab would still
// list a hold the buyer already released. Called on every terminal outcome
// (captured or cancelled) for both the buyer's and the seller's copy.
//
// `scope` must pin down exactly which hold: a whole-booking hold has only
// booking_id set, so it must explicitly exclude the milestone/entry rows that
// share the same booking_id.
const resolveHoldRows = async (scope, outcome) => {
  const released = outcome === 'released';
  try {
    // `status: 'pending'` matters — `scope` only narrows by booking_id (a
    // whole-booking hold has no milestone_id/work_entry_id to further scope
    // by), and a buyer can place, cancel, and re-place a hold on the same
    // booking several times over. Without this, resolving the CURRENT hold
    // would reopen and overwrite every earlier hold attempt on the same
    // booking that had already been separately resolved.
    const rows = await WalletTransaction.findAll({ where: { type: 'escrow_hold', status: 'pending', ...scope } });
    await Promise.all(rows.map((row) => row.update({
      status: released ? 'completed' : 'failed',
      note: String(row.note || '').replace(
        '(pending release)',
        released ? '(released)' : '(cancelled — hold expired)',
      ),
    })));
  } catch (err) {
    // Purely informational bookkeeping — never let it fail the actual
    // capture/cancel that already succeeded on Stripe's side.
    console.error('escrow.resolveHoldRows:', err && err.message);
  }
};

// ══════════════════════════════════════════════════════════════════════════
// Whole booking (no milestones)
// ══════════════════════════════════════════════════════════════════════════

const createHoldCheckout = async (booking, { returnUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createEscrowCheckout({
    amount: Number(booking.amount),
    title: `Escrow hold — ${booking.title}`,
    description: 'MatchCreatorz escrow payment (held until work is approved)',
    metadata: { kind: 'escrow_hold', booking_id: String(booking.id) },
    hold: true,
    email,
    returnUrl: returnUrl || returnUrlFor(booking),
  });
};

// 'direct' — a single real charge, released the moment it's paid.
const createBookingChargeCheckout = async (booking, { returnUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createEscrowCheckout({
    amount: Number(booking.amount),
    title: `Payment — ${booking.title}`,
    description: 'MatchCreatorz direct payment (charged now, released to the seller immediately)',
    metadata: { kind: 'escrow_booking_charge', booking_id: String(booking.id) },
    hold: false,
    email,
    returnUrl: returnUrl || returnUrlFor(booking),
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

  await booking.update({ payment_status: 'held', escrow_payment_intent_id: pi.id, escrow_held_at: new Date() });

  // Informational only (amount 0 on both sides) — the hold is on the buyer's
  // card, nothing to actually credit/debit anyone's spendable balance yet.
  // Without these rows neither party's transaction history (and the "Hold
  // Payments" tab specifically) would show any trace of it until the later
  // Accept/Release click.
  //
  // platform_fee is an ESTIMATE at the current fee %, shown so the buyer/seller
  // aren't left staring at a blank line before release — stripe_fee is left
  // unset on purpose: nothing has actually been captured yet, so Stripe hasn't
  // charged a real processing fee to report. The eventual settle (capture)
  // recomputes both for real and records them on the final `earning`/
  // `platform_fee` rows.
  const estFee = await computeFee(Number(booking.amount));
  await wallet.credit(booking.buyer_id, 0, {
    type: 'escrow_hold', booking_id: booking.id,
    note: `Hold Payment for booking #${booking.id} — ${booking.title} (pending release)`,
    gross_amount: Number(booking.amount), platform_fee: estFee, status: 'pending',
  });
  await wallet.credit(booking.seller_id, 0, {
    type: 'escrow_hold', booking_id: booking.id,
    note: `Hold placed by buyer for booking #${booking.id} — ${booking.title} (pending release)`,
    gross_amount: Number(booking.amount), platform_fee: estFee, status: 'pending',
  });

  return { confirmed: true, bookingId };
};

// ── Confirm + settle a whole-booking direct charge (webhook only, by design,
// same as confirmMilestoneCharge) — idempotent. ─────────────────────────────
const confirmBookingCharge = async (session) => {
  if (!session || session.payment_status !== 'paid') return { confirmed: false };
  const bookingId = Number(session.metadata?.booking_id);
  if (!bookingId) return { confirmed: false, reason: 'missing_metadata' };

  // Fetch the real Stripe processing fee for this charge — a network call,
  // so it happens BEFORE any DB transaction opens. Best-effort: if the
  // balance transaction still isn't ready after retrying, settlement still
  // proceeds without it rather than blocking on fee data.
  const stripeFee = await fetchStripeFeeWithRetry(session.payment_intent, 'confirmBookingCharge');

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

      return { confirmed: true, bookingId, booking: await settleBooking(booking, { t, stripeFee }) };
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return { confirmed: false, reason: 'already_processed' };
    throw err;
  }
};

// ── Capture / cancel the whole-booking hold — Stripe network calls, always
// invoked OUTSIDE any open DB transaction/row-lock. Returns the real Stripe
// fee for the caller to pass into settleBooking. ──────────────────────────
const captureHold = async (booking) => {
  if (!booking.escrow_payment_intent_id)
    throw Object.assign(new Error('No escrow hold to capture for this booking'), { statusCode: 400 });
  const pi = await stripeHelper.capturePaymentIntent(booking.escrow_payment_intent_id);
  await booking.update({ escrow_captured_at: new Date() });
  await resolveHoldRows({ booking_id: booking.id, milestone_id: null, work_entry_id: null }, 'released');
  return { stripeFee: stripeHelper.extractStripeFee(pi) };
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
  await resolveHoldRows({ booking_id: booking.id, milestone_id: null, work_entry_id: null }, 'cancelled');
};

// ══════════════════════════════════════════════════════════════════════════
// Milestones
// ══════════════════════════════════════════════════════════════════════════

const createMilestoneChargeCheckout = async (booking, milestone, { amount, returnUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createEscrowCheckout({
    amount: Number(amount),
    title: `Milestone payment — ${milestone.title}`,
    description: `MatchCreatorz escrow milestone charge (${booking.title})`,
    metadata: { kind: 'escrow_milestone_charge', booking_id: String(booking.id), milestone_id: String(milestone.id) },
    hold: false,
    email,
    returnUrl: returnUrl || returnUrlFor(booking),
  });
};

const createMilestoneHoldCheckout = async (booking, milestone, { amount, returnUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createEscrowCheckout({
    amount: Number(amount),
    title: `Milestone hold — ${milestone.title}`,
    description: `MatchCreatorz escrow milestone hold (${booking.title}) — held until you release payment`,
    metadata: { kind: 'escrow_milestone_hold', booking_id: String(booking.id), milestone_id: String(milestone.id) },
    hold: true,
    email,
    returnUrl: returnUrl || returnUrlFor(booking),
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

  await milestone.update({ payment_status: 'held', escrow_payment_intent_id: pi.id, escrow_held_at: new Date() });

  // Informational only (amount 0) — see the identical comment on confirmHold.
  const booking = await Booking.findByPk(bookingId, { attributes: ['id', 'buyer_id', 'seller_id', 'title'] });
  if (booking) {
    const grossAmount = Number(session.metadata?.amount) || Number(milestone.amount);
    const estFee = await computeFee(grossAmount);
    await wallet.credit(booking.buyer_id, 0, {
      type: 'escrow_hold', booking_id: bookingId, milestone_id: milestoneId,
      note: `Hold Payment for milestone "${milestone.title}" — booking #${bookingId} (pending release)`,
      gross_amount: grossAmount, platform_fee: estFee, status: 'pending',
    });
    await wallet.credit(booking.seller_id, 0, {
      type: 'escrow_hold', booking_id: bookingId, milestone_id: milestoneId,
      note: `Hold placed by buyer for milestone "${milestone.title}" — booking #${bookingId} (pending release)`,
      gross_amount: grossAmount, platform_fee: estFee, status: 'pending',
    });
  }

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

  // Fetch the real Stripe processing fee — outside any DB transaction, same
  // reasoning as confirmBookingCharge.
  const stripeFee = await fetchStripeFeeWithRetry(session.payment_intent, 'confirmMilestoneCharge');

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

      return { confirmed: true, bookingId, milestoneId, milestone: await settleMilestone(booking, milestone, { amount, t, stripeFee }) };
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return { confirmed: false, reason: 'already_processed' };
    throw err;
  }
};

const captureMilestoneHold = async (milestone) => {
  if (!milestone.escrow_payment_intent_id)
    throw Object.assign(new Error('No escrow hold to capture for this milestone'), { statusCode: 400 });
  const pi = await stripeHelper.capturePaymentIntent(milestone.escrow_payment_intent_id);
  await resolveHoldRows({ milestone_id: milestone.id }, 'released');
  return { stripeFee: stripeHelper.extractStripeFee(pi) };
};

const cancelMilestoneHold = async (milestone) => {
  if (!milestone.escrow_payment_intent_id) return;
  try {
    await stripeHelper.cancelPaymentIntent(milestone.escrow_payment_intent_id);
  } catch (err) {
    console.error('escrow.cancelMilestoneHold:', err && err.message);
  }
  await resolveHoldRows({ milestone_id: milestone.id }, 'cancelled');
};

// ══════════════════════════════════════════════════════════════════════════
// Hourly work entries
// ══════════════════════════════════════════════════════════════════════════

const createWorkEntryChargeCheckout = async (booking, entry, { amount, returnUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createEscrowCheckout({
    amount: Number(amount),
    title: `Work payment — ${entry.work_date}`,
    description: `MatchCreatorz hourly work payment (booking #${booking.id})`,
    metadata: { kind: 'escrow_entry_charge', booking_id: String(booking.id), work_entry_id: String(entry.id) },
    hold: false,
    email,
    returnUrl: returnUrl || returnUrlFor(booking),
  });
};

const createWorkEntryHoldCheckout = async (booking, entry, { amount, returnUrl } = {}) => {
  if (!stripeHelper.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const email = await buyerEmailFor(booking.buyer_id);
  return stripeHelper.createEscrowCheckout({
    amount: Number(amount),
    title: `Work hold — ${entry.work_date}`,
    description: `MatchCreatorz hourly work hold (booking #${booking.id}) — held until you release payment`,
    metadata: { kind: 'escrow_entry_hold', booking_id: String(booking.id), work_entry_id: String(entry.id) },
    hold: true,
    email,
    returnUrl: returnUrl || returnUrlFor(booking),
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

  await entry.update({ payment_status: 'held', escrow_payment_intent_id: pi.id, escrow_held_at: new Date() });

  // Informational only (amount 0) — see the identical comment on confirmHold.
  const booking = await Booking.findByPk(bookingId, { attributes: ['id', 'buyer_id', 'seller_id'] });
  if (booking) {
    const hours = Number(session.metadata?.hours) || Number(entry.hours);
    const grossAmount = Number(session.metadata?.amount) || wallet.round2(hours * Number(entry.rate));
    const estFee = await computeFee(grossAmount);
    await wallet.credit(booking.buyer_id, 0, {
      type: 'escrow_hold', booking_id: bookingId, work_entry_id: entryId,
      note: `Hold Payment — ${hours} hrs on booking #${bookingId} (${entry.work_date}, pending release)`,
      gross_amount: grossAmount, platform_fee: estFee, status: 'pending',
    });
    await wallet.credit(booking.seller_id, 0, {
      type: 'escrow_hold', booking_id: bookingId, work_entry_id: entryId,
      note: `Hold placed by buyer — ${hours} hrs on booking #${bookingId} (${entry.work_date}, pending release)`,
      gross_amount: grossAmount, platform_fee: estFee, status: 'pending',
    });
  }

  return { confirmed: true, bookingId, entryId };
};

const confirmWorkEntryCharge = async (session) => {
  if (!session || session.payment_status !== 'paid') return { confirmed: false };
  const bookingId = Number(session.metadata?.booking_id);
  const entryId   = Number(session.metadata?.work_entry_id);
  if (!bookingId || !entryId) return { confirmed: false, reason: 'missing_metadata' };

  const already = await WalletTransaction.findOne({ where: { work_entry_id: entryId, type: 'earning' } });
  if (already) return { confirmed: false, reason: 'already_processed' };

  // Fetch the real Stripe processing fee — outside any DB transaction, same
  // reasoning as confirmBookingCharge.
  const stripeFee = await fetchStripeFeeWithRetry(session.payment_intent, 'confirmWorkEntryCharge');

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

      return { confirmed: true, bookingId, entryId, entry: await settleWorkEntry(booking, entry, { hours, t, stripeFee }) };
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return { confirmed: false, reason: 'already_processed' };
    throw err;
  }
};

const captureWorkEntryHold = async (entry) => {
  if (!entry.escrow_payment_intent_id)
    throw Object.assign(new Error('No escrow hold to capture for this work entry'), { statusCode: 400 });
  const pi = await stripeHelper.capturePaymentIntent(entry.escrow_payment_intent_id);
  await resolveHoldRows({ work_entry_id: entry.id }, 'released');
  return { stripeFee: stripeHelper.extractStripeFee(pi) };
};

const cancelWorkEntryHold = async (entry) => {
  if (!entry.escrow_payment_intent_id) return;
  try {
    await stripeHelper.cancelPaymentIntent(entry.escrow_payment_intent_id);
  } catch (err) {
    console.error('escrow.cancelWorkEntryHold:', err && err.message);
  }
  await resolveHoldRows({ work_entry_id: entry.id }, 'cancelled');
};

// ══════════════════════════════════════════════════════════════════════════
// Proactive hold expiry
// ══════════════════════════════════════════════════════════════════════════
//
// Stripe auto-cancels an uncaptured manual-capture PaymentIntent after 7 days
// regardless of what this app does — but the admin can configure a SHORTER
// window (escrow_settings.hold_days). Waiting on Stripe's own webhook alone
// would only ever enforce the 7-day ceiling, not a shorter admin choice, so
// this sweep actively cancels holds once OUR window elapses, for all three
// kinds of hold (whole-booking, milestone, work entry).
//
// Reverting the local record here (not just cancelling on Stripe) means this
// doesn't depend on the payment_intent.canceled webhook arriving at all —
// but if it does arrive too, the same status guards there (payment_status
// === 'held') make it a no-op the second time, so nothing double-processes.
const sweepExpiredHolds = async () => {
  const holdDays = await getEscrowHoldDays();
  const cutoff = new Date(Date.now() - holdDays * 24 * 60 * 60 * 1000);
  const reason = `Escrow hold expired (not released within ${holdDays} day${holdDays === 1 ? '' : 's'})`;
  const result = { bookings: 0, milestones: 0, entries: 0 };

  const bookings = await Booking.findAll({
    where: {
      payment_mode: 'escrow', payment_type: 'hold', payment_status: 'held',
      escrow_captured_at: null, escrow_held_at: { [Op.lt]: cutoff },
    },
  });
  for (const booking of bookings) {
    if (booking.escrow_payment_intent_id) {
      try { await stripeHelper.cancelPaymentIntent(booking.escrow_payment_intent_id); }
      catch (err) { console.error('sweepExpiredHolds(booking):', err && err.message); }
    }
    await booking.update({ status: 'cancelled', payment_status: 'refunded', cancel_reason: reason });
    await resolveHoldRows({ booking_id: booking.id, milestone_id: null, work_entry_id: null }, 'cancelled');
    const [buyer, seller] = await Promise.all([
      User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] }),
      User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] }),
    ]);
    if (seller) notify.bookingCancelledByBuyer(seller, booking);
    if (buyer) notify.bookingCancelledBySeller(buyer, booking); // reuse: generic "booking cancelled" ping
    result.bookings += 1;
  }

  const milestones = await BookingMilestone.findAll({
    where: { payment_type: 'hold', payment_status: 'held', escrow_held_at: { [Op.lt]: cutoff } },
  });
  for (const milestone of milestones) {
    if (milestone.escrow_payment_intent_id) {
      try { await stripeHelper.cancelPaymentIntent(milestone.escrow_payment_intent_id); }
      catch (err) { console.error('sweepExpiredHolds(milestone):', err && err.message); }
    }
    await milestone.update({ payment_status: 'unpaid', escrow_payment_intent_id: null, escrow_held_at: null });
    await resolveHoldRows({ milestone_id: milestone.id }, 'cancelled');
    result.milestones += 1;
  }

  const entries = await BookingWorkEntry.findAll({
    where: { payment_type: 'hold', payment_status: 'held', escrow_held_at: { [Op.lt]: cutoff } },
  });
  for (const entry of entries) {
    if (entry.escrow_payment_intent_id) {
      try { await stripeHelper.cancelPaymentIntent(entry.escrow_payment_intent_id); }
      catch (err) { console.error('sweepExpiredHolds(entry):', err && err.message); }
    }
    await entry.update({ payment_status: 'unpaid', escrow_payment_intent_id: null, escrow_held_at: null });
    await resolveHoldRows({ work_entry_id: entry.id }, 'cancelled');
    result.entries += 1;
  }

  return result;
};

module.exports = {
  isEscrowEnabled,
  getEscrowHoldDays,
  MAX_HOLD_DAYS,
  sweepExpiredHolds,
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
