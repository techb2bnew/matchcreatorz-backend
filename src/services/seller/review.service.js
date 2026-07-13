'use strict';
const { Review, User, Service, Booking } = require('../../models');

const listReceivedReviews = async (sellerId, { page = 1, limit = 20 }) => {
  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Review.findAndCountAll({
    where: { seller_id: sellerId, status: 'published' },
    include: [
      { model: User,    as: 'buyer',   attributes: ['id', 'name', 'email'] },
      { model: Service, as: 'service', attributes: ['id', 'title'], required: false },
      { model: Booking, as: 'booking', attributes: ['id', 'title'], required: false },
    ],
    order: [['created_at', 'DESC']],
    limit: Number(limit),
    offset,
  });
  return { reviews: rows, total: count, page: Number(page), limit: Number(limit) };
};

module.exports = { listReceivedReviews };
