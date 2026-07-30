'use strict';
const { sequelize, Offer, Booking, Service, User } = require('../../models');
const response = require('../../helpers/response.helper');
const notify   = require('../../helpers/notification.helper');
const env      = require('../../config/env');

const FEE_PERCENT = (Number(env.PLATFORM_FEE_PERCENT) || 10) / 100;

const INCLUDE = [
  { model: User,    as: 'seller',  attributes: ['id', 'name', 'email'] },
  { model: User,    as: 'buyer',   attributes: ['id', 'name', 'email'] },
  { model: Service, as: 'service', attributes: ['id', 'title', 'images'], required: false },
];

/**
 * @swagger
 * tags:
 *   - name: Seller - Offers
 *     description: Seller custom offers to buyers
 *   - name: Buyer - Offers
 *     description: Buyer received offers
 */

// ── SELLER: send a custom offer ─────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/seller/offers:
 *   post:
 *     summary: Send a custom offer to a buyer
 *     tags: [Seller - Offers]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [buyer_id, title, amount]
 *             properties:
 *               buyer_id:      { type: integer }
 *               service_id:    { type: integer, nullable: true }
 *               title:         { type: string }
 *               description:   { type: string }
 *               amount:        { type: number }
 *               delivery_days: { type: integer }
 *               expires_at:    { type: string, format: date-time, nullable: true }
 *     responses:
 *       201:
 *         description: Offer sent
 *       400:
 *         description: Invalid input
 */
exports.sendOffer = async (req, res, next) => {
  try {
    const { buyer_id, service_id, title, description, amount, delivery_days, expires_at } = req.body;

    if (!buyer_id || !title || !amount)
      return response.badRequest(res, 'buyer_id, title and amount are required');
    if (Number(amount) <= 0)
      return response.badRequest(res, 'amount must be greater than 0');

    const buyer = await User.findByPk(Number(buyer_id), { attributes: ['id', 'name', 'email', 'role', 'web_fcm_token', 'mobile_fcm_token'] });
    if (!buyer || buyer.role !== 'BUYER')
      return response.notFound(res, 'Buyer not found');

    if (service_id) {
      const svc = await Service.findOne({ where: { id: Number(service_id), seller_id: req.user.id }, attributes: ['id'] });
      if (!svc) return response.badRequest(res, 'Service not found or not yours');
    }

    const offer = await Offer.create({
      seller_id:     req.user.id,
      buyer_id:      Number(buyer_id),
      service_id:    service_id || null,
      title:         title.trim(),
      description:   description || null,
      amount:        Number(amount),
      delivery_days: delivery_days ? Number(delivery_days) : null,
      expires_at:    expires_at || null,
      status:        'pending',
    });

    // notify buyer
    const seller = await User.findByPk(req.user.id, { attributes: ['id', 'name'] });
    if (notify.offerReceived) notify.offerReceived(buyer, seller?.name || 'A seller', offer);

    return response.created(res, 'Offer sent', offer);
  } catch (err) { next(err); }
};

// ── SELLER: list my sent offers ─────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/seller/offers:
 *   get:
 *     summary: List offers I have sent
 *     tags: [Seller - Offers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, accepted, declined, expired] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of sent offers
 */
exports.listSentOffers = async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const where  = { seller_id: req.user.id };
    if (req.query.status) where.status = req.query.status;

    const { count, rows } = await Offer.findAndCountAll({
      where, include: INCLUDE, order: [['created_at', 'DESC']], limit, offset, distinct: true,
    });
    return response.paginate(res, 'Offers fetched', rows, { total: count, page, limit });
  } catch (err) { next(err); }
};

// ── SELLER: withdraw a pending offer ────────────────────────────────────────
/**
 * @swagger
 * /api/v1/seller/offers/{id}:
 *   delete:
 *     summary: Withdraw a pending offer
 *     tags: [Seller - Offers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Offer withdrawn }
 *       404: { description: Offer not found }
 */
exports.withdrawOffer = async (req, res, next) => {
  try {
    const offer = await Offer.findOne({ where: { id: req.params.id, seller_id: req.user.id } });
    if (!offer) return response.notFound(res, 'Offer not found');
    if (offer.status !== 'pending')
      return response.badRequest(res, 'Only pending offers can be withdrawn');
    await offer.destroy();
    return response.success(res, 'Offer withdrawn');
  } catch (err) { next(err); }
};

// ── BUYER: list received offers ─────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/offers:
 *   get:
 *     summary: List offers I have received
 *     tags: [Buyer - Offers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, accepted, declined, expired] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of received offers
 */
exports.listReceivedOffers = async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const where  = { buyer_id: req.user.id };
    if (req.query.status) where.status = req.query.status;

    const { count, rows } = await Offer.findAndCountAll({
      where, include: INCLUDE, order: [['created_at', 'DESC']], limit, offset, distinct: true,
    });
    return response.paginate(res, 'Offers fetched', rows, { total: count, page, limit });
  } catch (err) { next(err); }
};

// ── BUYER: accept an offer → creates a booking ──────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/offers/{id}/accept:
 *   patch:
 *     summary: Accept an offer (creates a booking)
 *     tags: [Buyer - Offers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Offer accepted, booking created }
 *       400: { description: Offer not pending }
 *       404: { description: Offer not found }
 */
exports.acceptOffer = async (req, res, next) => {
  try {
    const offer = await Offer.findOne({ where: { id: req.params.id, buyer_id: req.user.id } });
    if (!offer) return response.notFound(res, 'Offer not found');
    if (offer.status !== 'pending')
      return response.badRequest(res, 'This offer is no longer pending');
    if (offer.expires_at && new Date(offer.expires_at) < new Date()) {
      await offer.update({ status: 'expired' });
      return response.badRequest(res, 'This offer has expired');
    }

    const amount = Number(offer.amount);
    const fee    = Math.round(amount * FEE_PERCENT * 100) / 100;

    // No wallet charge here — payment is deferred until the seller actually
    // submits work. Booking + offer updates still happen atomically.
    const booking = await sequelize.transaction(async (t) => {
      const b = await Booking.create({
        buyer_id:      offer.buyer_id,
        seller_id:     offer.seller_id,
        service_id:    offer.service_id || null,
        title:         offer.title,
        amount,
        platform_fee:  fee,
        delivery_days: offer.delivery_days || null,
        status:        'pending',
      }, { transaction: t });

      await offer.update({ status: 'accepted', booking_id: b.id }, { transaction: t });

      return b;
    });

    // notify seller
    const seller = await User.findByPk(offer.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
    if (seller) notify.bookingCreated(seller, booking);

    return response.success(res, 'Offer accepted, booking created', { offer, booking });
  } catch (err) { next(err); }
};

// ── BUYER: decline an offer ─────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/buyer/offers/{id}/decline:
 *   patch:
 *     summary: Decline an offer
 *     tags: [Buyer - Offers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Offer declined }
 *       404: { description: Offer not found }
 */
exports.declineOffer = async (req, res, next) => {
  try {
    const offer = await Offer.findOne({ where: { id: req.params.id, buyer_id: req.user.id } });
    if (!offer) return response.notFound(res, 'Offer not found');
    if (offer.status !== 'pending')
      return response.badRequest(res, 'This offer is no longer pending');
    await offer.update({ status: 'declined' });
    return response.success(res, 'Offer declined');
  } catch (err) { next(err); }
};
