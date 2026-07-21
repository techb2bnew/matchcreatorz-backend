'use strict';
const { Op }                          = require('sequelize');
const { Booking, User, Service, Job } = require('../../models');
const notify                          = require('../../helpers/notification.helper');

const FEE_PERCENT = 0.10;

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

  const booking = await Booking.create({
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

  await booking.update({ status: 'completed' });
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
  // Notify seller dispute was raised
  const seller = await User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.disputeRaised(seller, booking);
  return booking;
};

exports.cancelBooking = async (buyerId, id, cancel_reason) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (!['pending', 'ongoing'].includes(booking.status))
    throw Object.assign(new Error('Cannot cancel booking at this stage'), { status: 400 });

  await booking.update({ status: 'cancelled', cancel_reason: cancel_reason || null });
  // Notify seller booking was cancelled by buyer
  const seller = await User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (seller) notify.bookingCancelledByBuyer(seller, booking);
  return booking;
};
