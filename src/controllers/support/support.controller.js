'use strict';
const support  = require('../../services/support/support.service');
const response = require('../../helpers/response.helper');
const { uploadToS3 } = require('../../helpers/s3.helper');

const fail = (res, err, next) => {
  if (err && err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  return next(err);
};

/**
 * @swagger
 * tags:
 *   name: Support
 *   description: Support tickets between a Buyer/Seller and the Admin team. The user can message support instantly (a ticket is created OPEN); any admin sees it in a shared queue and can Accept/Assign it and move it through OPEN → IN_PROGRESS → RESOLVED → CLOSED. Socket.IO delivers messages and queue updates in real time.
 */

/**
 * @swagger
 * /api/v1/support/tickets:
 *   post:
 *     summary: Open a support ticket (Buyer/Seller) — sends the first message immediately
 *     tags: [Support]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               subject:    { type: string, example: "Payment not received" }
 *               body:       { type: string, example: "My payout is pending since 3 days." }
 *               attachment: { type: object, nullable: true, example: { url: "https://...", name: "receipt.pdf" } }
 *     responses:
 *       201: { description: Ticket created (status OPEN) with the first message }
 *       400: { description: Admin tried to open a ticket / empty message }
 */
exports.openTicket = async (req, res, next) => {
  try {
    const t = await support.openTicket(req.user, req.body);
    return response.created(res, 'Support ticket created', t);
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/support/tickets:
 *   get:
 *     summary: List tickets — user sees their own; admin sees the queue
 *     tags: [Support]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [OPEN, IN_PROGRESS, RESOLVED, CLOSED] }
 *         description: (admin) filter by status
 *       - in: query
 *         name: scope
 *         schema: { type: string, enum: [all, mine, unassigned] }
 *         description: (admin) all tickets, only mine, or only unassigned
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Paginated tickets (newest activity first) }
 */
exports.listTickets = async (req, res, next) => {
  try {
    const { data, total, page, limit } = await support.listTickets(req.user, req.query);
    return response.paginate(res, 'Support tickets fetched', data, { total, page, limit });
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/support/tickets/{id}:
 *   get:
 *     summary: Get a single ticket
 *     tags: [Support]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Ticket }
 *       403: { description: Not a participant }
 *       404: { description: Not found }
 */
exports.getTicket = async (req, res, next) => {
  try {
    const t = await support.getTicket(req.user, req.params.id);
    return response.success(res, 'Support ticket fetched', t);
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/support/tickets/{id}/messages:
 *   get:
 *     summary: Get ticket messages (paginated, newest first)
 *     tags: [Support]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30 }
 *     responses:
 *       200: { description: Paginated messages (newest first) }
 *       403: { description: Not a participant }
 */
exports.getMessages = async (req, res, next) => {
  try {
    const { data, total, page, limit } = await support.getMessages(req.user, req.params.id, req.query);
    return response.paginate(res, 'Messages fetched', data, { total, page, limit });
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/support/tickets/{id}/messages:
 *   post:
 *     summary: Send a message on a ticket (an admin reply auto-claims an unassigned ticket)
 *     tags: [Support]
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
 *             required: [body]
 *             properties:
 *               body:       { type: string, example: "Thanks, checking now." }
 *               attachment: { type: object, nullable: true }
 *     responses:
 *       201: { description: Message created & delivered in real time }
 *       400: { description: Empty body / ticket closed }
 *       403: { description: Not a participant }
 */
exports.sendMessage = async (req, res, next) => {
  try {
    const { message, ticket } = await support.addMessage(req.user, req.params.id, req.body.body, req.body.attachment);
    return response.created(res, 'Message sent', { message, ticket });
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/support/tickets/{id}/assign:
 *   patch:
 *     summary: (Admin) Accept / assign a ticket (defaults to self)
 *     tags: [Admin - Support]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               admin_id: { type: integer, nullable: true, description: "Assign to a specific admin; omit to assign to yourself" }
 *     responses:
 *       200: { description: Ticket assigned (status → IN_PROGRESS if it was OPEN) }
 *       403: { description: Admins only }
 */
exports.assignTicket = async (req, res, next) => {
  try {
    const t = await support.assignTicket(req.user, req.params.id, req.body?.admin_id);
    return response.success(res, 'Ticket assigned', t);
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/support/tickets/{id}/status:
 *   patch:
 *     summary: (Admin) Change ticket status
 *     tags: [Admin - Support]
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
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [OPEN, IN_PROGRESS, RESOLVED, CLOSED] }
 *     responses:
 *       200: { description: Status updated }
 *       400: { description: Invalid status }
 *       403: { description: Admins only }
 */
exports.updateStatus = async (req, res, next) => {
  try {
    const t = await support.updateStatus(req.user, req.params.id, req.body.status);
    return response.success(res, 'Ticket status updated', t);
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/support/tickets/{id}/read:
 *   patch:
 *     summary: Mark the other side's messages as read
 *     tags: [Support]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Marked as read }
 *       403: { description: Not a participant }
 */
exports.markRead = async (req, res, next) => {
  try {
    await support.markRead(req.user, req.params.id);
    return response.success(res, 'Marked as read');
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/support/unread-count:
 *   get:
 *     summary: Unread support message count (user → own tickets; admin → tickets assigned to me)
 *     tags: [Support]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ count: number }" }
 */
exports.getUnreadCount = async (req, res, next) => {
  try {
    const count = await support.getUnreadCount(req.user);
    return response.success(res, 'Unread count', { count });
  } catch (err) { return fail(res, err, next); }
};

/**
 * @swagger
 * /api/v1/support/upload:
 *   post:
 *     summary: Upload a support attachment (image / document) to S3
 *     tags: [Support]
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
    const url = await uploadToS3(file, 'support');
    return response.success(res, 'File uploaded', {
      url, name: file.originalname, type: file.mimetype, size: file.size,
    });
  } catch (err) { return fail(res, err, next); }
};
