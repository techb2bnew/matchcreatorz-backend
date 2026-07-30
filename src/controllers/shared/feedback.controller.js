'use strict';
const { Feedback, User } = require('../../models');
const response = require('../../helpers/response.helper');
const notify   = require('../../helpers/notification.helper');
const email    = require('../../helpers/email.helper');

/**
 * @swagger
 * /api/v1/seller/feedback:
 *   post:
 *     summary: Send feedback to the platform team
 *     description: Saved to the database and emailed to the platform admin.
 *     tags: [Seller - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               subject: { type: string }
 *               message: { type: string }
 *     responses:
 *       201: { description: Feedback submitted }
 *       400: { description: Message is required }
 *
 * @swagger
 * /api/v1/buyer/feedback:
 *   post:
 *     summary: Send feedback to the platform team
 *     description: Saved to the database and emailed to the platform admin.
 *     tags: [Buyer - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               subject: { type: string }
 *               message: { type: string }
 *     responses:
 *       201: { description: Feedback submitted }
 *       400: { description: Message is required }
 */
exports.sendFeedback = async (req, res, next) => {
  try {
    const { subject, message } = req.body;
    if (!message || !message.trim())
      return response.badRequest(res, 'message is required');

    const feedback = await Feedback.create({
      user_id: req.user.id,
      role:    req.user.role,
      subject: subject ? subject.trim() : null,
      message: message.trim(),
    });

    const [me, admin] = await Promise.all([
      User.findByPk(req.user.id, { attributes: ['id', 'name'] }),
      User.findOne({ where: { role: 'ADMIN' }, order: [['id', 'ASC']], attributes: ['id', 'email'] }),
    ]);

    notify.feedbackReceived(me && me.name, feedback);
    if (admin && admin.email) {
      email.sendFeedbackReceived(admin.email, (me && me.name) || 'A user', req.user.role, feedback.subject, feedback.message)
        .catch((err) => console.error('sendFeedbackReceived email failed:', err.message));
    }

    return response.created(res, 'Feedback submitted — thank you!', feedback);
  } catch (err) { next(err); }
};
