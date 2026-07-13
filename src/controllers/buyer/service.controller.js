'use strict';
const { Op }                             = require('sequelize');
const { Service, User, Category }        = require('../../models');

/**
 * @swagger
 * /api/v1/buyer/services:
 *   get:
 *     summary: Search / browse active services
 *     tags: [Buyer - Services]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Case-insensitive search in title, description, tags
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Filter by category name (partial match)
 *       - in: query
 *         name: price_min
 *         schema: { type: number }
 *         description: Minimum price filter
 *       - in: query
 *         name: price_max
 *         schema: { type: number }
 *         description: Maximum price filter
 *       - in: query
 *         name: rating
 *         schema: { type: number }
 *         description: Minimum rating (e.g. 4 or 4.5)
 *       - in: query
 *         name: delivery_days
 *         schema: { type: integer }
 *         description: Maximum delivery days (e.g. 1, 3, 7)
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [relevance, price_asc, price_desc, best_rated] }
 *         description: Sort order
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: Paginated list of active services
 */
exports.searchServices = async (req, res) => {
  try {
    const {
      search, category,
      price_min, price_max,
      rating, delivery_days,
      sort = 'relevance',
      page = 1, limit = 12,
    } = req.query;

    // -- Service WHERE -------------------------------------------------
    const where = { status: 'active' };

    if (search && search.trim()) {
      where[Op.or] = [
        { title:       { [Op.iLike]: `%${search.trim()}%` } },
        { description: { [Op.iLike]: `%${search.trim()}%` } },
      ];
    }

    if (price_min) where.price = { ...where.price, [Op.gte]: Number(price_min) };
    if (price_max) where.price = { ...where.price, [Op.lte]: Number(price_max) };
    if (rating)    where.rating        = { [Op.gte]: Number(rating) };
    if (delivery_days) where.delivery_days = { [Op.lte]: Number(delivery_days) };

    // -- Category filter (by name) ------------------------------------
    const categoryWhere = {};
    if (category && category !== 'All') {
      categoryWhere.name = { [Op.iLike]: `%${category.trim()}%` };
    }

    // -- Sort ---------------------------------------------------------
    const orderMap = {
      relevance:  [['created_at', 'DESC']],
      price_asc:  [['price', 'ASC']],
      price_desc: [['price', 'DESC']],
      best_rated: [['rating', 'DESC']],
    };
    const order = orderMap[sort] || orderMap.relevance;

    // -- Query --------------------------------------------------------
    const offset = (Number(page) - 1) * Number(limit);
    const { count, rows } = await Service.findAndCountAll({
      where,
      include: [
        {
          model:      User,
          as:         'seller',
          attributes: ['id', 'name'],
        },
        {
          model:      Category,
          as:         'category',
          attributes: ['id', 'name'],
          where:      Object.keys(categoryWhere).length ? categoryWhere : undefined,
          required:   Object.keys(categoryWhere).length > 0,
        },
      ],
      order,
      limit:  Number(limit),
      offset,
      distinct: true,
    });

    return res.json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page:  Number(page),
        limit: Number(limit),
        pages: Math.ceil(count / Number(limit)),
      },
    });
  } catch (err) {
    console.error('searchServices:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
