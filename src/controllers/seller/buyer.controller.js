'use strict';
const { Op }   = require('sequelize');
const { User } = require('../../models');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * /api/v1/seller/buyers:
 *   get:
 *     summary: Search buyers (for sending a custom offer)
 *     description: Lightweight buyer lookup for the "Send Offer" picker. Returns minimal public info (id, name, email).
 *     tags: [Seller - Offers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by buyer name or email
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Paginated list of buyers
 */
exports.searchBuyers = async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(20, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    const where = { role: 'BUYER', status: 'active' };
    if (search) {
      where[Op.or] = [
        { name:  { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: ['id', 'name', 'email', 'avatar'],
      order:  [['name', 'ASC']],
      limit,
      offset,
    });

    return response.paginate(res, 'Buyers fetched', rows, { total: count, page, limit });
  } catch (err) { next(err); }
};
