'use strict';
const { Job, User, Bid } = require('../../models');
const { Op }             = require('sequelize');

// ── Browse open jobs ──────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/seller/jobs:
 *   get:
 *     summary: Browse all open jobs
 *     tags: [Seller - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by title or description
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Filter by category name
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of open jobs
 */
exports.browseJobs = async (req, res) => {
  try {
    const { search, category, page = 1, limit = 20 } = req.query;

    const where = { status: 'OPEN' };

    if (search && search.trim()) {
      where[Op.or] = [
        { title:       { [Op.iLike]: `%${search.trim()}%` } },
        { description: { [Op.iLike]: `%${search.trim()}%` } },
      ];
    }

    if (category && category !== 'All') {
      where.category = { [Op.iLike]: `%${category.trim()}%` };
    }

    const offset = (Number(page) - 1) * Number(limit);
    const { count, rows } = await Job.findAndCountAll({
      where,
      include: [{ model: User, as: 'buyer', attributes: ['id', 'name', 'email'] }],
      order:   [['created_at', 'DESC']],
      limit:   Number(limit),
      offset,
    });

    // Check if current seller has already bid on each job (include bid details)
    const jobIds = rows.map(j => j.id);
    const myBids = await Bid.findAll({
      where:      { seller_id: req.user.id, job_id: { [Op.in]: jobIds } },
      attributes: ['id', 'job_id', 'amount', 'delivery_days', 'proposal', 'status'],
    });
    const bidMap = new Map(myBids.map(b => [b.job_id, b]));

    const data = rows.map(j => ({
      ...j.toJSON(),
      has_bid: bidMap.has(j.id),
      my_bid:  bidMap.get(j.id) || null,
    }));

    return res.json({
      success: true,
      data,
      pagination: {
        total: count,
        page:  Number(page),
        limit: Number(limit),
        pages: Math.ceil(count / Number(limit)),
      },
    });
  } catch (err) {
    console.error('browseJobs:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get single job detail ─────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/seller/jobs/{id}:
 *   get:
 *     summary: Get a single open job detail
 *     tags: [Seller - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Job detail
 *       404:
 *         description: Not found
 */
exports.getJobDetail = async (req, res) => {
  try {
    const job = await Job.findOne({
      where:   { id: req.params.id, status: 'OPEN' },
      include: [{ model: User, as: 'buyer', attributes: ['id', 'name', 'email'] }],
    });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const myBid = await Bid.findOne({ where: { job_id: job.id, seller_id: req.user.id } });

    return res.json({ success: true, data: { ...job.toJSON(), has_bid: !!myBid, my_bid: myBid || null } });
  } catch (err) {
    console.error('getJobDetail:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Place a bid ───────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/seller/jobs/{id}/bid:
 *   post:
 *     summary: Place a bid on a job
 *     tags: [Seller - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, delivery_days]
 *             properties:
 *               amount:        { type: number }
 *               delivery_days: { type: integer }
 *               proposal:      { type: string }
 *     responses:
 *       201:
 *         description: Bid placed
 *       400:
 *         description: Already bid or job not open
 */
exports.placeBid = async (req, res) => {
  try {
    const job = await Job.findOne({ where: { id: req.params.id, status: 'OPEN' } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or not open' });

    const existing = await Bid.findOne({ where: { job_id: job.id, seller_id: req.user.id } });
    if (existing) return res.status(400).json({ success: false, message: 'You have already bid on this job' });

    const { amount, delivery_days, proposal } = req.body;
    if (!amount || !delivery_days)
      return res.status(400).json({ success: false, message: 'Amount and delivery days are required' });

    const bid = await Bid.create({
      job_id:        job.id,
      seller_id:     req.user.id,
      amount:        Number(amount),
      delivery_days: Number(delivery_days),
      proposal:      proposal || null,
      status:        'pending',
    });

    // Increment bids_count on job
    await job.increment('bids_count');

    return res.status(201).json({ success: true, message: 'Bid placed successfully', data: bid });
  } catch (err) {
    console.error('placeBid:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// -- Update an existing bid --------------------------------------------------
/**
 * @swagger
 * /api/v1/seller/jobs/{id}/bid:
 *   patch:
 *     summary: Update your existing bid on a job
 *     tags: [Seller - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Job ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:        { type: number, description: Updated bid amount }
 *               delivery_days: { type: integer, description: Updated delivery days }
 *               proposal:      { type: string, description: Updated proposal text }
 *     responses:
 *       200:
 *         description: Bid updated successfully
 *       404:
 *         description: Bid not found or job not open
 */
exports.updateBid = async (req, res) => {
  try {
    const job = await Job.findOne({ where: { id: req.params.id, status: 'OPEN' } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or not open' });

    const bid = await Bid.findOne({ where: { job_id: job.id, seller_id: req.user.id } });
    if (!bid) return res.status(404).json({ success: false, message: 'You have not bid on this job' });

    const { amount, delivery_days, proposal } = req.body;
    if (!amount || !delivery_days)
      return res.status(400).json({ success: false, message: 'Amount and delivery days are required' });

    await bid.update({
      amount:        Number(amount),
      delivery_days: Number(delivery_days),
      proposal:      proposal || bid.proposal,
    });

    return res.json({ success: true, message: 'Bid updated successfully', data: bid });
  } catch (err) {
    console.error('updateBid:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// -- Withdraw (delete) an existing bid ---------------------------------------
/**
 * @swagger
 * /api/v1/seller/jobs/{id}/bid:
 *   delete:
 *     summary: Withdraw your bid from a job
 *     tags: [Seller - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Bid withdrawn successfully
 *       404:
 *         description: Bid not found or job not open
 */
exports.withdrawBid = async (req, res) => {
  try {
    const job = await Job.findOne({ where: { id: req.params.id, status: 'OPEN' } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or not open' });

    const bid = await Bid.findOne({ where: { job_id: job.id, seller_id: req.user.id } });
    if (!bid) return res.status(404).json({ success: false, message: 'No bid found to withdraw' });

    await bid.destroy();
    if (job.bids_count > 0) await job.decrement('bids_count');

    return res.json({ success: true, message: 'Bid withdrawn successfully' });
  } catch (err) {
    console.error('withdrawBid:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// -- List seller's own bids ---------------------------------------------------
/**
 * @swagger
 * /api/v1/seller/bids:
 *   get:
 *     summary: List all bids placed by the logged-in seller
 *     tags: [Seller - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, accepted, rejected] }
 *         description: Filter by bid status
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of seller bids with job and buyer details
 */
exports.myBids = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const where = { seller_id: req.user.id };
    if (status) where.status = status;

    const offset = (Number(page) - 1) * Number(limit);

    const { count, rows } = await Bid.findAndCountAll({
      where,
      include: [
        {
          model: Job,
          as: 'job',
          attributes: ['id', 'title', 'budget_min', 'budget_max', 'bids_count', 'status', 'created_at'],
          include: [
            {
              model: User,
              as: 'buyer',
              attributes: ['id', 'name'],
            },
          ],
        },
      ],
      order: [['created_at', 'DESC']],
      limit: Number(limit),
      offset,
      distinct: true,
    });

    // Compute stats
    const allBids = await Bid.findAll({ where: { seller_id: req.user.id }, attributes: ['status'] });
    const total    = allBids.length;
    const pending  = allBids.filter(b => b.status === 'pending').length;
    const accepted = allBids.filter(b => b.status === 'accepted').length;
    const successRate = total > 0 ? Math.round((accepted / total) * 100) : 0;

    return res.json({
      success: true,
      data: rows,
      stats: { total, pending, accepted, success_rate: successRate },
      pagination: {
        total: count,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(count / Number(limit)),
      },
    });
  } catch (err) {
    console.error('myBids:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
