'use strict';
const router = require('express').Router();
const { NewsletterSubscriber } = require('../models/index');
const response = require('../helpers/response.helper');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @swagger
 * tags:
 *   name: Newsletter (Public)
 *   description: Public newsletter signup — no auth required
 *
 * /api/v1/newsletter/subscribe:
 *   post:
 *     summary: Subscribe an email to the newsletter
 *     tags: [Newsletter (Public)]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, example: "someone@example.com" }
 *     responses:
 *       201: { description: Subscribed }
 *       200: { description: Already subscribed — treated as success, not an error }
 *       400: { description: Invalid email }
 */
router.post('/subscribe', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email))
      return response.badRequest(res, 'Please enter a valid email address');

    const [, created] = await NewsletterSubscriber.findOrCreate({ where: { email } });
    return created
      ? response.created(res, 'Subscribed successfully')
      : response.success(res, 'You are already subscribed');
  } catch (err) { next(err); }
});

module.exports = router;
