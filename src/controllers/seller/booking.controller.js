'use strict';
const svc      = require('../../services/seller/booking.service');
const response = require('../../helpers/response.helper');
const { uploadToS3 } = require('../../helpers/s3.helper');

/**
 * @swagger
 * /api/v1/seller/bookings/upload:
 *   post:
 *     summary: Upload a proof-of-work attachment (image / document) to S3
 *     description: Returns a `{ url, name, type, size }` object — collect one of these per file, then pass the array as `attachments` when submitting work or a milestone.
 *     tags: [Seller - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200: { description: "{ url, name, type, size }" }
 *       400: { description: No file / invalid type }
 */
exports.uploadAttachment = async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return response.badRequest(res, 'No file uploaded');
    const url = await uploadToS3(file, 'bookings');
    return response.success(res, 'File uploaded', {
      url, name: file.originalname, type: file.mimetype, size: file.size,
    });
  } catch (err) { next(err); }
};

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
 *     description: |
 *       Only valid for bookings **without** milestones — if the booking has been split
 *       into milestones, submit each one individually via
 *       `/seller/bookings/{id}/milestones/{milestoneId}/submit` instead.
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
 *               attachments:
 *                 type: array
 *                 description: Proof-of-work files (upload via /seller/bookings/upload first)
 *                 items:
 *                   type: object
 *                   properties:
 *                     url:  { type: string }
 *                     name: { type: string }
 *                     type: { type: string }
 *                     size: { type: integer }
 *               notes: { type: string, description: Message describing the delivered work }
 *               delivery_days: { type: integer, nullable: true, description: Updated/actual delivery duration in days (optional) }
 *               hours_worked: { type: number, description: Required for hourly bookings — hours logged; total charged = hours * agreed rate }
 *     responses:
 *       200:
 *         description: Work submitted, awaiting buyer review
 *       400:
 *         description: Booking uses milestones — submit those individually instead
 */
