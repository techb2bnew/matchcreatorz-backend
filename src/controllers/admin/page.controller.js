'use strict';
const { Page } = require('../../models');
const response = require('../../helpers/response.helper');

// Fixed set of static pages the app ships with. Seeded lazily on first read
// so there's no separate migration step — editable, but not creatable/deletable
// from the admin UI (matches the original fixed-slug design).
const DEFAULT_PAGES = [
  { slug: 'about',   title: 'About Us',
    content: 'We are MatchCreatorz, a platform connecting talented creators with businesses worldwide. Our mission is to make creative work accessible and affordable.' },
  { slug: 'privacy', title: 'Privacy Policy',
    content: 'Your privacy is important to us. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our platform.' },
  { slug: 'terms',   title: 'Terms of Service',
    content: 'By accessing and using MatchCreatorz, you accept and agree to be bound by the terms and provision of this agreement.' },
  { slug: 'faq',     title: 'FAQ',
    content: 'Frequently Asked Questions about MatchCreatorz. Find answers to common questions about payments, bookings, connects, and more.' },
  { slug: 'contact', title: 'Contact Us',
    content: 'Get in touch with our support team. Email: support@matchcreatorz.com' },
];

const ensureSeeded = async () => {
  const existing = await Page.findAll({ attributes: ['slug'] });
  const existingSlugs = new Set(existing.map((p) => p.slug));
  const missing = DEFAULT_PAGES.filter((p) => !existingSlugs.has(p.slug));
  if (missing.length) await Page.bulkCreate(missing);
};
exports.ensureSeeded = ensureSeeded; // reused by the public (no-auth) pages route

/**
 * @swagger
 * tags:
 *   name: Admin - Pages
 *   description: Static marketing/legal page content (About, Privacy, Terms, FAQ, Contact)
 *
 * /api/v1/admin/pages:
 *   get:
 *     summary: List all static pages
 *     tags: [Admin - Pages]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: All pages } }
 */
exports.listPages = async (req, res, next) => {
  try {
    await ensureSeeded();
    const pages = await Page.findAll({ order: [['id', 'ASC']] });
    return response.success(res, 'Pages fetched', pages);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/pages/{id}:
 *   put:
 *     summary: Update a static page's title/content
 *     tags: [Admin - Pages]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: integer } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:   { type: string }
 *               content: { type: string }
 *     responses:
 *       200: { description: Page updated }
 *       404: { description: Page not found }
 */
exports.updatePage = async (req, res, next) => {
  try {
    const page = await Page.findByPk(req.params.id);
    if (!page) return response.notFound(res, 'Page not found');

    const { title, content } = req.body;
    const patch = {};
    if (title !== undefined)   patch.title = title.trim();
    if (content !== undefined) patch.content = content;

    await page.update(patch);
    return response.success(res, 'Page updated', page);
  } catch (err) { next(err); }
};
