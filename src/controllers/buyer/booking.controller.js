'use strict';
const svc      = require('../../services/buyer/booking.service');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * /api/v1/buyer/bookings:
 *   get:
 *     summary: List buyer's bookings
 *     tags: [Buyer - Bookings]
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
 * /api/v1/buyer/bookings/{id}:
 *   get:
 *     summary: Get booking detail
 *     tags: [Buyer - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Booking detail
 *       404:
 *         description: Not found
 */
exports.getBooking = async (req, res, next) => {
  try {
    const data = await svc.getBooking(req.user.id, req.params.id);
    return response.success(res, 'Booking fetched', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/buyer/bookings:
 *   post:
 *     summary: Create a new booking (from service or job)
 *     tags: [Buyer - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [seller_id, title, amount]
 *             properties:
 *               seller_id:     { type: integer }
 *               service_id:    { type: integer }
 *               job_id:        { type: integer }
 *               title:         { type: string }
 *               amount:        { type: number }
 *               delivery_days: { type: integer }
 *               notes:         { type: string }
 *     responses:
 *       201:
 *         description: Booking created
 */
exports.createBooking = async (req, res, next) => {
  try {
    const data = await svc.createBooking(req.user.id, req.body);
    return response.created(res, 'Booking created', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/buyer/bookings/{id}/accept:
 *   patch:
 *     summary: Accept completed work (amidst_completion -> completed)
 *     tags: [Buyer - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Booking completed
 */
exports.acceptWork = async (req, res, next) => {
  try {
    const data = await svc.acceptWork(req.user.id, req.params.id);
    return response.success(res, 'Work accepted. Booking completed.', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/buyer/bookings/{id}/reject:
 *   patch:
 *     summary: Reject submitted work (amidst_completion -> in_dispute)
 *     tags: [Buyer - Bookings]
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
 *               dispute_reason: { type: string }
 *     responses:
 *       200:
 *         description: Booking moved to dispute
 */
exports.rejectWork = async (req, res, next) => {
  try {
    const data = await svc.rejectWork(req.user.id, req.params.id, req.body.dispute_reason);
    return response.success(res, 'Work rejected. Booking is now in dispute.', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/buyer/bookings/{id}/cancel:
 *   patch:
 *     summary: Cancel a booking (pending or ongoing only)
 *     tags: [Buyer - Bookings]
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

/**
 * @swagger
 * /api/v1/buyer/bookings/{id}/milestones/{milestoneId}/accept:
 *   patch:
 *     summary: Accept a submitted milestone (releases that stage's payout to the seller)
 *     description: Once every milestone on a booking is accepted, the booking itself is marked completed automatically.
 *     tags: [Buyer - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: milestoneId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Milestone accepted and paid out }
 *       400: { description: Milestone is not awaiting acceptance }
 *       404: { description: Not found }
 */
exports.acceptMilestone = async (req, res, next) => {
  try {
    const data = await svc.acceptMilestone(req.user.id, req.params.id, req.params.milestoneId);
    return response.success(res, 'Milestone accepted', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/buyer/bookings/{id}/milestones/{milestoneId}/reject:
 *   patch:
 *     summary: Reject a submitted milestone (seller can resubmit just this stage)
 *     tags: [Buyer - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: milestoneId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dispute_reason: { type: string }
 *     responses:
 *       200: { description: Milestone rejected }
 *       400: { description: Milestone is not awaiting acceptance }
 *       404: { description: Not found }
 */
exports.rejectMilestone = async (req, res, next) => {
  try {
    const data = await svc.rejectMilestone(req.user.id, req.params.id, req.params.milestoneId, req.body.dispute_reason);
    return response.success(res, 'Milestone rejected', data);
  } catch (err) { next(err); }
};
