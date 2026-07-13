'use strict';
const { Review, Booking, Service, User } = require('../../models');
const { fn, col } = require('sequelize');

const createReview = async (buyerId, { booking_id, rating, comment }) => {
  if (!booking_id || !rating)  throw { statusCode: 400, message: 'booking_id and rating are required' };
  if (rating < 1 || rating > 5) throw { statusCode: 400, message: 'Rating must be between 1 and 5' };

  const booking = await Booking.findOne({ where: { id: booking_id, buyer_id: buyerId } });
  if (!booking)                throw { statusCode: 404, message: 'Booking not found' };
  if (booking.status !== 'completed')
    throw { statusCode: 400, message: 'You can only review completed bookings' };

  const already = await Review.findOne({ where: { booking_id, buyer_id: buyerId } });
  if (already) throw { statusCode: 400, message: 'You have already reviewed this booking' };

  const review = await Review.create({
    buyer_id:   buyerId,
    seller_id:  booking.seller_id,
    service_id: booking.service_id || null,
    booking_id,
    rating:     Number(rating),
    comment:    comment?.trim() || null,
    status:     'published',
  });

  // Recalculate service rating
  if (booking.service_id) {
    await recalcServiceRating(booking.service_id);
  }

  return review;
};

const listMyReviews = async (buyerId, { page = 1, limit = 20 }) => {
  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Review.findAndCountAll({
    where: { buyer_id: buyerId },
    include: [
      { model: User,    as: 'seller',  attributes: ['id', 'name', 'email'] },
      { model: Service, as: 'service', attributes: ['id', 'title'], required: false },
      { model: Booking, as: 'booking', attributes: ['id', 'title'], required: false },
    ],
    order: [['created_at', 'DESC']],
    limit: Number(limit),
    offset,
  });
  return { reviews: rows, total: count, page: Number(page), limit: Number(limit) };
};

async function recalcServiceRating(serviceId) {
  const agg = await Review.findOne({
    where: { service_id: serviceId, status: 'published' },
    attributes: [
      [fn('AVG', col('rating')), 'avg_rating'],
      [fn('COUNT', col('id')),   'total'],
    ],
    raw: true,
  });
  await Service.update(
    {
      rating:        Math.round(Number(agg.avg_rating || 0) * 10) / 10,
      reviews_count: Number(agg.total || 0),
    },
    { where: { id: serviceId } }
  );
}

module.exports = { createReview, listMyReviews, recalcServiceRating };
