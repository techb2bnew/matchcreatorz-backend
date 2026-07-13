'use strict';
const { Op, fn, col, literal } = require('sequelize');
const { User, Booking, Service, Review } = require('../../models');

exports.getDashboardStats = async () => {
  const [
    totalUsers,
    totalSellers,
    totalBuyers,
    totalServices,
    totalBookings,
    completedBookings,
    totalRevenue,
    pendingBookings,
    recentBookings,
    monthlyRevenue,
  ] = await Promise.all([
    User.count({ where: { deleted_at: null } }),
    User.count({ where: { role: 'SELLER', deleted_at: null } }),
    User.count({ where: { role: 'BUYER',  deleted_at: null } }),
    Service.count({ where: { deleted_at: null } }),
    Booking.count(),
    Booking.count({ where: { status: 'completed' } }),
    Booking.sum('platform_fee', { where: { status: 'completed' } }),
    Booking.count({ where: { status: 'pending' } }),

    // Recent 5 bookings
    Booking.findAll({
      include: [
        { model: User,    as: 'buyer',   attributes: ['id', 'name'] },
        { model: User,    as: 'seller',  attributes: ['id', 'name'] },
        { model: Service, as: 'service', attributes: ['id', 'title'], required: false },
      ],
      order:  [['created_at', 'DESC']],
      limit:  5,
    }),

    // Last 6 months revenue
    Booking.findAll({
      attributes: [
        [fn('TO_CHAR', col('created_at'), 'Mon'), 'month'],
        [fn('DATE_TRUNC', 'month', col('created_at')), 'month_date'],
        [fn('SUM', col('platform_fee')), 'revenue'],
        [fn('COUNT', col('id')), 'bookings'],
      ],
      where: {
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
      totalUsers,
      totalSellers,
      totalBuyers,
      totalServices,
      totalBookings,
      completedBookings,
      pendingBookings,
      totalRevenue: totalRevenue || 0,
    },
    recentBookings,
    monthlyRevenue: monthlyRevenue.map(r => ({
      month:    r.month,
      revenue:  parseFloat(r.revenue) || 0,
      bookings: parseInt(r.bookings)  || 0,
    })),
  };
};
