'use strict';
const { Op, literal } = require('sequelize');
const { Job, User, Bid } = require('../../models');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: Admin - Jobs
 *   description: Admin job moderation & management
 */

/**
 * @swagger
 * /api/v1/admin/jobs:
 *   get:
 *     summary: List all jobs (admin)
 *     tags: [Admin - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by title, description or category
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [OPEN, IN_PROGRESS, CLOSED, CANCELLED] }
 *         description: Filter by job status
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Paginated list of jobs with buyer info
 */
// ── List all jobs ──────────────────────────────────────────────────────
exports.listJobs = async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;
    const { search, status } = req.query;

    const where = {};
    if (status) where.status = status;
    if (search) {
      const safe = String(search).replace(/'/g, "''");
      where[Op.or] = [
        { title:       { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
        { category:    { [Op.iLike]: `%${search}%` } },
        literal(`CAST("Job"."skills" AS TEXT) ILIKE '%${safe}%'`),
      ];
    }

    const { rows, count } = await Job.findAndCountAll({
      where,
      include: [
        { model: User, as: 'buyer', attributes: ['id', 'name', 'email'] },
      ],
      order:   [['created_at', 'DESC']],
      limit,
      offset,
      paranoid: false,
    });

    return response.paginate(res, 'Jobs fetched', rows, { total: count, page, limit });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/jobs/{id}:
 *   get:
 *     summary: Get a single job with its bids (admin)
 *     tags: [Admin - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Job detail with buyer and all bids (incl. seller info)
 *       404:
 *         description: Job not found
 */
// ── Get single job with bids ───────────────────────────────────────────
exports.getJob = async (req, res, next) => {
  try {
    const job = await Job.findByPk(req.params.id, {
      include: [
        { model: User, as: 'buyer', attributes: ['id', 'name', 'email'] },
        {
          model: Bid,
          as:    'bids',
          include: [{ model: User, as: 'seller', attributes: ['id', 'name', 'email'] }],
          paranoid: false,
        },
      ],
      paranoid: false,
    });
    if (!job) return response.notFound(res, 'Job not found');
    return response.success(res, 'Job fetched', job);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/jobs/{id}/close:
 *   patch:
 *     summary: Close a job to stop new bids (admin)
 *     tags: [Admin - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Job closed
 *       404:
 *         description: Job not found
 */
// ── Close job ─────────────────────────────────────────────────────────
exports.closeJob = async (req, res, next) => {
  try {
    const job = await Job.findByPk(req.params.id, { paranoid: false });
    if (!job) return response.notFound(res, 'Job not found');
    await job.update({ status: 'CLOSED' });
    return response.success(res, 'Job closed', job);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/jobs/{id}:
 *   delete:
 *     summary: Delete a job (admin)
 *     tags: [Admin - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Job deleted
 *       404:
 *         description: Job not found
 */
// ── Delete job ────────────────────────────────────────────────────────
exports.deleteJob = async (req, res, next) => {
  try {
    const job = await Job.findByPk(req.params.id, { paranoid: false });
    if (!job) return response.notFound(res, 'Job not found');
    await job.destroy();
    return response.success(res, 'Job deleted');
  } catch (err) { next(err); }
};
