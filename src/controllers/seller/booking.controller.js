'use strict';
const svc      = require('../../services/seller/booking.service');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * /api/v1/seller/bookings:
 *   get:
 *     summary: List seller's bookings
 *     tags: [Seller - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: tab
 *         schema: { type: string, enum: [active, completed, cancelled] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated booking list
 */
exports.listBookings = async (req, res, next) => {
  try {
    const result = await svc.listBookings(req.user.id, req.query);
    return response.paginate(res, 'Bookings fetched', result.data, { total: result.total, page: result.page, limit: result.limit });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/bookings/{id}:
 *   get:
 *     summary: Get booking detail
 *     tags: [Seller - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Booking detail
 */
exports.getBooking = async (req, res, next) => {
  try {
    const data = await svc.getBooking(req.user.id, req.params.id);
    return response.success(res, 'Booking fetched', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/bookings/{id}/accept:
 *   patch:
 *     summary: Accept order (pending -> ongoing)
 *     tags: [Seller - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Order accepted, status set to ongoing
 */
exports.acceptOrder = async (req, res, next) => {
  try {
    const data = await svc.acceptOrder(req.user.id, req.params.id);
    return response.success(res, 'Order accepted', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/bookings/{id}/submit:
 *   patch:
 *     summary: Submit work for review (ongoing|in_dispute -> amidst_completion)
 *     tags: [Seller - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Work submitted, awaiting buyer review
 */
exports.submitWork = async (req, res, next) => {
  try {
    const data = await svc.submitWork(req.user.id, req.params.id);
    return response.success(res, 'Work submitted for buyer review', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/bookings/{id}/cancel:
 *   patch:
 *     summary: Cancel a booking (pending only)
 *     tags: [Seller - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cancel_reason: { type: string }
 *     responses:
 *       200:
 *         description: Booking cancelled
 */
exports.cancelBooking = async (req, res, next) => {
  try {
    const data = await svc.cancelBooking(req.user.id, req.params.id, req.body.cancel_reason);
    return response.success(res, 'Booking cancelled', data);
  } catch (err) { next(err); }
};
