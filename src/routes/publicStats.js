'use strict';
const router = require('express').Router();
const { Op, fn, col } = require('sequelize');
const { User, SellerProfile, Review, Bid, Job, Booking, Page } = require('../models/index');
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
