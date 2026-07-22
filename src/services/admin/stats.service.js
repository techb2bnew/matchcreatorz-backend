'use strict';
const { Op, fn, col, literal } = require('sequelize');
const { User, Booking, Service, Review, Job } = require('../../models');
const cache = require('../../helpers/cache.helper');

exports.getDashboardStats = async () => {
  const cached = cache.get('admin_stats');
  if (cached) return cached;
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
    totalJobs,
    openJobs,
  ] = await Promise.all([
    // Total users = buyers + sellers only (exclude ADMIN accounts)
    User.count({ where: { role: { [Op.in]: ['SELLER', 'BUYER'] } } }),
    User.count({ where: { role: 'SELLER' } }),
    User.count({ where: { role: 'BUYER'  } }),
    Service.count(),
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

    Job.count({ paranoid: false }).catch(() => 0),
    Job.count({ where: { status: 'OPEN' }, paranoid: false }).catch(() => 0),
  ]);

  const result = {
    stats: {
      totalUsers,
      totalSellers,
      totalBuyers,
      totalServices,
      totalBookings,
      completedBookings,
      pendingBookings,
      totalJobs,
      openJobs,
      totalRevenue: totalRevenue || 0,
    },
    recentBookings,
    monthlyRevenue: monthlyRevenue.map(r => ({
      month:    r.month,
      revenue:  parseFloat(r.revenue) || 0,
      bookings: parseInt(r.bookings)  || 0,
    })),
  };

  cache.set('admin_stats', result, 60);
  return result;
};
