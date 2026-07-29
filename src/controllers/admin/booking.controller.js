'use strict';
const { Op }                            = require('sequelize');
const { sequelize, Booking, User, Service, Job } = require('../../models');
const wallet                            = require('../../services/wallet/wallet.service');

const INCLUDE = [
  { model: User,    as: 'buyer',   attributes: ['id', 'name', 'email'] },
  { model: User,    as: 'seller',  attributes: ['id', 'name', 'email'] },
  { model: Service, as: 'service', attributes: ['id', 'title'],  required: false },
  { model: Job,     as: 'job',     attributes: ['id', 'title'],  required: false },
];

/**
 * @swagger
 * /api/v1/admin/bookings:
 *   get:
 *     summary: List all bookings (admin)
 *     tags: [Admin - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, ongoing, amidst_completion, completed, cancelled, in_dispute] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by booking title
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated booking list
 */
exports.listBookings = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.status = status;
    if (search) where.title  = { [Op.iLike]: `%${search}%` };

    const offset = (Number(page) - 1) * Number(limit);
    const { count, rows } = await Booking.findAndCountAll({
      where,
      include:  INCLUDE,
      order:    [['created_at', 'DESC']],
      limit:    Number(limit),
      offset,
      distinct: true,
    });

    // Stats
    const stats = await Booking.findAll({
      attributes: ['status'],
      raw: true,
    });
    const summary = stats.reduce((acc, b) => {
      acc[b.status] = (acc[b.status] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      success: true,
      data: rows,
      summary,
      pagination: { total: count, page: Number(page), limit: Number(limit), pages: Math.ceil(count / Number(limit)) },
    });
  } catch (err) {
    console.error('listBookings(admin):', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * @swagger
 * /api/v1/admin/bookings/{id}:
 *   get:
 *     summary: Get booking detail (admin)
 *     tags: [Admin - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Booking detail
 */
exports.getBooking = async (req, res) => {
  try {
    const booking = await Booking.findByPk(req.params.id, { include: INCLUDE });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    return res.json({ success: true, data: booking });
  } catch (err) {
    console.error('getBooking(admin):', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * @swagger
 * /api/v1/admin/bookings/{id}/resolve:
 *   patch:
 *     summary: Resolve a disputed booking
 *     tags: [Admin - Bookings]
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
 *             required: [resolution]
 *             properties:
 *               resolution: { type: string, enum: [completed, cancelled], description: "completed = favour buyer, cancelled = refund" }
 *     responses:
 *       200:
 *         description: Dispute resolved
 */
exports.resolveDispute = async (req, res) => {
  try {
    const booking = await Booking.findByPk(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.status !== 'in_dispute')
      return res.status(400).json({ success: false, message: 'Booking is not in dispute' });

    const { resolution } = req.body;
    if (!['completed', 'cancelled'].includes(resolution))
      return res.status(400).json({ success: false, message: 'Resolution must be completed or cancelled' });

    // Settle escrow according to the resolution.
    await sequelize.transaction(async (t) => {
      const wasHeld = booking.payment_status === 'held';
      if (resolution === 'completed') {
        // Favour seller → release earnings (amount − fee); platform keeps the fee.
        await booking.update({ status: 'completed', payment_status: wasHeld ? 'released' : booking.payment_status }, { transaction: t });
        if (wasHeld) {
          const amount = Number(booking.amount);
          const fee    = Number(booking.platform_fee);
          await wallet.credit(booking.seller_id, wallet.round2(amount - fee), {
            type: 'earning', booking_id: booking.id, note: `Earning from resolved booking #${booking.id}`,
          }, t);
          const admin = await User.findOne({ where: { role: 'ADMIN' }, order: [['id', 'ASC']], attributes: ['id'], transaction: t });
          if (admin && fee > 0) {
            await wallet.credit(admin.id, fee, { type: 'platform_fee', booking_id: booking.id, note: `Platform fee from booking #${booking.id}` }, t);
          }
        }
      } else {
        // Favour buyer → refund the held escrow.
        await booking.update({ status: 'cancelled', payment_status: wasHeld ? 'refunded' : booking.payment_status }, { transaction: t });
        if (wasHeld) {
          await wallet.credit(booking.buyer_id, Number(booking.amount), {
            type: 'booking_refund', booking_id: booking.id, note: `Refund for disputed booking #${booking.id}`,
          }, t);
        }
      }
    });
    return res.json({ success: true, message: `Dispute resolved as ${resolution}`, data: booking });
  } catch (err) {
    console.error('resolveDispute:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * @swagger
 * /api/v1/admin/bookings/{id}:
 *   delete:
 *     summary: Delete a booking (admin)
 *     tags: [Admin - Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Booking deleted
 */
exports.deleteBooking = async (req, res) => {
  try {
    const booking = await Booking.findByPk(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    await booking.destroy();
    return res.json({ success: true, message: 'Booking deleted' });
  } catch (err) {
    console.error('deleteBooking(admin):', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
