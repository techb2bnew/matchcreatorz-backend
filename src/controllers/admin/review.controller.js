'use strict';
const svc      = require('../../services/admin/review.service');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * /api/v1/admin/reviews:
 *   get:
 *     summary: List all reviews with search and status filter
 *     tags: [Admin - Reviews]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by comment text
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [published, hidden] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Paginated list with summary stats }
 */
const listReviews = async (req, res, next) => {
  try {
    const result = await svc.listAllReviews(req.query);
    return res.json({
      success:    true,
      message:    'Reviews fetched',
      data:       result.reviews,
      summary:    result.summary,
      pagination: {
        total: result.total,
        page:  result.page,
        limit: result.limit,
        pages: Math.ceil(result.total / result.limit),
      },
    });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/reviews/{id}/publish:
 *   patch:
 *     summary: Publish a hidden review
 *     tags: [Admin - Reviews]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Review published }
 *       404: { description: Review not found }
 */
const publishReview = async (req, res, next) => {
  try {
    const data = await svc.publishReview(req.params.id);
    return response.success(res, 'Review published', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/reviews/{id}/hide:
 *   patch:
 *     summary: Hide a published review
 *     tags: [Admin - Reviews]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Review hidden }
 *       404: { description: Review not found }
 */
const hideReview = async (req, res, next) => {
  try {
    const data = await svc.hideReview(req.params.id);
    return response.success(res, 'Review hidden', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/reviews/{id}:
 *   delete:
 *     summary: Permanently delete a review
 *     tags: [Admin - Reviews]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Review deleted }
 *       404: { description: Review not found }
 */
const deleteReview = async (req, res, next) => {
  try {
    await svc.deleteReview(req.params.id);
    return response.success(res, 'Review deleted');
  } catch (err) { next(err); }
};

module.exports = { listReviews, publishReview, hideReview, deleteReview };
