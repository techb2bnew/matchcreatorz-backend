'use strict';
const { Op, fn, col, literal } = require('sequelize');
const { Booking, User, Service } = require('../../models');

exports.getDashboardStats = async (buyerId) => {
  const [
    activeBookings,
    completedBookings,
    totalSpent,
    recentBookings,
    monthlySpend,
  ] = await Promise.all([
    Booking.count({
      where: { buyer_id: buyerId, status: { [Op.in]: ['pending', 'ongoing', 'amidst_completion', 'in_dispute'] } },
    }),
    Booking.count({ where: { buyer_id: buyerId, status: 'completed' } }),
    Booking.sum('amount', { where: { buyer_id: buyerId, status: 'completed' } }),

    // Recent 5 bookings
    Booking.findAll({
      where:   { buyer_id: buyerId },
      include: [
        { model: User,    as: 'seller',  attributes: ['id', 'name'] },
        { model: Service, as: 'service', attributes: ['id', 'title', 'images'], required: false },
      ],
      order: [['created_at', 'DESC']],
      limit: 5,
    }),

    // Last 6 months spend
    Booking.findAll({
      attributes: [
        [fn('TO_CHAR', col('created_at'), 'Mon'), 'month'],
        [fn('DATE_TRUNC', 'month', col('created_at')), 'month_date'],
        [fn('SUM', col('amount')), 'amount'],
      ],
      where: {
        buyer_id:   buyerId,
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
      totalSpent: totalSpent || 0,
    },
    recentBookings,
    monthlySpend: monthlySpend.map(r => ({
      month:  r.month,
      amount: parseFloat(r.amount) || 0,
    })),
  };
};
