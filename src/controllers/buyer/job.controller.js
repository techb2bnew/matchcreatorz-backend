'use strict';
const { sequelize, Job, User, Bid, Booking } = require('../../models');
const { Op, literal }             = require('sequelize');
const notify                      = require('../../helpers/notification.helper');
const { stripHtml }               = require('../../helpers/text.helper');
const wallet                      = require('../../services/wallet/wallet.service');

const FEE_PERCENT = 0.10;

const BUYER_ATTRS = ['id', 'name', 'email'];

// ── List buyer's own jobs ─────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/jobs:
 *   get:
 *     summary: List my posted jobs
 *     tags: [Buyer - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Case-insensitive search by job title or description (uses iLike)
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [OPEN, IN_PROGRESS, CLOSED, CANCELLED] }
 *         description: Filter by job status
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
 *         description: Paginated job list
 */
exports.listMyJobs = async (req, res) => {
  try {
    const { status, search, category, page = 1, limit = 20 } = req.query;
    const where = { buyer_id: req.user.id };
    if (status) where.status = status;
    if (category && category !== 'All') {
      where.category = { [Op.iLike]: `%${String(category).trim()}%` };
    }
    if (search && search.trim()) {
      const term = search.trim();
      const safe = term.replace(/'/g, "''");
      where[Op.or] = [
        { title:       { [Op.iLike]: `%${term}%` } },
        { description: { [Op.iLike]: `%${term}%` } },
        { category:    { [Op.iLike]: `%${term}%` } },
        // searchable skills (JSON array) — cast to text and match
        literal(`CAST("Job"."skills" AS TEXT) ILIKE '%${safe}%'`),
      ];
    }

    const offset = (Number(page) - 1) * Number(limit);
    const { count, rows } = await Job.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: Number(limit),
      offset,
    });

    // Return clean plain-text description in the list (detail keeps full HTML)
    const data = rows.map((r) => {
      const j = r.toJSON();
      j.description = stripHtml(j.description);
      return j;
    });

    return res.json({
      success: true,
      data,
      pagination: { total: count, page: Number(page), limit: Number(limit), pages: Math.ceil(count / Number(limit)) },
    });
  } catch (err) {
    console.error('listMyJobs:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get single job ────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/jobs/{id}:
 *   get:
 *     summary: Get a single job by ID
 *     tags: [Buyer - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Job details
 *       404:
 *         description: Not found
 */
exports.getJob = async (req, res) => {
  try {
    const job = await Job.findOne({ where: { id: req.params.id, buyer_id: req.user.id } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    return res.json({ success: true, data: job });
  } catch (err) {
    console.error('getJob:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Create job ────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/jobs:
 *   post:
 *     summary: Post a new job
 *     tags: [Buyer - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, category]
 *             properties:
 *               title:            { type: string }
 *               description:      { type: string }
 *               category:         { type: string }
 *               job_type:         { type: string, enum: [fixed, hourly] }
 *               budget_min:       { type: number }
 *               budget_max:       { type: number }
 *               deadline:         { type: string, format: date }
 *               skills:           { type: array, items: { type: string } }
 *               experience_level: { type: string, enum: [any, beginner, intermediate, expert] }
 *     responses:
 *       201:
 *         description: Job created
 */
exports.createJob = async (req, res) => {
  try {
    const { title, description, category, job_type, budget_min, budget_max, deadline, skills, experience_level, attachments } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ success: false, message: 'Title is required' });

    const skillsArr = Array.isArray(skills)
      ? skills
      : typeof skills === 'string' && skills.trim()
        ? skills.split(',').map(s => s.trim()).filter(Boolean)
        : [];

    const job = await Job.create({
      buyer_id: req.user.id,
      title: title.trim(),
      description: description || null,
      category: category || 'General',
      job_type: job_type || 'fixed',
      budget_min: budget_min || null,
      budget_max: budget_max || null,
      deadline: deadline || null,
      skills: skillsArr,
      experience_level: experience_level || 'any',
      attachments: Array.isArray(attachments) ? attachments : [],
      status: 'OPEN',
    });

    return res.status(201).json({ success: true, message: 'Job posted successfully', data: job });
  } catch (err) {
    console.error('createJob:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Update job ────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/jobs/{id}:
 *   put:
 *     summary: Update an open job
 *     tags: [Buyer - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:            { type: string }
 *               description:      { type: string }
 *               category:         { type: string }
 *               job_type:         { type: string }
 *               budget_min:       { type: number }
 *               budget_max:       { type: number }
 *               deadline:         { type: string }
 *               skills:           { type: array }
 *               experience_level: { type: string }
 *     responses:
 *       200:
 *         description: Job updated
 */
exports.updateJob = async (req, res) => {
  try {
    const job = await Job.findOne({ where: { id: req.params.id, buyer_id: req.user.id } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.status !== 'OPEN') return res.status(400).json({ success: false, message: 'Only OPEN jobs can be edited' });

    const { title, description, category, job_type, budget_min, budget_max, deadline, skills, experience_level, attachments } = req.body;

    const skillsArr = Array.isArray(skills)
      ? skills
      : typeof skills === 'string' && skills.trim()
        ? skills.split(',').map(s => s.trim()).filter(Boolean)
        : job.skills;

    await job.update({
      title:            title            ?? job.title,
      description:      description      ?? job.description,
      category:         category         ?? job.category,
      job_type:         job_type         ?? job.job_type,
      budget_min:       budget_min       ?? job.budget_min,
      budget_max:       budget_max       ?? job.budget_max,
      deadline:         deadline         ?? job.deadline,
      skills:           skillsArr,
      experience_level: experience_level ?? job.experience_level,
      attachments:      Array.isArray(attachments) ? attachments : job.attachments,
    });

    return res.json({ success: true, message: 'Job updated', data: job });
  } catch (err) {
    console.error('updateJob:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Close job ─────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/jobs/{id}/close:
 *   patch:
 *     summary: Close a job
 *     tags: [Buyer - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Job closed
 */
exports.closeJob = async (req, res) => {
  try {
    const job = await Job.findOne({ where: { id: req.params.id, buyer_id: req.user.id } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    await job.update({ status: 'CLOSED' });
    return res.json({ success: true, message: 'Job closed', data: job });
  } catch (err) {
    console.error('closeJob:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Delete job ────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/jobs/{id}:
 *   delete:
 *     summary: Delete a job (soft delete)
 *     tags: [Buyer - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Job deleted
 */
exports.deleteJob = async (req, res) => {
  try {
    const job = await Job.findOne({ where: { id: req.params.id, buyer_id: req.user.id } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    await job.destroy();
    return res.json({ success: true, message: 'Job deleted' });
  } catch (err) {
    console.error('deleteJob:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// -- List bids on buyer's job ---------------------------------------------
/**
 * @swagger
 * /api/v1/buyer/jobs/{id}/bids:
 *   get:
 *     summary: List all bids on a buyer's job
 *     tags: [Buyer - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Job ID
 *     responses:
 *       200:
 *         description: List of bids with seller details
 *       404:
 *         description: Job not found
 */
exports.getJobBids = async (req, res) => {
  try {
    const job = await Job.findOne({ where: { id: req.params.id, buyer_id: req.user.id } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const bids = await Bid.findAll({
      where: { job_id: job.id },
      include: [
        { model: User, as: 'seller', attributes: ['id', 'name', 'email'] },
      ],
      order: [['created_at', 'ASC']],
    });

    return res.json({ success: true, data: bids, job: job });
  } catch (err) {
    console.error('getJobBids:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// -- Buyer counters a bid -------------------------------------------------
/**
 * @swagger
 * /api/v1/buyer/jobs/{id}/bids/{bidId}/counter:
 *   patch:
 *     summary: Counter a bid with a new amount / delivery (negotiation)
 *     tags: [Buyer - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: bidId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount:        { type: number }
 *               delivery_days: { type: integer }
 *               note:          { type: string }
 *     responses:
 *       200: { description: Counter offer sent to seller }
 *       404: { description: Job or bid not found }
 */
exports.counterBid = async (req, res) => {
  try {
    const job = await Job.findOne({ where: { id: req.params.id, buyer_id: req.user.id } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.status !== 'OPEN')
      return res.status(400).json({ success: false, message: 'Job is not open for negotiation' });

    const bid = await Bid.findOne({ where: { id: req.params.bidId, job_id: job.id } });
    if (!bid) return res.status(404).json({ success: false, message: 'Bid not found' });
    if (['accepted', 'rejected'].includes(bid.status))
      return res.status(400).json({ success: false, message: `Bid is already ${bid.status}` });

    const { amount, delivery_days, note } = req.body;
    if (!amount || Number(amount) <= 0)
      return res.status(400).json({ success: false, message: 'A valid counter amount is required' });

    await bid.update({
      status:                'countered',
      counter_amount:        Number(amount),
      counter_delivery_days: delivery_days ? Number(delivery_days) : bid.delivery_days,
      counter_by:            'buyer',
      counter_note:          note || null,
    });

    const seller = await User.findByPk(bid.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
    if (seller && notify.bidCountered) notify.bidCountered(seller, job, 'buyer', Number(amount));

    return res.json({ success: true, message: 'Counter offer sent', data: bid });
  } catch (err) {
    console.error('counterBid:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// -- Accept a bid + auto-create booking -----------------------------------
/**
 * @swagger
 * /api/v1/buyer/jobs/{id}/bids/{bidId}/accept:
 *   patch:
 *     summary: Accept a bid on a job (creates a booking automatically)
 *     tags: [Buyer - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Job ID
 *       - in: path
 *         name: bidId
 *         required: true
 *         schema: { type: integer }
 *         description: Bid ID to accept
 *     responses:
 *       200:
 *         description: Bid accepted and booking created
 *       400:
 *         description: Already accepted a bid for this job
 *       404:
 *         description: Bid or job not found
 */
exports.acceptBid = async (req, res) => {
  try {
    const job = await Job.findOne({ where: { id: req.params.id, buyer_id: req.user.id } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.status !== 'OPEN')
      return res.status(400).json({ success: false, message: 'Job is not open for bid acceptance' });

    const bid = await Bid.findOne({ where: { id: req.params.bidId, job_id: job.id } });
    if (!bid) return res.status(404).json({ success: false, message: 'Bid not found' });
    if (bid.status === 'accepted')
      return res.status(400).json({ success: false, message: 'Bid already accepted' });

    // Check no other bid already accepted for this job
    const existing = await Booking.findOne({ where: { job_id: job.id } });
    if (existing)
      return res.status(400).json({ success: false, message: 'A booking already exists for this job' });

    // Effective terms = the current counter on the table (if any), else the original bid
    const effAmount   = bid.counter_amount != null ? Number(bid.counter_amount) : Number(bid.amount);
    const effDelivery = bid.counter_amount != null && bid.counter_delivery_days != null
      ? bid.counter_delivery_days : bid.delivery_days;
    const fee = Math.round(effAmount * FEE_PERCENT * 100) / 100;

    // Escrow: hold the agreed amount from the buyer's wallet in the same
    // transaction as the bid/job/booking updates. If funds are insufficient,
    // wallet.debit throws 402 and everything rolls back (job stays OPEN,
    // no bid gets marked accepted/rejected, no booking is created).
    const booking = await sequelize.transaction(async (t) => {
      // 1. Update bid status
      await bid.update({ status: 'accepted' }, { transaction: t });

      // 2. Reject all other bids on this job
      await Bid.update(
        { status: 'rejected' },
        { where: { job_id: job.id, id: { [Op.ne]: bid.id } }, transaction: t }
      );

      // 3. Update job status to IN_PROGRESS
      await job.update({ status: 'IN_PROGRESS' }, { transaction: t });

      // 4. Create booking at the agreed (effective) terms
      const b = await Booking.create({
        buyer_id:      req.user.id,
        seller_id:     bid.seller_id,
        job_id:        job.id,
        service_id:    null,
        title:         job.title,
        amount:        effAmount,
        platform_fee:  fee,
        delivery_days: effDelivery,
        status:        'pending',
        payment_status: 'held',
      }, { transaction: t });

      await wallet.debit(req.user.id, effAmount, {
        type: 'booking_payment', booking_id: b.id,
        note: `Payment held for booking #${b.id} — ${job.title}`,
      }, t);

      return b;
    });

    // Notify seller their bid was accepted
    const seller = await User.findByPk(bid.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
    if (seller) notify.bidAccepted(seller, job);

    return res.json({
      success: true,
      message: 'Bid accepted. Booking created successfully.',
      data: { booking, bid },
    });
  } catch (err) {
    if (err && err.statusCode === 402)
      return res.status(402).json({ success: false, message: 'Insufficient wallet balance — top up before accepting this bid.' });
    console.error('acceptBid:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// -- Reject a single bid --------------------------------------------------
/**
 * @swagger
 * /api/v1/buyer/jobs/{id}/bids/{bidId}/reject:
 *   patch:
 *     summary: Reject a specific bid on a job
 *     tags: [Buyer - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Job ID
 *       - in: path
 *         name: bidId
 *         required: true
 *         schema: { type: integer }
 *         description: Bid ID to reject
 *     responses:
 *       200:
 *         description: Bid rejected
 *       400:
 *         description: Bid already accepted or not pending
 *       404:
 *         description: Job or bid not found
 */
exports.rejectBid = async (req, res) => {
  try {
    const job = await Job.findOne({ where: { id: req.params.id, buyer_id: req.user.id } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.status !== 'OPEN')
      return res.status(400).json({ success: false, message: 'Job is not open' });

    const bid = await Bid.findOne({ where: { id: req.params.bidId, job_id: job.id } });
    if (!bid) return res.status(404).json({ success: false, message: 'Bid not found' });
    if (!['pending', 'countered'].includes(bid.status))
      return res.status(400).json({ success: false, message: `Bid is already ${bid.status}` });

    await bid.update({ status: 'rejected' });

    // Notify seller their bid was rejected
    const seller = await User.findByPk(bid.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
    if (seller) notify.bidRejected(seller, job);

    return res.json({ success: true, message: 'Bid rejected', data: bid });
  } catch (err) {
    console.error('rejectBid:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
