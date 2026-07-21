'use strict';
const { Review, User, Service, Booking } = require('../../models');
const { Op, fn, col } = require('sequelize');
const { recalcSellerRating } = require('../buyer/review.service');

const listAllReviews = async ({ search, status, page = 1, limit = 20 }) => {
  const where = {};
  if (status) where.status = status;
  if (search) where.comment = { [Op.iLike]: `%${search}%` };

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Review.findAndCountAll({
    where,
    include: [
      { model: User,    as: 'buyer',   attributes: ['id', 'name', 'email'] },
      { model: User,    as: 'seller',  attributes: ['id', 'name', 'email'] },
      { model: Service, as: 'service', attributes: ['id', 'title'], required: false },
      { model: Booking, as: 'booking', attributes: ['id', 'title'], required: false },
    ],
    order: [['created_at', 'DESC']],
    limit: Number(limit),
    offset,
  });

  const allStatuses = await Review.findAll({ attributes: ['status'], raw: true });
  const summary = { total: allStatuses.length, published: 0, hidden: 0 };
  allStatuses.forEach(r => {
    if (r.status === 'published') summary.published++;
    else summary.hidden++;
  });

  return { reviews: rows, total: count, summary, page: Number(page), limit: Number(limit) };
};

const publishReview = async (id) => {
  const r = await Review.findByPk(id);
  if (!r) throw { statusCode: 404, message: 'Review not found' };
  await r.update({ status: 'published' });
  if (r.service_id) await recalcServiceRating(r.service_id);
  await recalcSellerRating(r.seller_id);
  return r;
};

const hideReview = async (id) => {
  const r = await Review.findByPk(id);
  if (!r) throw { statusCode: 404, message: 'Review not found' };
  await r.update({ status: 'hidden' });
  if (r.service_id) await recalcServiceRating(r.service_id);
  await recalcSellerRating(r.seller_id);
  return r;
};

const deleteReview = async (id) => {
  const r = await Review.findByPk(id);
  if (!r) throw { statusCode: 404, message: 'Review not found' };
  const sid = r.service_id;
  const sellerId = r.seller_id;
  await r.destroy();
  if (sid) await recalcServiceRating(sid);
  await recalcSellerRating(sellerId);
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

module.exports = { listAllReviews, publishReview, hideReview, deleteReview };
