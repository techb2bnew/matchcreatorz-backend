'use strict';
const svc      = require('../../services/buyer/stats.service');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * /api/v1/buyer/stats:
 *   get:
 *     summary: Buyer dashboard statistics
 *     tags: [Buyer - Stats]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Buyer stats, recent bookings, monthly spend
 */
const getStats = async (req, res, next) => {
  try {
    const data = await svc.getDashboardStats(req.user.id);
    return response.success(res, 'Stats fetched', data);
  } catch (err) { next(err); }
};

module.exports = { getStats };
