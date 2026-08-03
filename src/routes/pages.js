'use strict';
const router = require('express').Router();
const { Page } = require('../models/index');
const response = require('../helpers/response.helper');
const { ensureSeeded } = require('../controllers/admin/page.controller');

/**
 * @swagger
 * tags:
 *   name: Pages (Public)
 *   description: Public static page content (About, Privacy, Terms, FAQ, Contact) — no auth required
 *
 * /api/v1/pages/{slug}:
 *   get:
 *     summary: Get a static page's content by slug
 *     tags: [Pages (Public)]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string, enum: [about, privacy, terms, faq, contact] }
 *     responses:
 *       200: { description: "{ slug, title, content }" }
 *       404: { description: Page not found }
 */
router.get('/:slug', async (req, res, next) => {
  try {
    await ensureSeeded();
    const page = await Page.findOne({
      where: { slug: req.params.slug },
      attributes: ['slug', 'title', 'content', 'updatedAt'],
    });
    if (!page) return response.notFound(res, 'Page not found');
    return response.success(res, 'Page fetched', page);
  } catch (err) { next(err); }
});

module.exports = router;
