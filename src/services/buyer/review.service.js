'use strict';
const { Review, Booking, Service, User, SellerProfile } = require('../../models');
const { fn, col } = require('sequelize');
const notify      = require('../../helpers/notification.helper');

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

  // Recalculate service rating + seller aggregate rating
  if (booking.service_id) {
    await recalcServiceRating(booking.service_id);
  }
  await recalcSellerRating(booking.seller_id);

  // Notify seller of new review
  const seller = await User.findByPk(booking.seller_id, { attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'] });
  const buyer  = await User.findByPk(buyerId,           { attributes: ['id', 'name'] });
  if (seller && buyer) {
    const service = booking.service_id
      ? await Service.findByPk(booking.service_id, { attributes: ['title'] })
      : null;
    notify.reviewReceived(seller, buyer.name, review.rating, service?.title || null);
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
      rating:        Math.round(Number(agg.avg_rating || 0) * 100) / 100,
      reviews_count: Number(agg.total || 0),
    },
    { where: { id: serviceId } }
  );
}

// Recompute the seller's aggregate rating across ALL their published reviews
async function recalcSellerRating(sellerId) {
  const agg = await Review.findOne({
    where: { seller_id: sellerId, status: 'published' },
    attributes: [
      [fn('AVG', col('rating')), 'avg_rating'],
      [fn('COUNT', col('id')),   'total'],
    ],
    raw: true,
  });
  await SellerProfile.update(
    {
      rating:        Math.round(Number(agg.avg_rating || 0) * 100) / 100,
      total_reviews: Number(agg.total || 0),
    },
    { where: { user_id: sellerId } }
  );
}

module.exports = { createReview, listMyReviews, recalcServiceRating, recalcSellerRating };
