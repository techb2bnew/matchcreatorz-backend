'use strict';
const router = require('express').Router();
const { Banner } = require('../models/index');
const response  = require('../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: Banners (Public)
 *   description: Active promotional banners shown across the app (seller/admin dashboards, etc.) — no auth required
 *
 * /api/v1/banners:
 *   get:
 *     summary: List active banners
 *     tags: [Banners (Public)]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: position
 *         schema: { type: string, example: "Home Top" }
 *         description: Optional — filter to a single placement. Omit to get all active banners.
 *     responses:
 *       200: { description: Active banners returned }
 */
router.get('/', async (req, res, next) => {
  try {
    const { position } = req.query;
    const where = { is_active: true };
    if (position) where.position = position;

    const banners = await Banner.findAll({
      where,
      attributes: ['id', 'title', 'image_url', 'link_url', 'position', 'display_order'],
      order: [['display_order', 'ASC'], ['created_at', 'DESC']],
    });
    return response.success(res, 'Banners fetched', banners);
  } catch (err) { next(err); }
});

module.exports = router;
