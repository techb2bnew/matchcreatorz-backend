'use strict';
const { Op }                          = require('sequelize');
const { Booking, User, Service, Job } = require('../../models');

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

exports.createBooking = async (buyerId, { seller_id, service_id, job_id, title, amount, delivery_days, notes }) => {
  if (!seller_id || !title || !amount)
    throw Object.assign(new Error('seller_id, title, and amount are required'), { status: 400 });

  const fee = Math.round(Number(amount) * FEE_PERCENT * 100) / 100;

  return Booking.create({
    buyer_id:      buyerId,
    seller_id:     Number(seller_id),
    service_id:    service_id    || null,
    job_id:        job_id        || null,
    title,
    amount:        Number(amount),
    platform_fee:  fee,
    delivery_days: delivery_days || null,
    notes:         notes         || null,
    status:        'pending',
  });
};

exports.acceptWork = async (buyerId, id) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.status !== 'amidst_completion')
    throw Object.assign(new Error('Booking is not awaiting acceptance'), { status: 400 });

  await booking.update({ status: 'completed' });
  return booking;
};

exports.rejectWork = async (buyerId, id, dispute_reason) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.status !== 'amidst_completion')
    throw Object.assign(new Error('Booking is not awaiting acceptance'), { status: 400 });

  await booking.update({ status: 'in_dispute', dispute_reason: dispute_reason || null });
  return booking;
};

exports.cancelBooking = async (buyerId, id, cancel_reason) => {
  const booking = await Booking.findOne({ where: { id, buyer_id: buyerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (!['pending', 'ongoing'].includes(booking.status))
    throw Object.assign(new Error('Cannot cancel booking at this stage'), { status: 400 });

  await booking.update({ status: 'cancelled', cancel_reason: cancel_reason || null });
  return booking;
};
