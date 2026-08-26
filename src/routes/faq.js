'use strict';
const router = require('express').Router();
const { Faq } = require('../models/index');
const response = require('../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: FAQ (Public)
 *   description: Public FAQ list — no auth required
 *
 * /api/v1/faq:
 *   get:
 *     summary: List all FAQ question/answer pairs, in display order
 *     tags: [FAQ (Public)]
 *     security: []
 *     responses:
 *       200:
 *         description: FAQ list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:       { type: integer, example: 1 }
 *                       question: { type: string, example: "How do payments work?" }
 *                       answer:   { type: string, example: "Payment is released once you approve the delivered work." }
 */
router.get('/', async (req, res, next) => {
  try {
    const faqs = await Faq.findAll({
      attributes: ['id', 'question', 'answer'],
      order: [['position', 'ASC'], ['id', 'ASC']],
    });
    return response.success(res, 'FAQ fetched', faqs);
  } catch (err) { next(err); }
});

module.exports = router;
