'use strict';
const { sequelize, Job, User, Bid, SellerProfile, Booking, ConnectTransaction } = require('../../models');
const { Op, literal }    = require('sequelize');
const notify             = require('../../helpers/notification.helper');
const { applyConnects, getBidCost } = require('../../helpers/connects.helper');
const { stripHtml }               = require('../../helpers/text.helper');

const FEE_PERCENT = 0.10;
const MAX_BID_ATTACHMENTS = 5;

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
      const term = search.trim();
      const safe = term.replace(/'/g, "''");
      where[Op.or] = [
        { title:       { [Op.iLike]: `%${term}%` } },
        { description: { [Op.iLike]: `%${term}%` } },
        { category:    { [Op.iLike]: `%${term}%` } },
        // searchable skills (stored as JSON array) — cast to text and match
        literal(`CAST("Job"."skills" AS TEXT) ILIKE '%${safe}%'`),
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
      attributes: ['id', 'job_id', 'amount', 'delivery_days', 'proposal', 'status',
                   'counter_amount', 'counter_delivery_days', 'counter_by', 'counter_note'],
    });
    const bidMap = new Map(myBids.map(b => [b.job_id, b]));

    const data = rows.map(j => {
      const obj = j.toJSON();
      obj.description = stripHtml(obj.description);   // clean preview in list
      return { ...obj, has_bid: bidMap.has(j.id), my_bid: bidMap.get(j.id) || null };
    });

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
    const myBid = await Bid.findOne({ where: { job_id: req.params.id, seller_id: req.user.id } });

    // A job the seller has never bid on is only viewable while it's OPEN (browsing).
    // A job they DID bid on stays viewable regardless of status, so they can see
    // what happened to their bid (accepted/rejected/booked/closed).
    const where = myBid ? { id: req.params.id } : { id: req.params.id, status: 'OPEN' };
    const job = await Job.findOne({
      where,
      include: [{ model: User, as: 'buyer', attributes: ['id', 'name', 'email'] }],
    });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

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

    const { amount, delivery_days, proposal, attachments } = req.body;
    if (!amount || !delivery_days)
      return res.status(400).json({ success: false, message: 'Amount and delivery days are required' });

    // Connects gate: seller must have enough connects to bid
    const bidCost = await getBidCost();
    const profile = await SellerProfile.findOne({ where: { user_id: req.user.id }, attributes: ['connects_balance'] });
    if (!profile || Number(profile.connects_balance) < bidCost) {
      return res.status(400).json({
        success: false,
        message: `You need at least ${bidCost} connect(s) to place a bid. Please top up.`,
      });
    }

    const bid = await Bid.create({
      job_id:        job.id,
      seller_id:     req.user.id,
      amount:        Number(amount),
      delivery_days: Number(delivery_days),
      proposal:      proposal || null,
      attachments:   Array.isArray(attachments) ? attachments.slice(0, MAX_BID_ATTACHMENTS) : [],
      status:        'pending',
    });

    // Deduct connects (ledger + balance) — ref the job
    await applyConnects(req.user.id, -bidCost, 'bid_deduct', {
      note:   `Bid on job #${job.id}`,
      ref_id: job.id,
    }).catch(() => {});

    // Increment bids_count on job
    await job.increment('bids_count');

    // Notify buyer of new bid
    const buyer = await User.findByPk(job.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
    const seller = await User.findByPk(req.user.id, { attributes: ['id', 'name'] });
    if (buyer && seller) notify.bidPlaced(buyer, job, seller);

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

    const { amount, delivery_days, proposal, attachments } = req.body;
    if (!amount || !delivery_days)
      return res.status(400).json({ success: false, message: 'Amount and delivery days are required' });

    await bid.update({
      amount:        Number(amount),
      delivery_days: Number(delivery_days),
      proposal:      proposal || bid.proposal,
      // Explicit [] must be respected so the seller can remove all attachments
      attachments:   Array.isArray(attachments) ? attachments.slice(0, MAX_BID_ATTACHMENTS) : bid.attachments,
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

    // Refund exactly what was deducted for this bid (connects_per_bid may have
    // changed since the bid was placed) — fall back to the current cost if the
    // original deduction can't be found.
    const spent = await ConnectTransaction.findOne({
      where: { seller_id: req.user.id, ref_id: job.id, type: 'bid_deduct' },
      order: [['created_at', 'DESC']],
    });
    const refundAmount = spent ? Math.abs(Number(spent.amount)) : await getBidCost();

    await applyConnects(req.user.id, refundAmount, 'refund', {
      note:   `Refund: withdrew bid on job #${job.id}`,
      ref_id: job.id,
    }).catch(() => {});

    // Notify job owner (buyer) that bid was withdrawn
    const [buyer, seller] = await Promise.all([
      User.findByPk(job.buyer_id,  { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] }),
      User.findByPk(req.user.id,   { attributes: ['id', 'name'] }),
    ]);
    if (buyer && seller) notify.bidWithdrawn(buyer, job, seller.name);

    return res.json({ success: true, message: 'Bid withdrawn successfully' });
  } catch (err) {
    console.error('withdrawBid:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// -- Seller counters back on their bid ----------------------------------------
/**
 * @swagger
 * /api/v1/seller/jobs/{id}/bid/counter:
 *   patch:
 *     summary: Counter back after the buyer countered your bid
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
 *             required: [amount]
 *             properties:
 *               amount:        { type: number }
 *               delivery_days: { type: integer }
 *               note:          { type: string }
 *     responses:
 *       200: { description: Counter offer sent to buyer }
 *       404: { description: Job or bid not found }
 */
exports.counterBidBySeller = async (req, res) => {
  try {
    const job = await Job.findOne({ where: { id: req.params.id, status: 'OPEN' } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or not open' });

    const bid = await Bid.findOne({ where: { job_id: job.id, seller_id: req.user.id } });
    if (!bid) return res.status(404).json({ success: false, message: 'You have not bid on this job' });
    if (['accepted', 'rejected'].includes(bid.status))
      return res.status(400).json({ success: false, message: `Bid is already ${bid.status}` });

    const { amount, delivery_days, note } = req.body;
    if (!amount || Number(amount) <= 0)
      return res.status(400).json({ success: false, message: 'A valid counter amount is required' });

    await bid.update({
      status:                'countered',
      counter_amount:        Number(amount),
      counter_delivery_days: delivery_days ? Number(delivery_days) : bid.delivery_days,
      counter_by:            'seller',
      counter_note:          note || null,
    });

    const buyer = await User.findByPk(job.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
    if (buyer && notify.bidCountered) notify.bidCountered(buyer, job, 'seller', Number(amount));

    return res.json({ success: true, message: 'Counter offer sent to buyer', data: bid });
  } catch (err) {
    console.error('counterBidBySeller:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// -- Seller accepts the buyer's counter → booking -----------------------------
/**
 * @swagger
 * /api/v1/seller/jobs/{id}/bid/accept:
 *   patch:
 *     summary: Accept the buyer's counter offer (creates a booking)
 *     tags: [Seller - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Counter accepted, booking created }
 *       400: { description: No buyer counter to accept }
 *       404: { description: Job or bid not found }
 */
exports.acceptCounterBySeller = async (req, res) => {
  try {
    const job = await Job.findOne({ where: { id: req.params.id, status: 'OPEN' } });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or not open' });

    const bid = await Bid.findOne({ where: { job_id: job.id, seller_id: req.user.id } });
    if (!bid) return res.status(404).json({ success: false, message: 'You have not bid on this job' });
    if (bid.status !== 'countered' || bid.counter_by !== 'buyer')
      return res.status(400).json({ success: false, message: 'There is no buyer counter to accept' });

    const existing = await Booking.findOne({ where: { job_id: job.id } });
    if (existing)
      return res.status(400).json({ success: false, message: 'A booking already exists for this job' });

    const effAmount   = Number(bid.counter_amount);
    const effDelivery = bid.counter_delivery_days != null ? bid.counter_delivery_days : bid.delivery_days;
    const fee = Math.round(effAmount * FEE_PERCENT * 100) / 100;

    // No wallet charge here — payment is deferred until the seller actually
    // submits work. The bid/job/booking updates still happen atomically.
    const booking = await sequelize.transaction(async (t) => {
      await bid.update({ status: 'accepted' }, { transaction: t });
      await Bid.update({ status: 'rejected' }, { where: { job_id: job.id, id: { [Op.ne]: bid.id } }, transaction: t });
      await job.update({ status: 'IN_PROGRESS' }, { transaction: t });

      const b = await Booking.create({
        buyer_id:      job.buyer_id,
        seller_id:     req.user.id,
        job_id:        job.id,
        service_id:    null,
        title:         job.title,
        amount:        effAmount,
        platform_fee:  fee,
        delivery_days: effDelivery,
        status:        'pending',
      }, { transaction: t });

      return b;
    });

    // Notify buyer their counter was accepted (booking created)
    const buyer = await User.findByPk(job.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
    if (buyer) notify.bookingCreated(buyer, booking);

    return res.json({ success: true, message: 'Counter accepted. Booking created.', data: { booking, bid } });
  } catch (err) {
    console.error('acceptCounterBySeller:', err);
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
