'use strict';
const svc      = require('../../services/admin/broadcast.service');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   - name: Admin - Broadcast
 *     description: Platform-wide announcements from admin to sellers/buyers (delivered via in-app inbox + push)
 */

/**
 * @swagger
 * /api/v1/admin/broadcasts:
 *   post:
 *     summary: Send a broadcast announcement
 *     tags: [Admin - Broadcast]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, body]
 *             properties:
 *               title:    { type: string, example: "Scheduled maintenance tonight" }
 *               body:     { type: string, example: "The platform will be briefly unavailable at midnight UTC." }
 *               audience: { type: string, enum: [ALL, SELLER, BUYER], default: ALL }
 *     responses:
 *       201:
 *         description: Broadcast sent
 *       400:
 *         description: Missing title/body or invalid audience
 *   get:
 *     summary: List sent broadcasts (history)
 *     tags: [Admin - Broadcast]
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
 *         description: Paginated broadcast history
 */
exports.sendBroadcast = async (req, res, next) => {
  try {
    const broadcast = await svc.sendBroadcast(req.user.id, req.body);
    return response.created(res, 'Broadcast sent', broadcast);
  } catch (err) { next(err); }
};

exports.listBroadcasts = async (req, res, next) => {
  try {
    const { data, total, page, limit } = await svc.listBroadcasts(req.query);
    return response.paginate(res, 'Broadcasts fetched', data, { total, page, limit });
  } catch (err) { next(err); }
};
