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
 *     summary: List all categories
 *     tags: [Categories (Public)]
 *     security: []
 *     responses:
 *       200:
 *         description: All categories returned
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
 *                       name: { type: string,  example: "Design" }
 *                       icon: { type: string,  example: "fa-paint-brush" }
 */
router.get('/', async (req, res, next) => {
  try {
    const cats = await Category.findAll({
      attributes: ['id', 'name', 'icon'],
      order: [['name', 'ASC']],
    });
    return response.success(res, 'Categories fetched', cats);
  } catch (err) { next(err); }
});

module.exports = router;
