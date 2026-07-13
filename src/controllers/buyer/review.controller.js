'use strict';
const svc      = require('../../services/buyer/review.service');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * /api/v1/buyer/reviews:
 *   post:
 *     summary: Submit a review for a completed booking
 *     tags: [Buyer - Reviews]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [booking_id, rating]
 *             properties:
 *               booking_id: { type: integer }
 *               rating:     { type: integer, minimum: 1, maximum: 5 }
 *               comment:    { type: string }
 *     responses:
 *       201: { description: Review submitted }
 *       400: { description: Booking not completed or already reviewed }
 *       404: { description: Booking not found }
 */
const createReview = async (req, res, next) => {
  try {
    const data = await svc.createReview(req.user.id, req.body);
    return response.created(res, 'Review submitted successfully', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/buyer/reviews:
 *   get:
 *     summary: List reviews given by this buyer
 *     tags: [Buyer - Reviews]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: List of reviews }
 */
const listReviews = async (req, res, next) => {
  try {
    const result = await svc.listMyReviews(req.user.id, req.query);
    return response.paginate(res, 'Reviews fetched', result.reviews, {
      page: result.page, limit: result.limit, total: result.total,
    });
  } catch (err) { next(err); }
};

module.exports = { createReview, listReviews };
