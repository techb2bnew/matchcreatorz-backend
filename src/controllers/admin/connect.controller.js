'use strict';
const { User, SellerProfile, ConnectTransaction } = require('../../models');
const response  = require('../../helpers/response.helper');
const { applyConnects } = require('../../helpers/connects.helper');
const notify    = require('../../helpers/notification.helper');

/**
 * @swagger
 * tags:
 *   name: Admin - Connects
 *   description: Admin manages seller connects balances
 */

/**
 * @swagger
 * /api/v1/admin/connects/{sellerId}:
 *   post:
 *     summary: Credit connects to a seller
 *     tags: [Admin - Connects]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: integer, example: 50, description: Number of connects to add }
 *               note:   { type: string,  example: "Promo credit" }
 *     responses:
 *       200:
 *         description: Connects credited, returns new balance
 *       400:
 *         description: Invalid amount
 *       404:
 *         description: Seller not found
 */
exports.addConnects = async (req, res, next) => {
  try {
    const sellerId = Number(req.params.sellerId);
    const amount   = parseInt(req.body.amount, 10);
    const note     = req.body.note || 'Admin credit';

    if (!amount || amount <= 0)
      return response.badRequest(res, 'amount must be a positive integer');

    const seller = await User.findByPk(sellerId, { attributes: ['id', 'name', 'email', 'role', 'web_fcm_token', 'mobile_fcm_token'] });
    if (!seller || seller.role !== 'SELLER')
      return response.notFound(res, 'Seller not found');

    const { balance } = await applyConnects(sellerId, amount, 'admin_credit', { note });

    // best-effort notification
    if (notify.connectsAdded) notify.connectsAdded(seller, amount, note);

    return response.success(res, `Added ${amount} connects`, { seller_id: sellerId, balance });
  } catch (err) {
    if (err.statusCode) return response.badRequest(res, err.message);
    next(err);
  }
};

/**
 * @swagger
 * /api/v1/admin/connects/{sellerId}/history:
 *   get:
 *     summary: Get a seller's connects transaction history
 *     tags: [Admin - Connects]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated ledger
 */
exports.sellerHistory = async (req, res, next) => {
  try {
    const sellerId = Number(req.params.sellerId);
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const { count, rows } = await ConnectTransaction.findAndCountAll({
      where:  { seller_id: sellerId },
      order:  [['created_at', 'DESC']],
      limit,
      offset,
    });

    const profile = await SellerProfile.findOne({ where: { user_id: sellerId }, attributes: ['connects_balance'] });

    return response.paginate(res, 'History fetched', rows, {
      total: count, page, limit,
      balance: profile ? profile.connects_balance : 0,
    });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/connects/history:
 *   get:
 *     summary: Connect ledger across every seller (the "All Sellers" view)
 *     tags: [Admin - Connects]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Paginated ledger with the seller attached to each row
 */
exports.allHistory = async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    const { count, rows } = await ConnectTransaction.findAndCountAll({
      include: [{ model: User, as: 'seller', attributes: ['id', 'name', 'email'] }],
      order:   [['created_at', 'DESC']],
      limit,
      offset,
    });

    return response.paginate(res, 'History fetched', rows, { total: count, page, limit });
  } catch (err) { next(err); }
};
