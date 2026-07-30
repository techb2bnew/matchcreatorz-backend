'use strict';
const { Op } = require('sequelize');
const { sequelize, Wallet, WalletTransaction, Withdrawal, Booking, BookingMilestone, User } = require('../../models');
const wallet     = require('../../services/wallet/wallet.service');
const topup      = require('../../services/wallet/topup.service');
const withdraw   = require('../../services/wallet/withdrawal.service');
const connectsPurchase = require('../../services/seller/connectsPurchase.service');
const stripe     = require('../../helpers/stripe.helper');
const response   = require('../../helpers/response.helper');
const env        = require('../../config/env');

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
 *     summary: Wallet config (publishable key, fee %, min withdrawal, currency)
 *     tags: [Wallet]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Config } }
 */
exports.config = async (req, res) => response.success(res, 'Wallet config', {
  publishable_key: stripe.publishableKey || '',
  stripe_enabled:  stripe.isEnabled(),
  fee_percent:     env.PLATFORM_FEE_PERCENT,
  min_withdraw:    env.MIN_WITHDRAW,
  currency:        env.WALLET_CURRENCY,
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
 *     summary: Start a wallet top-up — returns a Stripe Checkout URL
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
 *               amount:      { type: number, example: 100 }
 *               success_url: { type: string, nullable: true }
 *               cancel_url:  { type: string, nullable: true }
 *     responses:
 *       200: { description: "{ url, session_id } — redirect the user to url" }
 *       400: { description: Invalid amount }
 */
exports.topup = async (req, res, next) => {
  try {
    const out = await topup.createTopup(req.user, req.body.amount, { successUrl: req.body.success_url, cancelUrl: req.body.cancel_url });
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
      } else {
        await topup.creditFromSession(session);
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
