'use strict';
const { Op, fn, col, literal } = require('sequelize');
const { Booking, User, Service, Review } = require('../../models');

exports.getDashboardStats = async (sellerId) => {
  const [
    activeBookings,
    completedBookings,
    totalEarnings,
    totalServices,
    reviewStats,
    recentBookings,
    monthlyEarnings,
  ] = await Promise.all([
    Booking.count({
      where: { seller_id: sellerId, status: { [Op.in]: ['pending', 'ongoing', 'amidst_completion'] } },
    }),
    Booking.count({ where: { seller_id: sellerId, status: 'completed' } }),
    Booking.sum('amount', { where: { seller_id: sellerId, status: 'completed' } }),
    Service.count({ where: { seller_id: sellerId, deleted_at: null } }),

    Review.findOne({
      attributes: [
        [fn('AVG', col('rating')), 'avg_rating'],
        [fn('COUNT', col('id')),   'total'],
      ],
      where: { seller_id: sellerId, status: 'published' },
      raw: true,
    }),

    // Recent 5 bookings
    Booking.findAll({
      where:   { seller_id: sellerId },
      include: [
        { model: User,    as: 'buyer',   attributes: ['id', 'name'] },
        { model: Service, as: 'service', attributes: ['id', 'title'], required: false },
      ],
      order: [['created_at', 'DESC']],
      limit: 5,
    }),

    // Last 6 months earnings
    Booking.findAll({
      attributes: [
        [fn('TO_CHAR', col('created_at'), 'Mon'), 'month'],
        [fn('DATE_TRUNC', 'month', col('created_at')), 'month_date'],
        [fn('SUM', col('amount')), 'amount'],
      ],
      where: {
        seller_id:  sellerId,
        status:     'completed',
        created_at: { [Op.gte]: literal("NOW() - INTERVAL '6 months'") },
      },
      group: [fn('DATE_TRUNC', 'month', col('created_at')), fn('TO_CHAR', col('created_at'), 'Mon')],
      order: [[fn('DATE_TRUNC', 'month', col('created_at')), 'ASC']],
      raw: true,
    }),
  ]);

  return {
    stats: {
      activeBookings,
      completedBookings,
      totalEarnings:  totalEarnings  || 0,
      totalServices,
      avgRating:      parseFloat(reviewStats?.avg_rating || 0).toFixed(1),
      totalReviews:   parseInt(reviewStats?.total || 0),
    },
    recentBookings,
    monthlyEarnings: monthlyEarnings.map(r => ({
      month:  r.month,
      amount: parseFloat(r.amount) || 0,
    })),
  };
};
