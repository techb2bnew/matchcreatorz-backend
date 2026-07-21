'use strict';
const { SellerProfile, ConnectTransaction } = require('../../models');
const response = require('../../helpers/response.helper');

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
