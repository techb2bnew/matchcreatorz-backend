'use strict';
const svc      = require('../../services/seller/stats.service');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * /api/v1/seller/stats:
 *   get:
 *     summary: Seller dashboard statistics
 *     tags: [Seller - Stats]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Seller stats, recent bookings, monthly earnings
 */
const getStats = async (req, res, next) => {
  try {
    const data = await svc.getDashboardStats(req.user.id);
    return response.success(res, 'Stats fetched', data);
  } catch (err) { next(err); }
};

module.exports = { getStats };
