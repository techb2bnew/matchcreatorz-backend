'use strict';
const { Op } = require('sequelize');
const { sequelize, Wallet, WalletTransaction, Withdrawal, Booking, BookingMilestone, BookingWorkEntry, User } = require('../../models');
const wallet     = require('../../services/wallet/wallet.service');
const topup      = require('../../services/wallet/topup.service');
const withdraw   = require('../../services/wallet/withdrawal.service');
const connectsPurchase = require('../../services/seller/connectsPurchase.service');
const escrow     = require('../../services/shared/escrow.service');
const notify     = require('../../helpers/notification.helper');
const stripe     = require('../../helpers/stripe.helper');
const response   = require('../../helpers/response.helper');
const env        = require('../../config/env');
const { getPlatformFeePercent } = require('../../config/fee');

const fail = (res, err, next) => {
  if (err && err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  if (err && err.status)     return res.status(err.status).json({ success: false, message: err.message });
  return next(err);
};
const requireRole = (req, role) => req.user.role === role;

/**
 * @swagger
 * tags:
 *   name: Wallet
 *   description: Wallet & payments. Buyers top up via Stripe Checkout and pay bookings from wallet (escrow). Sellers earn on completed bookings and withdraw via Stripe Connect (admin-approved). Admin sees platform revenue and manages withdrawals.
 */

/**
 * @swagger
 * /api/v1/wallet/config:
 *   get:
 *     summary: Wallet config (publishable key, fee %, min withdrawal, currency, escrow hold window)
 *     tags: [Wallet]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Config } }
 */
exports.config = async (req, res) => response.success(res, 'Wallet config', {
  publishable_key: stripe.publishableKey || '',
  stripe_enabled:  stripe.isEnabled(),
  // Admin-configurable (Settings > Platform Fees) — falls back to
  // PLATFORM_FEE_PERCENT only until an admin has ever saved a value.
  fee_percent:     await getPlatformFeePercent(),
  min_withdraw:    env.MIN_WITHDRAW,
  currency:        env.WALLET_CURRENCY,
  // How long a 'hold'-type escrow payment may sit uncaptured before it's
  // automatically cancelled — shown to the buyer as the Pay & Hold terms.
  escrow_hold_days: await escrow.getEscrowHoldDays(),
  // Admin's Delayed Payments toggle — when off, "Pay & Hold" isn't offered
  // anywhere and every payment is a direct charge (enforced server-side too,
  // see buyer/booking.service.js).
  hold_payments_enabled: await escrow.isEscrowEnabled(),
});

/**
 * @swagger
 * /api/v1/wallet:
 *   get:
 *     summary: My wallet summary (balance, pending, totals)
 *     description: |
 *       For buyers, also includes `pending_payment` — the total across submitted
 *       work/milestones awaiting review, which will be charged from the wallet
 *       the moment the buyer accepts it.
 *     tags: [Wallet]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Wallet summary } }
 */
exports.summary = async (req, res, next) => {
  try {
    const data = await wallet.getSummary(req.user.id);
    if (req.user.role === 'BUYER') {
      // Buyer isn't charged until they click Accept, so "pending payment" is:
      // whole-booking submissions awaiting review (non-milestone) + individual
      // submitted milestones — whatever a fresh Accept click would charge.
      // `payment_status !== 'held'` guards against legacy bookings from before
      // this flow, whose money was already collected up front.
      const pendingBookings = await Booking.findAll({
        where: { buyer_id: req.user.id, status: 'amidst_completion', payment_status: { [Op.ne]: 'held' } },
        attributes: ['id', 'amount'],
        include: [{ model: BookingMilestone, as: 'milestones', attributes: ['id'] }],
      });
      const wholeBookingPending = pendingBookings
        .filter((b) => !b.milestones.length)
        .reduce((sum, b) => sum + Number(b.amount), 0);

      const buyerBookingIds = (await Booking.findAll({
        where: { buyer_id: req.user.id }, attributes: ['id'],
      })).map((b) => b.id);
      const milestonePending = buyerBookingIds.length
        ? await BookingMilestone.sum('amount', {
            where: { status: 'submitted', payment_status: { [Op.ne]: 'held' }, booking_id: { [Op.in]: buyerBookingIds } },
          })
        : 0;
      data.pending_payment = wallet.round2(wholeBookingPending + (milestonePending || 0));

      // Buyers pay Stripe by card, so their spending never moves the wallet
      // balance and `total_out` alone under-reports it. Total it from the
      // ledger instead: real wallet debits (wallet-mode bookings) plus the
      // gross of every card payment (escrow mode).
      const [walletSpent, cardSpent, paymentsCount] = await Promise.all([
        WalletTransaction.sum('amount', { where: { user_id: req.user.id, type: 'booking_payment' } }),
        WalletTransaction.sum('gross_amount', { where: { user_id: req.user.id, type: 'escrow_payment' } }),
        WalletTransaction.count({
          where: { user_id: req.user.id, type: { [Op.in]: ['booking_payment', 'escrow_payment'] } },
        }),
      ]);
      data.card_spent     = wallet.round2(cardSpent || 0);
      data.total_spent    = wallet.round2(Math.abs(walletSpent || 0) + (cardSpent || 0));
      data.payments_count = paymentsCount;
    }
    return response.success(res, 'Wallet', data);
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/wallet/transactions:
 *   get:
 *     summary: My wallet transaction history (paginated)
 *     tags: [Wallet]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page,  schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: type,  schema: { type: string }, description: filter by transaction type }
 *       - { in: query, name: search, schema: { type: string }, description: Search by note, transaction type label, or date shown in the UI }
 *     responses: { 200: { description: Paginated transactions } }
 */
exports.transactions = async (req, res, next) => {
  try {
    const { data, total, page, limit } = await wallet.listTransactions(req.user.id, req.query);
    return response.paginate(res, 'Transactions', data, { total, page, limit });
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/wallet/topup:
 *   post:
 *     summary: Start a wallet top-up — returns an embedded Stripe Checkout client secret
 *     tags: [Buyer - Wallet]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount:     { type: number, example: 100 }
 *               return_url: { type: string, nullable: true }
 *     responses:
 *       200: { description: "{ client_secret, session_id, publishable_key } — mount Stripe's Embedded Checkout with client_secret" }
 *       400: { description: Invalid amount }
 */
exports.topup = async (req, res, next) => {
  try {
    const out = await topup.createTopup(req.user, req.body.amount, { returnUrl: req.body.return_url });
    return response.success(res, 'Top-up session created', out);
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/wallet/topup/confirm:
 *   get:
 *     summary: Confirm a top-up after Checkout return (webhook fallback)
 *     tags: [Buyer - Wallet]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: session_id, required: true, schema: { type: string } }
 *     responses: { 200: { description: Credit result } }
 */
exports.confirmTopup = async (req, res, next) => {
  try {
    const out = await topup.confirmTopup(req.query.session_id);
    return response.success(res, 'Top-up confirmed', out);
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/wallet/connect/onboard:
 *   post:
 *     summary: (Seller) Start Stripe Connect onboarding — returns onboarding URL
 *     tags: [Seller - Wallet]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ url } — redirect the seller to complete payout setup" }
 *       403: { description: Sellers only }
 */
exports.connectOnboard = async (req, res, next) => {
  try {
    if (!requireRole(req, 'SELLER')) return response.forbidden(res, 'Only sellers can set up payouts');
    const out = await withdraw.startOnboarding(req.user, { returnUrl: req.body?.return_url, refreshUrl: req.body?.refresh_url });
    return response.success(res, 'Onboarding link created', out);
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/wallet/connect/status:
 *   get:
 *     summary: (Seller) Refresh & get Stripe Connect payout status
 *     tags: [Seller - Wallet]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Wallet summary incl. connected flag } }
 */
exports.connectStatus = async (req, res, next) => {
  try { return response.success(res, 'Connect status', await withdraw.syncConnectStatus(req.user.id)); }
  catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/wallet/withdraw:
 *   post:
 *     summary: (Seller) Request a withdrawal
 *     tags: [Seller - Wallet]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: number, example: 200 }
 *     responses:
 *       201: { description: Withdrawal requested (pending admin approval) }
 *       400: { description: Below minimum / insufficient balance / not connected }
 */
exports.withdraw = async (req, res, next) => {
  try {
    if (!requireRole(req, 'SELLER')) return response.forbidden(res, 'Only sellers can withdraw');
    const wd = await withdraw.requestWithdrawal(req.user, req.body.amount);
    return response.created(res, 'Withdrawal requested', wd);
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/wallet/withdrawals:
 *   get:
 *     summary: (Seller) My withdrawal requests
 *     tags: [Seller - Wallet]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page,  schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *     responses: { 200: { description: Paginated withdrawals } }
 */
exports.myWithdrawals = async (req, res, next) => {
  try {
    const { data, total, page, limit } = await withdraw.listMyWithdrawals(req.user.id, req.query);
    return response.paginate(res, 'Withdrawals', data, { total, page, limit });
  } catch (err) { return fail(res, err, next); }
};

// ── Admin ─────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/wallet/admin/withdrawals:
 *   get:
 *     summary: (Admin) All withdrawal requests
 *     tags: [Admin - Wallet]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [pending, approved, paid, rejected, failed] } }
 *       - { in: query, name: page,  schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *     responses: { 200: { description: Paginated withdrawals with seller } }
 */
exports.adminWithdrawals = async (req, res, next) => {
  try {
    if (!requireRole(req, 'ADMIN')) return response.forbidden(res, 'Admins only');
    const { data, total, page, limit } = await withdraw.listAllWithdrawals(req.query);
    return response.paginate(res, 'Withdrawals', data, { total, page, limit });
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/wallet/admin/withdrawals/{id}/approve:
 *   patch:
 *     summary: (Admin) Approve a withdrawal → Stripe payout to the seller
 *     tags: [Admin - Wallet]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: integer } }]
 *     responses:
 *       200: { description: Approved & paid }
 *       402: { description: Stripe transfer failed }
 */
exports.approveWithdrawal = async (req, res, next) => {
  try {
    if (!requireRole(req, 'ADMIN')) return response.forbidden(res, 'Admins only');
    const wd = await withdraw.approveWithdrawal(req.user.id, req.params.id);
    return response.success(res, 'Withdrawal approved', wd);
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/wallet/admin/withdrawals/{id}/reject:
 *   patch:
 *     summary: (Admin) Reject a withdrawal → funds returned to seller wallet
 *     tags: [Admin - Wallet]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: integer } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { note: { type: string } } }
 *     responses: { 200: { description: Rejected & refunded } }
 */
exports.rejectWithdrawal = async (req, res, next) => {
  try {
    if (!requireRole(req, 'ADMIN')) return response.forbidden(res, 'Admins only');
    const wd = await withdraw.rejectWithdrawal(req.user.id, req.params.id, req.body?.note);
    return response.success(res, 'Withdrawal rejected', wd);
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/wallet/admin/overview:
 *   get:
 *     summary: (Admin) Platform wallet overview (revenue, escrow, payouts)
 *     tags: [Admin - Wallet]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Platform financial overview } }
 */
exports.adminOverview = async (req, res, next) => {
  try {
    if (!requireRole(req, 'ADMIN')) return response.forbidden(res, 'Admins only');
    const [revenue, wholeBookingEscrow, inProgressBookings, topups, earnings, pendingW, paidW] = await Promise.all([
      WalletTransaction.sum('amount', { where: { type: 'platform_fee' } }),
      Booking.sum('amount', { where: { payment_status: 'held' } }),
      Booking.findAll({ where: { payment_status: 'unpaid' }, attributes: ['id'] }),
      WalletTransaction.sum('amount', { where: { type: 'topup' } }),
      WalletTransaction.sum('amount', { where: { type: 'earning' } }),
      Withdrawal.sum('amount', { where: { status: 'pending' } }),
      Withdrawal.sum('amount', { where: { status: 'paid' } }),
    ]);
    // Only count milestone-level holds for bookings still 'unpaid' at the booking
    // level (new per-stage flow) — a booking already 'held' (legacy lump-sum, or
    // a non-milestone hold) must not also be counted per-milestone.
    const inProgressBookingIds = inProgressBookings.map((b) => b.id);
    const milestoneEscrow = inProgressBookingIds.length
      ? await BookingMilestone.sum('amount', { where: { payment_status: 'held', booking_id: { [Op.in]: inProgressBookingIds } } })
      : 0;
    const myWallet = await wallet.getSummary(req.user.id);
    return response.success(res, 'Overview', {
      platform_revenue:   wallet.round2(revenue || 0),
      escrow_held:        wallet.round2((wholeBookingEscrow || 0) + (milestoneEscrow || 0)),
      total_topups:       wallet.round2(topups || 0),
      total_earnings_paid:wallet.round2(earnings || 0),
      pending_withdrawals:wallet.round2(pendingW || 0),
      paid_withdrawals:   wallet.round2(paidW || 0),
      admin_wallet:       myWallet,
    });
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/wallet/admin/adjust:
 *   post:
 *     summary: (Admin) Manual wallet adjustment (credit or debit a user)
 *     tags: [Admin - Wallet]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, amount]
 *             properties:
 *               user_id: { type: integer }
 *               amount:  { type: number, description: "positive = credit, negative = debit" }
 *               note:    { type: string }
 *     responses: { 200: { description: Adjusted } }
 */
exports.adminAdjust = async (req, res, next) => {
  try {
    if (!requireRole(req, 'ADMIN')) return response.forbidden(res, 'Admins only');
    const { user_id, amount, note } = req.body;
    if (!user_id || !amount) return response.badRequest(res, 'user_id and amount are required');
    const meta = { type: 'adjustment', note: note || 'Manual adjustment by admin', allowNegative: true };
    const out = Number(amount) >= 0
      ? await wallet.credit(user_id, amount, meta)
      : await wallet.debit(user_id, Math.abs(amount), meta);
    return response.success(res, 'Wallet adjusted', wallet.shapeWallet(out.wallet));
  } catch (err) { return fail(res, err, next); }
};

// ── Stripe webhook (raw body; mounted in app.js before express.json) ──────────
exports.webhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.constructEvent(req.body, sig);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.metadata?.kind === 'connects_purchase') {
        await connectsPurchase.creditFromSession(session);
      } else if (session.metadata?.kind === 'escrow_hold') {
        const full = await stripe.getCheckoutSessionWithIntent(session.id);
        await escrow.confirmHold(full);
      } else if (session.metadata?.kind === 'escrow_booking_charge') {
        await escrow.confirmBookingCharge(session);
      } else if (session.metadata?.kind === 'escrow_milestone_hold') {
        const full = await stripe.getCheckoutSessionWithIntent(session.id);
        await escrow.confirmMilestoneHold(full);
      } else if (session.metadata?.kind === 'escrow_milestone_charge') {
        await escrow.confirmMilestoneCharge(session);
      } else if (session.metadata?.kind === 'escrow_entry_hold') {
        const full = await stripe.getCheckoutSessionWithIntent(session.id);
        await escrow.confirmWorkEntryHold(full);
      } else if (session.metadata?.kind === 'escrow_entry_charge') {
        await escrow.confirmWorkEntryCharge(session);
      } else {
        await topup.creditFromSession(session);
      }
    } else if (event.type === 'payment_intent.canceled') {
      // A manual-capture PaymentIntent gets cancelled two ways: Stripe's own
      // auto-expiry after its hard 7-day cap, OR any of this app's own
      // deliberate cancel calls (buyer's Cancel Hold, splitting into
      // milestones, admin dispute resolution, our own proactive sweep) —
      // every one of those calls stripeHelper.cancelPaymentIntent, which
      // makes Stripe fire this exact same event right back at us. Those
      // calls also update the DB themselves, but this webhook can race ahead
      // of that update and see the still-stale payment_status === 'held' —
      // so treating every cancellation here as "expired" would wrongly
      // cancel the whole booking for a benign, deliberate cancel. Only the
      // hold's own age (same cutoff the sweep uses) can actually tell the
      // two apart.
      const pi = event.data.object;
      const booking = await Booking.findOne({ where: { escrow_payment_intent_id: pi.id } });
      const holdDays = await escrow.getEscrowHoldDays();
      const cutoff = new Date(Date.now() - holdDays * 24 * 60 * 60 * 1000);
      const genuinelyExpired = booking?.escrow_held_at && new Date(booking.escrow_held_at) < cutoff;

      if (booking && booking.payment_status === 'held' && !booking.escrow_captured_at && genuinelyExpired) {
        await booking.update({ status: 'cancelled', payment_status: 'refunded', cancel_reason: `Escrow hold expired (not captured within ${holdDays} day${holdDays === 1 ? '' : 's'})` });
        const [buyer, seller] = await Promise.all([
          User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] }),
          User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] }),
        ]);
        if (seller) notify.bookingCancelledByBuyer(seller, booking);
        if (buyer) notify.bookingCancelledBySeller(buyer, booking); // reuse: generic "booking cancelled" ping
      } else if (booking && booking.payment_status === 'held' && !booking.escrow_captured_at) {
        // Cancelled deliberately by our own app logic, just raced ahead of
        // that code's own DB update — reset the payment fields (harmless if
        // that other call already did this) without touching booking.status
        // or cancel_reason, since this cancellation was never an expiry.
        await booking.update({ payment_status: 'unpaid', escrow_payment_intent_id: null, escrow_held_at: null });
      } else {
        // A milestone or work-entry hold expiring is far less disruptive than
        // an entire booking falling through — just reset it back to unpaid so
        // the buyer's next Accept/Approve click places a fresh hold, instead
        // of cancelling the whole booking over one stale stage/entry.
        const milestone = await BookingMilestone.findOne({ where: { escrow_payment_intent_id: pi.id } });
        if (milestone && milestone.payment_status === 'held' && milestone.status !== 'approved') {
          await milestone.update({ payment_status: 'unpaid', escrow_payment_intent_id: null });
        } else {
          const entry = await BookingWorkEntry.findOne({ where: { escrow_payment_intent_id: pi.id } });
          if (entry && entry.payment_status === 'held' && entry.status !== 'approved') {
            await entry.update({ payment_status: 'unpaid', escrow_payment_intent_id: null });
          }
        }
      }
    } else if (event.type === 'account.updated') {
      const acct = event.data.object;
      const w = await Wallet.findOne({ where: { stripe_account_id: acct.id } });
      if (w) {
        const active = acct.payouts_enabled && acct.charges_enabled;
        await w.update({ stripe_account_status: active ? 'active' : (acct.requirements?.disabled_reason ? 'restricted' : 'pending') });
      }
    }
  } catch (err) {
    console.error('Stripe webhook handler error:', err && err.message);
  }
  return res.json({ received: true });
};
