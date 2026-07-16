'use strict';
const { Op }   = require('sequelize');
const { Job, User, Bid } = require('../../models');
const response = require('../../helpers/response.helper');

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
      where[Op.or] = [
        { title:       { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
        { category:    { [Op.iLike]: `%${search}%` } },
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

    return response.success(res, 'Jobs fetched', rows, {
      total: count,
      page,
      limit,
      pages: Math.ceil(count / limit),
    });
  } catch (err) { next(err); }
};

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

// ── Close job ─────────────────────────────────────────────────────────
exports.closeJob = async (req, res, next) => {
  try {
    const job = await Job.findByPk(req.params.id, { paranoid: false });
    if (!job) return response.notFound(res, 'Job not found');
    await job.update({ status: 'CLOSED' });
    return response.success(res, 'Job closed', job);
  } catch (err) { next(err); }
};

// ── Delete job ────────────────────────────────────────────────────────
exports.deleteJob = async (req, res, next) => {
  try {
    const job = await Job.findByPk(req.params.id, { paranoid: false });
    if (!job) return response.notFound(res, 'Job not found');
    await job.destroy();
    return response.success(res, 'Job deleted');
  } catch (err) { next(err); }
};
