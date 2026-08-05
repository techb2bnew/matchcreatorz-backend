'use strict';
const { Notification } = require('../../models');
const response         = require('../../helpers/response.helper');
const { Op }           = require('sequelize');

/**
 * @swagger
 * tags:
 *   - name: Buyer - Notifications
 *     description: Notification inbox for buyers
 *   - name: Seller - Notifications
 *     description: Notification inbox for sellers
 */

// ── GET /notifications ────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/notifications:
 *   get:
 *     summary: List notifications for the authenticated buyer
 *     tags: [Buyer - Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: unread_only
 *         schema: { type: boolean }
 *         description: Pass true to fetch only unread notifications
 *     responses:
 *       200:
 *         description: List of notifications
 *
 * /api/v1/seller/notifications:
 *   get:
 *     summary: List notifications for the authenticated seller
 *     tags: [Seller - Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: unread_only
 *         schema: { type: boolean }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by title or body
 *     responses:
 *       200:
 *         description: List of notifications
 */
const listNotifications = async (req, res, next) => {
  try {
    const page       = Math.max(1, parseInt(req.query.page)  || 1);
    const limit      = Math.min(50, parseInt(req.query.limit) || 20);
    const unreadOnly = req.query.unread_only === 'true';
    const search     = req.query.search && String(req.query.search).trim();

    const where = { user_id: req.user.id };
    if (unreadOnly) where.is_read = false;
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { body:  { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await Notification.findAndCountAll({
      where,
      order:    [['created_at', 'DESC']],
      limit,
      offset:   (page - 1) * limit,
    });

    return response.success(res, 'Notifications fetched', {
      data:  rows,
      total: count,
      page,
      limit,
    });
  } catch (err) { next(err); }
};

// ── GET /notifications/unread-count ──────────────────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/notifications/unread-count:
 *   get:
 *     summary: Get unread notification count for buyer
 *     tags: [Buyer - Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Unread count
 *
 * /api/v1/seller/notifications/unread-count:
 *   get:
 *     summary: Get unread notification count for seller
 *     tags: [Seller - Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Unread count
 */
const getUnreadCount = async (req, res, next) => {
  try {
    const count = await Notification.count({
      where: { user_id: req.user.id, is_read: false },
    });
    return response.success(res, 'Unread count', { count });
  } catch (err) { next(err); }
};

// ── PUT /notifications/:id/read ───────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/notifications/{id}/read:
 *   put:
 *     summary: Mark a single notification as read (buyer)
 *     tags: [Buyer - Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Marked as read
 *       404:
 *         description: Notification not found
 *
 * /api/v1/seller/notifications/{id}/read:
 *   put:
 *     summary: Mark a single notification as read (seller)
 *     tags: [Seller - Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Marked as read
 *       404:
 *         description: Notification not found
 */
const markOneRead = async (req, res, next) => {
  try {
    const notif = await Notification.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });
    if (!notif) return response.notFound(res, 'Notification not found');
    await notif.update({ is_read: true });
    return response.success(res, 'Notification marked as read');
  } catch (err) { next(err); }
};

// ── PUT /notifications/read-all ───────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/notifications/read-all:
 *   put:
 *     summary: Mark all notifications as read (buyer)
 *     tags: [Buyer - Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: All marked as read
 *
 * /api/v1/seller/notifications/read-all:
 *   put:
 *     summary: Mark all notifications as read (seller)
 *     tags: [Seller - Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: All marked as read
 */
const markAllRead = async (req, res, next) => {
  try {
    await Notification.update(
      { is_read: true },
      { where: { user_id: req.user.id, is_read: false } }
    );
    return response.success(res, 'All notifications marked as read');
  } catch (err) { next(err); }
};

// ── DELETE /notifications/:id ─────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/notifications/{id}:
 *   delete:
 *     summary: Delete a notification (buyer)
 *     tags: [Buyer - Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Deleted
 *
 * /api/v1/seller/notifications/{id}:
 *   delete:
 *     summary: Delete a notification (seller)
 *     tags: [Seller - Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Deleted
 */
const deleteOne = async (req, res, next) => {
  try {
    const notif = await Notification.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });
    if (!notif) return response.notFound(res, 'Notification not found');
    await notif.destroy();
    return response.success(res, 'Notification deleted');
  } catch (err) { next(err); }
};

module.exports = { listNotifications, getUnreadCount, markOneRead, markAllRead, deleteOne };
