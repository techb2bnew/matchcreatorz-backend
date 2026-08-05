'use strict';
const { Op, literal }                    = require('sequelize');
const { Service, User, Category }        = require('../../models');
const response                           = require('../../helpers/response.helper');

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
 *         description: Case-insensitive search in title, description, tags, seller name
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
      id, search, category,
      price_min, price_max,
      rating, delivery_days,
      sort = 'relevance',
      page = 1, limit = 12,
    } = req.query;

    // -- Service WHERE -------------------------------------------------
    const where = { status: 'active' };

    if (id) where.id = Number(id);

    if (search && search.trim()) {
      const term = search.trim();
      const safe = term.replace(/'/g, "''");   // escape single quotes for the raw literal
      where[Op.or] = [
        { title:            { [Op.iLike]: `%${term}%` } },
        { description:      { [Op.iLike]: `%${term}%` } },
        { '$seller.name$':  { [Op.iLike]: `%${term}%` } },
        // searchable tags (tags stored as JSONB array of strings)
        literal(`EXISTS (SELECT 1 FROM jsonb_array_elements_text("Service"."tags") t WHERE t ILIKE '%${safe}%')`),
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
          attributes: ['id', 'name', 'preferences'],
          required:   true,
          // Respect seller "Profile Visibility" — hide services of sellers who turned it off.
          // Included unless preferences.privacy.showProfile is explicitly false.
          where: literal(`COALESCE("seller"."preferences"->'privacy'->>'showProfile', 'true') <> 'false'`),
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
      limit:    Number(limit),
      offset,
      distinct: true,
      subQuery: false,
    });

    // Respect seller "Show Ratings" — hide rating on services whose seller opted out
    const data = rows.map((r) => {
      const j = r.toJSON();
      const showRating = j.seller?.preferences?.privacy?.showRating;
      if (showRating === false) {
        j.rating = null;
        j.reviews_count = 0;
      }
      if (j.seller) delete j.seller.preferences; // don't leak prefs to buyers
      return j;
    });

    return response.paginate(res, 'Services fetched', data, {
      total: count,
      page:  Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error('searchServices:', err);
    return response.serverError(res, 'Server error');
  }
};
