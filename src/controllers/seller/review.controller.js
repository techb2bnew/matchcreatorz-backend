'use strict';
const svc      = require('../../services/seller/review.service');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * /api/v1/seller/reviews:
 *   get:
 *     summary: List reviews received by this seller
 *     tags: [Seller - Reviews]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: List of received reviews }
 */
const listReviews = async (req, res, next) => {
  try {
    const result = await svc.listReceivedReviews(req.user.id, req.query);
    return response.paginate(res, 'Reviews fetched', result.reviews, {
      page: result.page, limit: result.limit, total: result.total,
    });
  } catch (err) { next(err); }
};

module.exports = { listReviews };
