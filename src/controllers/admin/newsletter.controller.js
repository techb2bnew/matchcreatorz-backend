'use strict';
const { Op } = require('sequelize');
const { NewsletterSubscriber } = require('../../models');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: Admin - Newsletter
 *   description: Manage emails collected from the public newsletter signup form
 *
 * /api/v1/admin/newsletter:
 *   get:
 *     summary: List newsletter subscribers (paginated + search)
 *     tags: [Admin - Newsletter]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by email
 *     responses:
 *       200: { description: Paginated subscriber list }
 */
exports.listSubscribers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const where = {};
    if (search && search.trim()) where.email = { [Op.iLike]: `%${search.trim()}%` };

    const offset = (Number(page) - 1) * Number(limit);
    const { rows, count } = await NewsletterSubscriber.findAndCountAll({
      where,
      order:  [['created_at', 'DESC']],
      limit:  Number(limit),
      offset,
    });

    return response.paginate(res, 'Subscribers fetched', rows, {
      page: Number(page), limit: Number(limit), total: count,
    });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/newsletter/{id}:
 *   delete:
 *     summary: Remove a subscriber
 *     tags: [Admin - Newsletter]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: integer } }]
 *     responses:
 *       200: { description: Subscriber removed }
 *       404: { description: Subscriber not found }
 */
exports.deleteSubscriber = async (req, res, next) => {
  try {
    const sub = await NewsletterSubscriber.findByPk(req.params.id);
    if (!sub) return response.notFound(res, 'Subscriber not found');
    await sub.destroy();
    return response.success(res, 'Subscriber removed', { deleted: true });
  } catch (err) { next(err); }
};