exports.submitWork = async (req, res, next) => {
  try {
    const data = await svc.submitWork(req.user.id, req.params.id, req.body);
    return response.success(res, 'Work submitted for buyer review', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/bookings/{id}/work-entries:
 *   post:
 *     summary: Log a day of hourly work (hourly bookings only)
 *     description: |
 *       Each call adds one dated entry — it does NOT overwrite previous entries.
 *       Rate is always taken from the booking's `hourly_rate`, never from the request.
 *       Rejected with 400 if the entry would exceed the booking's `weekly_hour_limit`.
 *     tags: [Seller - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [work_date, hours]
 *             properties:
 *               work_date:   { type: string, format: date, example: "2026-08-21" }
 *               description: { type: string }
 *               hours:       { type: number, example: 5 }
 *     responses:
 *       201: { description: Entry logged, awaiting buyer review }
 *       400: { description: Not hourly / weekly limit exceeded / invalid hours }
 */
exports.submitWorkEntry = async (req, res, next) => {
  try {
    const data = await svc.submitWorkEntry(req.user.id, req.params.id, req.body);
    return response.created(res, 'Work entry logged for buyer review', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/bookings/{id}/work-entries/{entryId}/accept-counter:
 *   patch:
 *     summary: Accept the buyer's counter on a work entry (pays at the countered hours)
 *     tags: [Seller - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Counter accepted and paid }
 *       400: { description: No buyer counter to accept on this entry }
 *       404: { description: Not found }
 */
exports.acceptWorkEntryCounter = async (req, res, next) => {
  try {
    const data = await svc.acceptWorkEntryCounter(req.user.id, req.params.id, req.params.entryId);
    return response.success(res, 'Counter accepted', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/bookings/{id}/work-entries/{entryId}/counter:
 *   patch:
 *     summary: Re-counter the buyer's counter on a work entry (propose a different hours value back)
 *     tags: [Seller - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [counter_hours]
 *             properties:
 *               counter_hours: { type: number, example: 4 }
 *               counter_note:  { type: string }
 *     responses:
 *       200: { description: Counter sent back to buyer }
 *       400: { description: No buyer counter to respond to / counter exceeds logged hours }
 *       404: { description: Not found }
 */
exports.counterWorkEntryBySeller = async (req, res, next) => {
  try {
    const data = await svc.counterWorkEntryBySeller(req.user.id, req.params.id, req.params.entryId, req.body);
    return response.success(res, 'Counter sent to buyer', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/bookings/{id}/milestones:
 *   post:
 *     summary: Split a booking's total amount into milestones
 *     description: |
 *       One-time setup — call once per booking, while it is `ongoing`. Amounts must add
 *       up exactly to the booking's total. Once set up, submit and get paid per milestone
 *       instead of all at once.
 *     tags: [Seller - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [milestones]
 *             properties:
 *               milestones:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [title, amount]
 *                   properties:
 *                     title:         { type: string, example: "Wireframes" }
 *                     amount:        { type: number, example: 150 }
 *                     duration_days: { type: integer, nullable: true, example: 3, description: Expected days for this stage (optional) }
 *     responses:
 *       201: { description: Milestones created }
 *       400: { description: Amounts don't add up to the booking total / already set up }
 */
exports.createMilestones = async (req, res, next) => {
  try {
    const data = await svc.createMilestones(req.user.id, req.params.id, req.body.milestones);
    return response.created(res, 'Milestones created', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/bookings/{id}/milestones/{milestoneId}/accept-counter:
 *   patch:
 *     summary: Accept the buyer's counter on a milestone (pays at the countered amount)
 *     description: |
 *       In escrow mode this does NOT charge anyone here — the seller has no card to charge. The
 *       milestone is moved back to "submitted" at the agreed amount instead, and settles once the
 *       buyer pays via `PATCH /buyer/.../milestones/:id/accept` (which returns a Stripe Checkout
 *       session for that buyer to complete).
 *     tags: [Seller - Bookings]
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
 *       200: { description: Counter accepted and paid (wallet mode), or moved back to "submitted" awaiting buyer payment (escrow mode) }
 *       400: { description: No buyer counter to accept on this milestone }
 *       404: { description: Not found }
 *       409: { description: Milestone was already processed (duplicate/retry) }
 */
exports.acceptMilestoneCounterBySeller = async (req, res, next) => {
  try {
    const data = await svc.acceptMilestoneCounterBySeller(req.user.id, req.params.id, req.params.milestoneId);
    return response.success(res, 'Counter accepted', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/bookings/{id}/milestones/{milestoneId}/counter:
 *   patch:
 *     summary: Re-counter the buyer's counter on a milestone (propose a different amount back)
 *     tags: [Seller - Bookings]
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
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [counter_amount]
 *             properties:
 *               counter_amount: { type: number, example: 125 }
 *               counter_note:   { type: string }
 *     responses:
 *       200: { description: Counter sent back to buyer }
 *       400: { description: No buyer counter to respond to / counter exceeds submitted amount }
 *       404: { description: Not found }
 */
exports.counterMilestoneBySeller = async (req, res, next) => {
  try {
    const data = await svc.counterMilestoneBySeller(req.user.id, req.params.id, req.params.milestoneId, req.body);
    return response.success(res, 'Counter sent to buyer', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/bookings/{id}/milestones/{milestoneId}/submit:
 *   patch:
 *     summary: Submit one milestone for buyer review
 *     tags: [Seller - Bookings]
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
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     url:  { type: string }
 *                     name: { type: string }
 *                     type: { type: string }
 *                     size: { type: integer }
 *               notes: { type: string }
 *               duration_days: { type: integer, nullable: true, description: Updated/actual duration in days for this stage (optional) }
 *     responses:
 *       200: { description: Milestone submitted, awaiting buyer review }
 *       400: { description: Milestone already submitted/approved }
 *       404: { description: Milestone not found }
 */
exports.submitMilestone = async (req, res, next) => {
  try {
    const data = await svc.submitMilestone(req.user.id, req.params.id, req.params.milestoneId, req.body);
    return response.success(res, 'Milestone submitted for buyer review', data);
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
