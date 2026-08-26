'use strict';
const router = require('express').Router();
const { Category } = require('../models/index');
const response     = require('../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: Categories (Public)
 *   description: Public category listing — no auth required
 *
 * /api/v1/categories:
 *   get:
 *     summary: List all categories, each with its subcategories
 *     tags: [Categories (Public)]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: |
 *           Case-insensitive match against a category's own name OR any of its
 *           subcategory names. If the category name itself matches, all of its
 *           subcategories are returned; if only some subcategories match, just
 *           those are returned (nested under their parent).
 *     responses:
 *       200:
 *         description: Categories returned, each with a nested subcategories array
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:   { type: integer, example: 1 }
 *                       name: { type: string,  example: "Development & IT" }
 *                       icon: { type: string,  example: "💻" }
 *                       subcategories:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             id:   { type: integer, example: 42 }
 *                             name: { type: string,  example: "React.js Developer" }
 *                             icon: { type: string, nullable: true }
 */
router.get('/', async (req, res, next) => {
  try {
    const cats = await Category.findAll({
      where: { parent_id: null },
      attributes: ['id', 'name', 'icon'],
      include: [{
        model: Category, as: 'subcategories', separate: true,
        attributes: ['id', 'name', 'icon'], order: [['name', 'ASC']],
      }],
      order: [['name', 'ASC']],
    });

    const term = req.query.search && req.query.search.trim();
    if (!term) return response.success(res, 'Categories fetched', cats);

    // Small dataset (a few hundred rows total across all categories +
    // subcategories) — filtering in JS after one query is simpler and safer
    // than building a raw SQL search, and plenty fast at this scale.
    const lower = term.toLowerCase();
    const filtered = cats
      .map((c) => c.toJSON())
      .map((c) => {
        const parentMatches = c.name.toLowerCase().includes(lower);
        if (parentMatches) return c; // whole category, every subcategory included
        const matchingSubs = c.subcategories.filter((s) => s.name.toLowerCase().includes(lower));
        return matchingSubs.length ? { ...c, subcategories: matchingSubs } : null;
      })
      .filter(Boolean);

    return response.success(res, 'Categories fetched', filtered);
  } catch (err) { next(err); }
});

module.exports = router;
