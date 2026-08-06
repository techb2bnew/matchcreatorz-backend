'use strict';
const { Op, literal } = require('sequelize');
const { Job, User, Bid } = require('../../models');
const response = require('../../helpers/response.helper');
const { stripHtml } = require('../../helpers/text.helper');

/**
 * @swagger
 * tags:
 *   name: Admin - Jobs
 *   description: Admin job moderation & management
 */

// Whitelist of columns the grid may sort by, mapped to a Sequelize order path.
const SORT_FIELDS = {
  title:  ['title'],
  buyer:  [{ model: User, as: 'buyer' }, 'name'],
  budget: ['budget_min'],
  bids:   ['bids_count'],
  status: ['status'],
  date:   ['created_at'],
};

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
 *         description: Search by title, description, category, buyer name, skills, budget, bids, status, or date
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
    const { search, status, sortBy, sortDir } = req.query;

    const where = {};
    if (status) where.status = status;
    if (search) {
      const term = String(search).trim();
      const safe = term.replace(/'/g, "''");
      where[Op.or] = [
        { title:            { [Op.iLike]: `%${term}%` } },
        { description:      { [Op.iLike]: `%${term}%` } },
        { category:         { [Op.iLike]: `%${term}%` } },
        { '$buyer.name$':   { [Op.iLike]: `%${term}%` } },
        literal(`CAST("Job"."skills" AS TEXT) ILIKE '%${safe}%'`),
        // `status` is a Postgres ENUM and budget_min/max are numeric — ILIKE
        // needs an explicit ::text cast on all three, or Postgres errors
        // ("operator does not exist") rather than just not matching.
        literal(`"Job"."status"::text ILIKE '%${safe}%'`),
        literal(`"Job"."budget_min"::text ILIKE '%${safe}%'`),
        literal(`"Job"."budget_max"::text ILIKE '%${safe}%'`),
        literal(`"Job"."bids_count"::text ILIKE '%${safe}%'`),
      ];

      // Support matching by the date shown in the grid (e.g. "Aug 3, 2026").
      const parsedDate = new Date(term);
      if (!isNaN(parsedDate.getTime())) {
        const dayStart = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
        const dayEnd   = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        where[Op.or].push({ createdAt: { [Op.gte]: dayStart, [Op.lt]: dayEnd } });
      }
    }

    const sortPath  = SORT_FIELDS[sortBy] || SORT_FIELDS.date;
    const direction = sortDir === 'asc' ? 'ASC' : 'DESC';

    const { rows, count } = await Job.findAndCountAll({
      where,
      include: [
        { model: User, as: 'buyer', attributes: ['id', 'name', 'email'] },
      ],
      order:    [[...sortPath, direction]],
      limit,
      offset,
      paranoid: false,
      distinct: true,
      subQuery: false,
    });

    const data = rows.map((r) => {
      const j = r.toJSON();
      j.description = stripHtml(j.description);
      // Sequelize's JS attribute is `createdAt` even though the DB column
      // (and this query's own `order`) is `created_at` — remap so the
      // frontend's `created_at` field is actually populated instead of undefined.
      j.created_at = r.createdAt;
      return j;
    });

    return response.paginate(res, 'Jobs fetched', data, { total: count, page, limit });
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
