'use strict';
const { Op }                          = require('sequelize');
const { sequelize, Booking, User, Service, Job } = require('../../models');
const notify                          = require('../../helpers/notification.helper');
const wallet                          = require('../wallet/wallet.service');
const env                             = require('../../config/env');

const FEE_PERCENT = (Number(env.PLATFORM_FEE_PERCENT) || 10) / 100;

// The platform's fee is parked in the primary admin's wallet so the admin wallet
// reflects real platform revenue. Cached after first lookup.
let _platformAdminId;
const platformAdminId = async () => {
  if (_platformAdminId !== undefined) return _platformAdminId;
  const admin = await User.findOne({ where: { role: 'ADMIN' }, order: [['id', 'ASC']], attributes: ['id'] });
  _platformAdminId = admin ? admin.id : null;
  return _platformAdminId;
};

const INCLUDE = [
  { model: User,    as: 'buyer',   attributes: ['id', 'name'] },
  { model: User,    as: 'seller',  attributes: ['id', 'name'] },
  { model: Service, as: 'service', attributes: ['id', 'title', 'images'], required: false },
  { model: Job,     as: 'job',     attributes: ['id', 'title'],           required: false },
];

const STATUS_MAP = {
  active:    ['pending', 'ongoing', 'amidst_completion', 'in_dispute'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

exports.listBookings = async (buyerId, { tab = 'active', page = 1, limit = 20 }) => {
  const statuses = STATUS_MAP[tab] || STATUS_MAP.active;
  const offset   = (Number(page) - 1) * Number(limit);

  const { count, rows } = await Booking.findAndCountAll({
    where:    { buyer_id: buyerId, status: { [Op.in]: statuses } },
    include:  INCLUDE,
    order:    [['created_at', 'DESC']],
    limit:    Number(limit),
    offset,
    distinct: true,
  });

  return { data: rows, total: count, page: Number(page), limit: Number(limit) };
};

exports.getBooking = async (buyerId, id) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId }, include: INCLUDE });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  return booking;
};

exports.createBooking = async (buyerId, { service_id, job_id, notes }) => {
  // A direct booking must reference a real, active service. Seller, title, amount
  // and delivery are all derived server-side from the service — never trusted from the client.
  if (!service_id)
    throw Object.assign(new Error('service_id is required to create a booking'), { status: 400 });

  const service = await Service.findByPk(Number(service_id), {
    attributes: ['id', 'seller_id', 'title', 'price', 'delivery_days', 'status'],
  });
  if (!service)
    throw Object.assign(new Error('Service not found'), { status: 404 });
  if (service.status !== 'active')
    throw Object.assign(new Error('This service is not available for booking'), { status: 400 });
  if (service.seller_id === buyerId)
    throw Object.assign(new Error('You cannot book your own service'), { status: 400 });

  const amount = Number(service.price);
  const fee    = Math.round(amount * FEE_PERCENT * 100) / 100;

  // Escrow: create the booking AND hold the amount from the buyer's wallet in one
  // transaction. If the buyer lacks funds, wallet.debit throws 402 and the whole
  // thing rolls back (no orphan booking).
  const booking = await sequelize.transaction(async (t) => {
    const b = await Booking.create({
      buyer_id:      buyerId,
      seller_id:     service.seller_id,
      service_id:    service.id,
      job_id:        job_id || null,
      title:         service.title,
      amount,
      platform_fee:  fee,
      delivery_days: service.delivery_days || null,
      notes:         notes || null,
      status:        'pending',
      payment_status: 'held',
    }, { transaction: t });

    await wallet.debit(buyerId, amount, {
      type: 'booking_payment', booking_id: b.id,
      note: `Payment held for booking #${b.id} — ${service.title}`,
    }, t);

    return b;
  });
  // Notify seller of new booking
  const seller = await User.findByPk(service.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.bookingCreated(seller, booking);

  // Bump the service order counter
  await Service.increment('orders_count', { by: 1, where: { id: service.id } }).catch(() => {});

  return booking;
};

exports.acceptWork = async (buyerId, id) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.status !== 'amidst_completion')
    throw Object.assign(new Error('Booking is not awaiting acceptance'), { status: 400 });

  // Release escrow → seller earns (amount − fee); platform keeps the fee.
  const amount = Number(booking.amount);
  const fee    = Number(booking.platform_fee);
  const earning = wallet.round2(amount - fee);
  const adminId = await platformAdminId();
  const wasHeld = booking.payment_status === 'held';   // capture BEFORE update

  await sequelize.transaction(async (t) => {
    await booking.update({ status: 'completed', payment_status: wasHeld ? 'released' : booking.payment_status }, { transaction: t });
    if (wasHeld) {
      await wallet.credit(booking.seller_id, earning, {
        type: 'earning', booking_id: booking.id,
        note: `Earning from booking #${booking.id} — ${booking.title}`,
      }, t);
      if (adminId && fee > 0) {
        await wallet.credit(adminId, fee, {
          type: 'platform_fee', booking_id: booking.id,
          note: `Platform fee from booking #${booking.id}`,
        }, t);
      }
    }
  });

  // Notify seller work was accepted
  const seller = await User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.workAccepted(seller, booking);
  return booking;
};

exports.rejectWork = async (buyerId, id, dispute_reason) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.status !== 'amidst_completion')
    throw Object.assign(new Error('Booking is not awaiting acceptance'), { status: 400 });

  await booking.update({ status: 'in_dispute', dispute_reason: dispute_reason || null });
  // Notify seller dispute was raised, and admin so it can be resolved
  const [seller, buyer] = await Promise.all([
    User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] }),
    User.findByPk(buyerId, { attributes: ['name'] }),
  ]);
  if (seller) notify.disputeRaised(seller, booking);
  notify.disputeRaisedAdmin(buyer && buyer.name, booking);
  return booking;
};

exports.cancelBooking = async (buyerId, id, cancel_reason) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (!['pending', 'ongoing'].includes(booking.status))
    throw Object.assign(new Error('Cannot cancel booking at this stage'), { status: 400 });

  // Refund the held escrow back to the buyer's wallet.
  await sequelize.transaction(async (t) => {
    const wasHeld = booking.payment_status === 'held';
    await booking.update({
      status: 'cancelled',
      cancel_reason: cancel_reason || null,
      payment_status: wasHeld ? 'refunded' : booking.payment_status,
    }, { transaction: t });
    if (wasHeld) {
      await wallet.credit(booking.buyer_id, Number(booking.amount), {
        type: 'booking_refund', booking_id: booking.id,
        note: `Refund for cancelled booking #${booking.id}`,
      }, t);
    }
  });

  // Notify seller booking was cancelled by buyer
  const seller = await User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.bookingCancelledByBuyer(seller, booking);
  return booking;
};
