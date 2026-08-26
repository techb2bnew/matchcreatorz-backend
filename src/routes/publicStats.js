'use strict';
const router = require('express').Router();
const { Op, fn, col, literal } = require('sequelize');
const { User, SellerProfile, Review, Bid, Job, Booking, Page, Service, Category } = require('../models/index');
const response = require('../helpers/response.helper');
const cache    = require('../helpers/cache.helper');

/**
 * @swagger
 * tags:
 *   name: Platform Stats (Public)
 *   description: Public, aggregate marketing stats — no auth required
 *
 * /api/v1/public/stats:
 *   get:
 *     summary: Platform-wide stats (creators, projects, average rating, satisfaction, avg bids per job)
 *     tags: [Platform Stats (Public)]
 *     security: []
 *     responses:
 *       200:
 *         description: Aggregate platform stats
 */
router.get('/stats', async (req, res, next) => {
  try {
    const cached = cache.get('public_platform_stats');
    if (cached) return response.success(res, 'Platform stats', cached);

    const [totalCreators, ratingRow, totalReviews, satisfiedReviews, totalBids, jobsWithBids, totalProjects] = await Promise.all([
      User.count({
        where: { role: 'SELLER' },
        include: [{ model: SellerProfile, as: 'sellerProfile', where: { approval_status: 'approved' }, attributes: [] }],
      }),
      Review.findOne({ attributes: [[fn('AVG', col('rating')), 'avg']], where: { status: 'published' }, raw: true }),
      Review.count({ where: { status: 'published' } }),
      Review.count({ where: { status: 'published', rating: { [Op.gte]: 4 } } }),
      Bid.count(),
      Job.count({ where: { bids_count: { [Op.gt]: 0 } }, paranoid: false }).catch(() => 0),
      Booking.count(),
    ]);

    const result = {
      total_creators:     totalCreators,
      total_projects:     totalProjects,
      avg_rating:         ratingRow?.avg ? Math.round(Number(ratingRow.avg) * 10) / 10 : 0,
      satisfaction_pct:   totalReviews > 0 ? Math.round((satisfiedReviews / totalReviews) * 100) : 0,
      avg_bids_per_job:   jobsWithBids > 0 ? Math.round((totalBids / jobsWithBids) * 10) / 10 : 0,
    };

    cache.set('public_platform_stats', result, 300); // 5 min cache — marketing numbers, not real-time critical
    return response.success(res, 'Platform stats', result);
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/public/jobs:
 *   get:
 *     summary: Browse open jobs (no auth) — most recent first
 *     tags: [Platform Stats (Public)]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by title, description, category, or skills
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Filter by category name (partial match)
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of open jobs, newest first
 */
router.get('/jobs', async (req, res, next) => {
  try {
    const { search, category, page = 1, limit = 20 } = req.query;
    const where = { status: 'OPEN' };

    if (search && search.trim()) {
      const term = search.trim();
      const safe = term.replace(/'/g, "''");
      where[Op.or] = [
        { title:       { [Op.iLike]: `%${term}%` } },
        { description: { [Op.iLike]: `%${term}%` } },
        { category:    { [Op.iLike]: `%${term}%` } },
        literal(`CAST("Job"."skills" AS TEXT) ILIKE '%${safe}%'`),
      ];
    }
    if (category && category !== 'All') {
      where.category = { [Op.iLike]: `%${category.trim()}%` };
    }

    const offset = (Number(page) - 1) * Number(limit);
    const { count, rows } = await Job.findAndCountAll({
      where,
      attributes: ['id', 'title', 'description', 'category', 'job_type', 'budget_min', 'budget_max',
                   'deadline', 'skills', 'experience_level', 'status', 'bids_count', 'created_at'],
      include: [{ model: User, as: 'buyer', attributes: ['id', 'name'] }],
      order:   [['created_at', 'DESC']],
      limit:   Number(limit),
      offset,
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
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/public/services:
 *   get:
 *     summary: Browse active seller services (no auth)
 *     tags: [Platform Stats (Public)]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Case-insensitive search in title, description, tags, seller name, or price
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Filter by category name (partial match)
 *       - in: query
 *         name: price_min
 *         schema: { type: number }
 *       - in: query
 *         name: price_max
 *         schema: { type: number }
 *       - in: query
 *         name: rating
 *         schema: { type: number }
 *         description: Minimum rating (e.g. 4 or 4.5)
 *       - in: query
 *         name: delivery_days
 *         schema: { type: integer }
 *         description: Maximum delivery days
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [relevance, price_asc, price_desc, best_rated] }
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
router.get('/services', async (req, res, next) => {
  try {
    const {
      search, category,
      price_min, price_max,
      rating, delivery_days,
      sort = 'relevance',
      page = 1, limit = 12,
    } = req.query;

    const where = { status: 'active' };

    if (search && search.trim()) {
      const term = search.trim();
      const safe = term.replace(/'/g, "''");
      where[Op.or] = [
        { title:            { [Op.iLike]: `%${term}%` } },
        { description:      { [Op.iLike]: `%${term}%` } },
        { '$seller.name$':  { [Op.iLike]: `%${term}%` } },
        literal(`EXISTS (SELECT 1 FROM jsonb_array_elements_text("Service"."tags") t WHERE t ILIKE '%${safe}%')`),
        literal(`"Service"."price"::text ILIKE '%${safe}%'`),
      ];
    }

    if (price_min) where.price = { ...where.price, [Op.gte]: Number(price_min) };
    if (price_max) where.price = { ...where.price, [Op.lte]: Number(price_max) };
    if (rating)    where.rating        = { [Op.gte]: Number(rating) };
    if (delivery_days) where.delivery_days = { [Op.lte]: Number(delivery_days) };

    const categoryWhere = {};
    if (category && category !== 'All') {
      categoryWhere.name = { [Op.iLike]: `%${category.trim()}%` };
    }

    const orderMap = {
      relevance:  [['created_at', 'DESC']],
      price_asc:  [['price', 'ASC']],
      price_desc: [['price', 'DESC']],
      best_rated: [['rating', 'DESC']],
    };
    const order = orderMap[sort] || orderMap.relevance;

    const offset = (Number(page) - 1) * Number(limit);
    const { count, rows } = await Service.findAndCountAll({
      where,
      include: [
        {
          model:      User,
          as:         'seller',
          attributes: ['id', 'name', 'preferences'],
          required:   true,
          // Respect seller "Profile Visibility" — hide services of sellers who turned it off
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

    // Respect seller "Show Ratings" preference, and never leak raw preferences publicly
    const data = rows.map((r) => {
      const j = r.toJSON();
      const showRating = j.seller?.preferences?.privacy?.showRating;
      if (showRating === false) {
        j.rating = null;
        j.reviews_count = 0;
      }
      if (j.seller) delete j.seller.preferences;
      return j;
    });

    return response.paginate(res, 'Services fetched', data, {
      total: count,
      page:  Number(page),
      limit: Number(limit),
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/public/sellers:
 *   get:
 *     summary: Browse approved sellers/creators (no auth)
 *     tags: [Platform Stats (Public)]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Case-insensitive search in name, bio, or skills
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: Paginated list of approved sellers
 */
router.get('/sellers', async (req, res, next) => {
  try {
    const { search, page = 1, limit = 12 } = req.query;

    const userWhere = { role: 'SELLER', status: 'active' };
    if (search && search.trim()) {
      const term = search.trim();
      const safe = term.replace(/'/g, "''");
      userWhere[Op.or] = [
        { name: { [Op.iLike]: `%${term}%` } },
        literal(`"sellerProfile"."bio" ILIKE '%${safe}%'`),
        literal(`EXISTS (SELECT 1 FROM unnest("sellerProfile"."skills") s WHERE s ILIKE '%${safe}%')`),
      ];
    }

    const offset = (Number(page) - 1) * Number(limit);
    const { count, rows } = await User.findAndCountAll({
      where: userWhere,
      attributes: ['id', 'name', 'avatar', 'preferences', 'created_at'],
      include: [{
        model:      SellerProfile,
        as:         'sellerProfile',
        required:   true,
        where: {
          approval_status: 'approved',
          // Respect seller "Profile Visibility" — same toggle used on services
          [Op.and]: literal(`COALESCE("User"."preferences"->'privacy'->>'showProfile', 'true') <> 'false'`),
        },
        attributes: ['bio', 'skills', 'hourly_rate', 'rating', 'total_reviews',
                     'portfolio_links', 'profile_image', 'is_available'],
      }],
      order:    [['created_at', 'DESC']],
      limit:    Number(limit),
      offset,
      distinct: true,
      subQuery: false,
    });

    // Respect seller "Show Ratings" preference, and never leak raw preferences publicly
    const data = rows.map((r) => {
      const j = r.toJSON();
      const showRating = j.preferences?.privacy?.showRating;
      if (showRating === false && j.sellerProfile) {
        j.sellerProfile.rating = null;
        j.sellerProfile.total_reviews = 0;
      }
      delete j.preferences;
      return j;
    });

    return response.paginate(res, 'Sellers fetched', data, {
      total: count,
      page:  Number(page),
      limit: Number(limit),
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/public/pages/{slug}:
 *   get:
 *     summary: Get a static page's content by slug (about, privacy, terms, faq, contact)
 *     tags: [Platform Stats (Public)]
 *     security: []
 *     parameters: [{ in: path, name: slug, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Page content }
 *       404: { description: Page not found }
 */
router.get('/pages/:slug', async (req, res, next) => {
  try {
    const page = await Page.findOne({ where: { slug: req.params.slug } });
    if (!page) return response.notFound(res, 'Page not found');
    return response.success(res, 'Page fetched', page);
  } catch (err) { next(err); }
});

module.exports = router;
