'use strict';
const { Op, literal }                   = require('sequelize');
const { sequelize, Booking, BookingMilestone, BookingWorkEntry, User, Service, Job } = require('../../models');
const wallet                            = require('../../services/wallet/wallet.service');
const { settleWorkEntry }               = require('../../services/shared/workEntry.service');
const escrow                            = require('../../services/shared/escrow.service');

const INCLUDE = [
  { model: User,    as: 'buyer',   attributes: ['id', 'name', 'email'] },
  { model: User,    as: 'seller',  attributes: ['id', 'name', 'email'] },
  { model: Service, as: 'service', attributes: ['id', 'title'],  required: false },
  { model: Job,     as: 'job',     attributes: ['id', 'title'],  required: false },
  { model: BookingMilestone, as: 'milestones', required: false, separate: true, order: [['position', 'ASC']] },
  { model: BookingWorkEntry, as: 'workEntries', required: false, separate: true, order: [['work_date', 'DESC']] },
];

// Whitelist of columns the grid may sort by, mapped to a Sequelize order path.
const SORT_FIELDS = {
  id:     ['id'],
  title:  ['title'],
  buyer:  [{ model: User, as: 'buyer' },  'name'],
  seller: [{ model: User, as: 'seller' }, 'name'],
  amount: ['amount'],
  status: ['status'],
  date:   ['createdAt'],
};

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
 *         description: Search by ID, title, buyer name, seller name, amount, status, or date
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
    const { status, search, page = 1, limit = 20, sortBy, sortDir } = req.query;
    const where = {};
    if (status) where.status = status;
    if (search) {
      const term = String(search).trim();
      const safe = term.replace(/'/g, "''");

      const orConditions = [
        { title:            { [Op.iLike]: `%${term}%` } },
        { '$buyer.name$':   { [Op.iLike]: `%${term}%` } },
        { '$seller.name$':  { [Op.iLike]: `%${term}%` } },
        // `amount` is numeric and `status` is a Postgres ENUM — ILIKE needs an
        // explicit ::text cast on both, or Postgres errors ("operator does not exist").
        literal(`"Booking"."amount"::text ILIKE '%${safe}%'`),
        literal(`"Booking"."status"::text ILIKE '%${safe}%'`),
      ];

      // Match the "#82" style ID shown in the grid — strip a leading # and
      // require the remainder to be a plain integer before comparing.
      const idTerm = term.replace(/^#/, '');
      if (/^\d+$/.test(idTerm)) orConditions.push({ id: Number(idTerm) });

      // Support matching by the date shown in the table (e.g. "Aug 3, 2026")
      // by treating a parseable search string as a whole-day range.
      const parsedDate = new Date(term);
      if (!isNaN(parsedDate.getTime())) {
        const dayStart = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
        const dayEnd   = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        orConditions.push({ createdAt: { [Op.gte]: dayStart, [Op.lt]: dayEnd } });
      }

      where[Op.or] = orConditions;
    }

    const sortPath = SORT_FIELDS[sortBy] || SORT_FIELDS.date;
    const direction = sortDir === 'asc' ? 'ASC' : 'DESC';

    const offset = (Number(page) - 1) * Number(limit);
    const { count, rows } = await Booking.findAndCountAll({
      where,
      include:   INCLUDE,
      order:     [[...sortPath, direction]],
      limit:     Number(limit),
      offset,
      distinct:  true,
      subQuery:  false,
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
 *     description: |
 *       In escrow mode, "completed" captures the Stripe hold (real charge) instead of a wallet
 *       debit; "cancelled" cancels the hold instead of a wallet refund — no card is ever charged
 *       for a cancelled escrow dispute.
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
 *               resolution: { type: string, enum: [completed, cancelled], description: "completed = favour seller (pays out), cancelled = favour buyer (refund)" }
 *     responses:
 *       200:
 *         description: Dispute resolved
 */
exports.resolveDispute = async (req, res) => {
  try {
    const booking = await Booking.findByPk(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const { resolution, entry_id } = req.body;
    if (!['completed', 'cancelled'].includes(resolution))
      return res.status(400).json({ success: false, message: 'Resolution must be completed or cancelled' });

    // Entry-level dispute (hourly work) — Booking.status is never 'in_dispute'
    // for these, since only one entry among many is disputed. Resolved
    // independently of the whole-booking path below.
    if (entry_id) {
      const result = await sequelize.transaction(async (t) => {
        const lockedBooking = await Booking.findByPk(booking.id, { lock: t.LOCK.UPDATE, transaction: t });
        const entry = await BookingWorkEntry.findOne({
          where: { id: entry_id, booking_id: booking.id }, lock: t.LOCK.UPDATE, transaction: t,
        });
        if (!entry) throw Object.assign(new Error('Work entry not found'), { status: 404 });
        if (entry.status !== 'disputed')
          throw Object.assign(new Error('Entry is not in dispute'), { status: 400 });

        if (resolution === 'completed') {
          // Favour seller — pay at the counter if one was pending, else the full logged hours.
          return settleWorkEntry(lockedBooking, entry, { hours: Number(entry.counter_hours ?? entry.hours), t });
        }
        // Favour buyer — no payment.
        await entry.update({ status: 'rejected' }, { transaction: t });
        return entry;
      });
      return res.json({ success: true, message: `Entry dispute resolved as ${resolution}`, data: result });
    }

    if (booking.status !== 'in_dispute')
      return res.status(400).json({ success: false, message: 'Booking is not in dispute' });

    // Settle according to the resolution. `wasHeld` covers legacy escrow
    // bookings that already collected the buyer's money up front; the current
    // bid/hourly flow defers charging entirely (payment_status stays 'unpaid'
    // through a dispute), so "favour seller" must charge the buyer here too —
    // gating the whole payout on wasHeld (as this used to) meant it silently
    // paid nothing for every booking created after the escrow model retired.
    const wasHeld        = booking.payment_status === 'held';
    const alreadySettled = ['released', 'refunded'].includes(booking.payment_status);
    const isEscrow        = booking.payment_mode === 'escrow';

    // Escrow: capture/cancel the Stripe hold BEFORE opening the DB transaction
    // — a Stripe network call must never happen while holding row locks.
    if (!alreadySettled && wasHeld && isEscrow) {
      if (resolution === 'completed') await escrow.captureHold(booking);
      else await escrow.cancelHold(booking);
    }

    await sequelize.transaction(async (t) => {
      if (resolution === 'completed') {
        // Favour seller → charge buyer (unless already held), release earnings
        // (amount − fee) to seller, platform keeps the fee.
        await booking.update({
          status: 'completed',
          payment_status: alreadySettled ? booking.payment_status : 'released',
        }, { transaction: t });

        if (!alreadySettled) {
          const amount = Number(booking.amount);
          const fee    = Number(booking.platform_fee);
          if (!wasHeld) {
            await wallet.debit(booking.buyer_id, amount, {
              type: 'booking_payment', booking_id: booking.id, note: `Payment for disputed booking #${booking.id}`,
            }, t);
          }
          // escrow-mode wasHeld: captured via Stripe above, no wallet debit needed.
          await wallet.credit(booking.seller_id, wallet.round2(amount - fee), {
            type: 'earning', booking_id: booking.id, note: `Earning from resolved booking #${booking.id}`,
          }, t);
          const admin = await User.findOne({ where: { role: 'ADMIN' }, order: [['id', 'ASC']], attributes: ['id'], transaction: t });
          if (admin && fee > 0) {
            await wallet.credit(admin.id, fee, { type: 'platform_fee', booking_id: booking.id, note: `Platform fee from booking #${booking.id}` }, t);
          }
        }
      } else {
        // Favour buyer → refund only if money was actually collected up front
        // (wasHeld); the deferred-payment flow never charged the buyer for a
        // booking still in dispute, so there's nothing to refund in that case.
        await booking.update({
          status: 'cancelled',
          payment_status: alreadySettled ? booking.payment_status : (wasHeld ? 'refunded' : booking.payment_status),
        }, { transaction: t });
        if (wasHeld && !isEscrow) {
          await wallet.credit(booking.buyer_id, Number(booking.amount), {
            type: 'booking_refund', booking_id: booking.id, note: `Refund for disputed booking #${booking.id}`,
          }, t);
        }
        // escrow-mode wasHeld: hold cancelled via Stripe above, no wallet credit needed.
      }
    });
    return res.json({ success: true, message: `Dispute resolved as ${resolution}`, data: booking });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
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
