'use strict';
const { Op }                          = require('sequelize');
const { Booking, User, Service, Job } = require('../../models');
const notify                          = require('../../helpers/notification.helper');

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

exports.listBookings = async (sellerId, { tab = 'active', page = 1, limit = 20 }) => {
  const statuses = STATUS_MAP[tab] || STATUS_MAP.active;
  const offset   = (Number(page) - 1) * Number(limit);

  const { count, rows } = await Booking.findAndCountAll({
    where:    { seller_id: sellerId, status: { [Op.in]: statuses } },
    include:  INCLUDE,
    order:    [['created_at', 'DESC']],
    limit:    Number(limit),
    offset,
    distinct: true,
  });

  return { data: rows, total: count, page: Number(page), limit: Number(limit) };
};

exports.getBooking = async (sellerId, id) => {
  const booking = await Booking.findOne({ where: { id, seller_id: sellerId }, include: INCLUDE });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  return booking;
};

exports.acceptOrder = async (sellerId, id) => {
  const booking = await Booking.findOne({ where: { id, seller_id: sellerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.status !== 'pending')
    throw Object.assign(new Error('Booking is not pending'), { status: 400 });

  await booking.update({ status: 'ongoing' });
  // Notify buyer that seller accepted
  const buyer = await User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (buyer) notify.bookingAccepted(buyer, booking);
  return booking;
};

exports.submitWork = async (sellerId, id) => {
  const booking = await Booking.findOne({ where: { id, seller_id: sellerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.status !== 'ongoing')
    throw Object.assign(new Error('Booking must be ongoing to submit work'), { status: 400 });

  await booking.update({ status: 'amidst_completion' });
  // Notify buyer that work has been submitted
  const buyer = await User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (buyer) notify.workSubmitted(buyer, booking);
  return booking;
};

exports.cancelBooking = async (sellerId, id, cancel_reason) => {
  const booking = await Booking.findOne({ where: { id, seller_id: sellerId } });
  if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
  if (booking.status !== 'pending')
    throw Object.assign(new Error('Only pending bookings can be cancelled by seller'), { status: 400 });

  await booking.update({ status: 'cancelled', cancel_reason: cancel_reason || null });
  // Notify buyer that seller cancelled
  const buyer = await User.findByPk(booking.buyer_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  if (buyer) notify.bookingCancelledBySeller(buyer, booking);
  return booking;
};
