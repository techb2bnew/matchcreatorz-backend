'use strict';
const { SellerProfile, ConnectTransaction } = require('../../models');
const response = require('../../helpers/response.helper');
const purchase  = require('../../services/seller/connectsPurchase.service');

const fail = (res, err, next) => {
  if (err && err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  return next(err);
};

/**
 * @swagger
 * tags:
 *   name: Seller - Connects
 *   description: Seller connects balance & history
 */

/**
 * @swagger
 * /api/v1/seller/connects/balance:
 *   get:
 *     summary: Get my current connects balance
 *     tags: [Seller - Connects]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Current balance
 */
exports.getBalance = async (req, res, next) => {
  try {
    const profile = await SellerProfile.findOne({
      where: { user_id: req.user.id },
      attributes: ['connects_balance'],
    });
    return response.success(res, 'Balance fetched', {
      balance: profile ? profile.connects_balance : 0,
    });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/connects/history:
 *   get:
 *     summary: Get my connects transaction history
 *     tags: [Seller - Connects]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated ledger with current balance in meta
 */
exports.getHistory = async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const { count, rows } = await ConnectTransaction.findAndCountAll({
      where:  { seller_id: req.user.id },
      order:  [['created_at', 'DESC']],
      limit,
      offset,
    });

    const profile = await SellerProfile.findOne({
      where: { user_id: req.user.id },
      attributes: ['connects_balance'],
    });

    return response.paginate(res, 'History fetched', rows, {
      total: count, page, limit,
      balance: profile ? profile.connects_balance : 0,
    });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/connects/plans:
 *   get:
 *     summary: List purchasable connects plans
 *     tags: [Seller - Connects]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Available plans (id, name, price, connects, discount)
 */
exports.getPlans = async (req, res, next) => {
  try { return response.success(res, 'Plans fetched', purchase.PLANS); }
  catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/connects/purchase:
 *   post:
 *     summary: Buy a connects plan — returns a Stripe Checkout URL
 *     tags: [Seller - Connects]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [plan_id]
 *             properties:
 *               plan_id:     { type: string, example: pro }
 *               success_url: { type: string, nullable: true }
 *               cancel_url:  { type: string, nullable: true }
 *     responses:
 *       200: { description: "{ url, session_id } — redirect the seller to url" }
 *       400: { description: Invalid plan }
 */
exports.purchasePlan = async (req, res, next) => {
  try {
    const out = await purchase.createPurchase(req.user, req.body.plan_id, {
      successUrl: req.body.success_url, cancelUrl: req.body.cancel_url,
    });
    return response.success(res, 'Checkout session created', out);
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/seller/connects/purchase/confirm:
 *   get:
 *     summary: Confirm a connects purchase after Checkout return (webhook fallback)
 *     tags: [Seller - Connects]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: session_id, required: true, schema: { type: string } }
 *     responses: { 200: { description: Credit result } }
 */
exports.confirmPurchase = async (req, res, next) => {
  try {
    const out = await purchase.confirmPurchase(req.query.session_id);
    return response.success(res, 'Purchase confirmed', out);
  } catch (err) { return fail(res, err, next); }
};
