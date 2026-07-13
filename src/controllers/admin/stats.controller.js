'use strict';
const svc      = require('../../services/admin/stats.service');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * /api/v1/admin/stats:
 *   get:
 *     summary: Admin dashboard statistics
 *     tags: [Admin - Stats]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Platform stats, recent bookings, monthly revenue
 */
const getStats = async (req, res, next) => {
  try {
    const data = await svc.getDashboardStats();
    return response.success(res, 'Stats fetched', data);
  } catch (err) { next(err); }
};

module.exports = { getStats };
