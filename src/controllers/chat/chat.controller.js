'use strict';
const chat     = require('../../services/chat/chat.service');
const response = require('../../helpers/response.helper');
const { uploadToS3 } = require('../../helpers/s3.helper');

// Lazy require of the socket emitter to avoid any load-order coupling.
const emitter = () => {
  try { return require('../../socket/emitter'); } catch { return null; }
};

/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: Real-time chat (conversations & messages). Socket.IO handles live events; these REST endpoints back it up and load history.
 */

/**
 * @swagger
 * /api/v1/chat/conversations:
 *   post:
 *     summary: Open (or create) a 1:1 conversation with another user
 *     tags: [Chat]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipient_id]
 *             properties:
 *               recipient_id: { type: integer, example: 5 }
 *     responses:
 *       200: { description: Conversation (existing or newly created) }
 *       400: { description: Invalid recipient / self }
 *       403: { description: Not allowed to chat with this user }
 *       404: { description: Recipient not found }
 */
exports.openConversation = async (req, res, next) => {
  try {
    const conv = await chat.openConversation(req.user, req.body.recipient_id);
    return response.success(res, 'Conversation opened', conv);
  } catch (err) {
    if (err.statusCode) return response.error ? response.error(res, err.message, err.statusCode) : res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
};

/**
 * @swagger
 * /api/v1/chat/conversations:
 *   get:
 *     summary: List my conversations (newest activity first)
 *     tags: [Chat]
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
 *         description: Paginated conversation list with other_user, last_message, unread_count
 */
exports.listConversations = async (req, res, next) => {
  try {
    const { data, total, page, limit } = await chat.listConversations(req.user, req.query);
    return response.paginate(res, 'Conversations fetched', data, { total, page, limit });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/chat/conversations/{id}:
 *   get:
 *     summary: Get a single conversation (must be a participant)
 *     tags: [Chat]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Conversation }
 *       403: { description: Not a participant }
 *       404: { description: Not found }
 */
exports.getConversation = async (req, res, next) => {
  try {
    const conv = await chat.getConversationById(req.user, req.params.id);
    return response.success(res, 'Conversation fetched', conv);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
};

/**
 * @swagger
 * /api/v1/chat/conversations/{id}/messages:
 *   get:
 *     summary: Get chat history (paginated, newest first)
 *     tags: [Chat]
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
    const { data, total, page, limit } = await chat.getMessages(req.user, req.params.id, req.query);
    return response.paginate(res, 'Messages fetched', data, { total, page, limit });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
};

/**
 * @swagger
 * /api/v1/chat/conversations/{id}/messages:
 *   post:
 *     summary: Send a message (REST fallback; also emits the socket event)
 *     tags: [Chat]
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
 *               body:       { type: string, example: "Hi, is this service available?" }
 *               attachment: { type: object, nullable: true, example: { url: "https://...", name: "brief.pdf" } }
 *     responses:
 *       201: { description: Message created & delivered in real time }
 *       400: { description: Empty body }
 *       403: { description: Not a participant }
 */
exports.sendMessage = async (req, res, next) => {
  try {
    const { message, conversation, recipientId } =
      await chat.createMessage(req.user, req.params.id, req.body.body, req.body.attachment);

    // Real-time fan-out to both participants (all their devices)
    const io = emitter();
    if (io) io.emitNewMessage({ message, conversation, senderId: req.user.id, recipientId });

    return response.created(res, 'Message sent', message);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
};

/**
 * @swagger
 * /api/v1/chat/conversations/{id}/read:
 *   patch:
 *     summary: Mark all messages in a conversation as read
 *     tags: [Chat]
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
    const { conversation, readerId, otherId } = await chat.markRead(req.user, req.params.id);
    const io = emitter();
    if (io) io.emitRead({ conversationId: conversation.id, readerId, otherId });
    return response.success(res, 'Marked as read');
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
};

/**
 * @swagger
 * /api/v1/chat/unread-count:
 *   get:
 *     summary: Total unread message count across all conversations
 *     tags: [Chat]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ count: number }" }
 */
exports.getUnreadCount = async (req, res, next) => {
  try {
    const count = await chat.getUnreadCount(req.user);
    return response.success(res, 'Unread count', { count });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/chat/upload:
 *   post:
 *     summary: Upload a chat attachment (image / document) to S3
 *     tags: [Chat]
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
 *       200: { description: "{ url, name, type }" }
 *       400: { description: No file / invalid type }
 */
exports.uploadAttachment = async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return response.badRequest(res, 'No file uploaded');
    const url = await uploadToS3(file, 'chat');
    return response.success(res, 'File uploaded', {
      url,
      name: file.originalname,
      type: file.mimetype,
      size: file.size,
    });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/chat/conversations/{id}:
 *   delete:
 *     summary: Archive a conversation (hidden for me only)
 *     tags: [Chat]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Archived }
 *       403: { description: Not a participant }
 */
exports.archiveConversation = async (req, res, next) => {
  try {
    await chat.archiveConversation(req.user, req.params.id);
    return response.success(res, 'Conversation archived');
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    next(err);
  }
};
