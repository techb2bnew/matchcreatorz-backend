'use strict';
const router = require('express').Router();
const { Category } = require('../models/index');
const response     = require('../helpers/response.helper');

/**
 * GET /api/v1/categories
 * Public — no auth required.
 * Returns all categories (id, name, icon) sorted by name.
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
