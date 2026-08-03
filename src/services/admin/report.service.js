'use strict';
const { Op, fn, col } = require('sequelize');
const {
  User, Booking, WalletTransaction, ConnectTransaction,
  SellerProfile, Withdrawal,
} = require('../../models');

const REPORT_TYPES = [
  { key: 'revenue',  label: 'Revenue',            description: 'Platform fee revenue over time' },
  { key: 'bookings', label: 'Bookings',           description: 'Bookings created, by status, in range' },
  { key: 'users',    label: 'User Signups',       description: 'New buyer / seller signups over time' },
  { key: 'sellers',  label: 'Seller Performance', description: 'Top sellers by earnings, bookings, rating' },
  { key: 'wallet',   label: 'Wallet Activity',    description: 'Top-ups, withdrawals and platform revenue' },
  { key: 'connects', label: 'Connects',           description: 'Connects purchased, credited and spent' },
];

const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

// Default range: last 30 days (inclusive) when no from/to is given.
const resolveRange = (from, to) => {
  const end   = to   ? new Date(`${to}T23:59:59.999Z`)   : new Date();
  const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(end.getTime() - 30 * 86400000);
  return { start, end };
};

// Defensive cap on rows returned in a single report (table + CSV export share
// this, so what you see in the UI is exactly what you'd get in the download).
const MAX_ROWS = 5000;

exports.listTypes = () => REPORT_TYPES;

exports.getReport = async (type, { from, to } = {}) => {
  const { start, end } = resolveRange(from, to);
  const range = { [Op.between]: [start, end] };

  switch (type) {
    case 'revenue':  return revenueReport(range);
    case 'bookings': return bookingsReport(range);
    case 'users':    return usersReport(range);
    case 'sellers':  return sellersReport(range);
    case 'wallet':   return walletReport(range);
    case 'connects': return connectsReport(range);
    default: throw Object.assign(new Error('Unknown report type'), { status: 400 });
  }
};

// ── Revenue (platform fee) ───────────────────────────────────────────────────
async function revenueReport(range) {
  const rows = await WalletTransaction.findAll({
    where: { type: 'platform_fee', created_at: range },
    order: [['created_at', 'DESC']],
    limit: MAX_ROWS,
  });

  const chartRaw = await WalletTransaction.findAll({
    attributes: [
      [fn('DATE_TRUNC', 'day', col('created_at')), 'date'],
      [fn('SUM', col('amount')), 'revenue'],
    ],
    where: { type: 'platform_fee', created_at: range },
    group: [fn('DATE_TRUNC', 'day', col('created_at'))],
    order: [[fn('DATE_TRUNC', 'day', col('created_at')), 'ASC']],
    raw: true,
  });

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  return {
    summary: { total_revenue: round2(total), transaction_count: rows.length },
    chart:   chartRaw.map((r) => ({ date: r.date, value: round2(r.revenue) })),
    columns: [
      { key: 'id', label: 'ID' }, { key: 'created_at', label: 'Date' },
      { key: 'amount', label: 'Amount' }, { key: 'booking_id', label: 'Booking' },
      { key: 'note', label: 'Note' },
    ],
    rows: rows.map((r) => ({
      id: r.id, created_at: r.created_at, amount: round2(r.amount),
      booking_id: r.booking_id, note: r.note,
    })),
    truncated: rows.length >= MAX_ROWS,
  };
}

// ── Bookings ──────────────────────────────────────────────────────────────
async function bookingsReport(range) {
  const rows = await Booking.findAll({
    where: { created_at: range },
    include: [
      { model: User, as: 'buyer',  attributes: ['id', 'name'] },
      { model: User, as: 'seller', attributes: ['id', 'name'] },
    ],
    order: [['created_at', 'DESC']],
    limit: MAX_ROWS,
  });

  const byStatus = {};
  let totalAmount = 0;
  rows.forEach((b) => {
    byStatus[b.status] = (byStatus[b.status] || 0) + 1;
    totalAmount += Number(b.amount);
  });

  const chartRaw = await Booking.findAll({
    attributes: [
      [fn('DATE_TRUNC', 'day', col('created_at')), 'date'],
      [fn('COUNT', col('id')), 'count'],
    ],
    where: { created_at: range },
    group: [fn('DATE_TRUNC', 'day', col('created_at'))],
    order: [[fn('DATE_TRUNC', 'day', col('created_at')), 'ASC']],
    raw: true,
  });

  return {
    summary: { total_bookings: rows.length, total_amount: round2(totalAmount), by_status: byStatus },
    chart:   chartRaw.map((r) => ({ date: r.date, value: Number(r.count) })),
    columns: [
      { key: 'id', label: 'ID' }, { key: 'title', label: 'Title' },
      { key: 'buyer', label: 'Buyer' }, { key: 'seller', label: 'Seller' },
      { key: 'amount', label: 'Amount' }, { key: 'status', label: 'Status' },
      { key: 'created_at', label: 'Date' },
    ],
    rows: rows.map((b) => ({
      id: b.id, title: b.title, buyer: b.buyer?.name || '-', seller: b.seller?.name || '-',
      amount: round2(b.amount), status: b.status, created_at: b.created_at,
    })),
    truncated: rows.length >= MAX_ROWS,
  };
}

// ── User signups ──────────────────────────────────────────────────────────
async function usersReport(range) {
  const rows = await User.findAll({
    where: { role: { [Op.in]: ['SELLER', 'BUYER'] }, created_at: range },
    attributes: ['id', 'name', 'email', 'role', 'status', 'created_at'],
    order: [['created_at', 'DESC']],
    limit: MAX_ROWS,
  });

  const newSellers = rows.filter((u) => u.role === 'SELLER').length;
  const newBuyers  = rows.filter((u) => u.role === 'BUYER').length;

  const chartRaw = await User.findAll({
    attributes: [
      [fn('DATE_TRUNC', 'day', col('created_at')), 'date'],
      [fn('COUNT', col('id')), 'count'],
    ],
    where: { role: { [Op.in]: ['SELLER', 'BUYER'] }, created_at: range },
    group: [fn('DATE_TRUNC', 'day', col('created_at'))],
    order: [[fn('DATE_TRUNC', 'day', col('created_at')), 'ASC']],
    raw: true,
  });

  return {
    summary: { new_sellers: newSellers, new_buyers: newBuyers, total_new: rows.length },
    chart:   chartRaw.map((r) => ({ date: r.date, value: Number(r.count) })),
    columns: [
      { key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role' }, { key: 'status', label: 'Status' }, { key: 'created_at', label: 'Joined' },
    ],
    rows: rows.map((u) => ({
      id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, created_at: u.created_at,
    })),
    truncated: rows.length >= MAX_ROWS,
  };
}

// ── Seller performance ────────────────────────────────────────────────────
// Ranked by earnings booked in-range (WalletTransaction type='earning', whose
// user_id is the seller who was credited) — not by profile join date.
async function sellersReport(range) {
  const earnings = await WalletTransaction.findAll({
    attributes: ['user_id', [fn('SUM', col('amount')), 'total_earnings'], [fn('COUNT', col('id')), 'payouts']],
    where: { type: 'earning', created_at: range },
    group: ['user_id'],
    raw: true,
  });

  const sellerIds = earnings.map((e) => e.user_id);
  const profiles = sellerIds.length
    ? await SellerProfile.findAll({
        where: { user_id: { [Op.in]: sellerIds } },
        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      })
    : [];
  const profileByUser = new Map(profiles.map((p) => [p.user_id, p]));

  const rows = earnings
    .map((e) => {
      const p = profileByUser.get(e.user_id);
      return {
        id: e.user_id,       // Table component keys rows by `id` — alias of seller_id
        seller_id: e.user_id,
        name: p?.user?.name || `Seller #${e.user_id}`,
        email: p?.user?.email || '-',
        total_earnings: round2(e.total_earnings),
        payouts: Number(e.payouts),
        rating: p ? round2(p.rating) : 0,
        total_reviews: p?.total_reviews || 0,
      };
    })
    .sort((a, b) => b.total_earnings - a.total_earnings)
    .slice(0, 100);

  return {
    summary: { seller_count: rows.length },
    chart:   rows.slice(0, 10).map((r) => ({ date: r.name, value: r.total_earnings })),
    columns: [
      { key: 'seller_id', label: 'ID' }, { key: 'name', label: 'Seller' }, { key: 'email', label: 'Email' },
      { key: 'total_earnings', label: 'Earnings' }, { key: 'payouts', label: 'Payouts' },
      { key: 'rating', label: 'Rating' }, { key: 'total_reviews', label: 'Reviews' },
    ],
    rows,
    truncated: false,
  };
}

// ── Wallet activity ───────────────────────────────────────────────────────
async function walletReport(range) {
  const [topups, withdrawalsPaid, platformFee, rows] = await Promise.all([
    WalletTransaction.sum('amount', { where: { type: 'topup', created_at: range } }),
    Withdrawal.sum('amount', { where: { status: 'paid', processed_at: range } }),
    WalletTransaction.sum('amount', { where: { type: 'platform_fee', created_at: range } }),
    WalletTransaction.findAll({
      where: { type: { [Op.in]: ['topup', 'withdrawal', 'platform_fee'] }, created_at: range },
      order: [['created_at', 'DESC']],
      limit: MAX_ROWS,
    }),
  ]);

  const chartRaw = await WalletTransaction.findAll({
    attributes: [
      [fn('DATE_TRUNC', 'day', col('created_at')), 'date'], 'type',
      [fn('SUM', col('amount')), 'amount'],
    ],
    where: { type: { [Op.in]: ['topup', 'withdrawal'] }, created_at: range },
    group: [fn('DATE_TRUNC', 'day', col('created_at')), 'type'],
    order: [[fn('DATE_TRUNC', 'day', col('created_at')), 'ASC']],
    raw: true,
  });

  return {
    summary: {
      total_topups:            round2(topups || 0),
      total_withdrawals_paid:  round2(Math.abs(withdrawalsPaid || 0)),
      platform_revenue:        round2(platformFee || 0),
    },
    chart: chartRaw.map((r) => ({ date: r.date, type: r.type, value: round2(Math.abs(r.amount)) })),
    columns: [
      { key: 'id', label: 'ID' }, { key: 'type', label: 'Type' }, { key: 'amount', label: 'Amount' },
      { key: 'note', label: 'Note' }, { key: 'created_at', label: 'Date' },
    ],
    rows: rows.map((r) => ({
      id: r.id, type: r.type, amount: round2(r.amount), note: r.note, created_at: r.created_at,
    })),
    truncated: rows.length >= MAX_ROWS,
  };
}

// ── Connects ──────────────────────────────────────────────────────────────
async function connectsReport(range) {
  const rows = await ConnectTransaction.findAll({
    where: { created_at: range },
    include: [{ model: User, as: 'seller', attributes: ['id', 'name'] }],
    order: [['created_at', 'DESC']],
    limit: MAX_ROWS,
  });

  const byType = {};
  rows.forEach((r) => { byType[r.type] = (byType[r.type] || 0) + Number(r.amount); });

  const chartRaw = await ConnectTransaction.findAll({
    attributes: [
      [fn('DATE_TRUNC', 'day', col('created_at')), 'date'],
      [fn('SUM', col('amount')), 'amount'],
    ],
    where: { created_at: range },
    group: [fn('DATE_TRUNC', 'day', col('created_at'))],
    order: [[fn('DATE_TRUNC', 'day', col('created_at')), 'ASC']],
    raw: true,
  });

  return {
    summary: { total_transactions: rows.length, by_type: byType },
    chart:   chartRaw.map((r) => ({ date: r.date, value: Number(r.amount) })),
    columns: [
      { key: 'id', label: 'ID' }, { key: 'seller', label: 'Seller' }, { key: 'type', label: 'Type' },
      { key: 'amount', label: 'Amount' }, { key: 'note', label: 'Note' }, { key: 'created_at', label: 'Date' },
    ],
    rows: rows.map((r) => ({
      id: r.id, seller: r.seller?.name || '-', type: r.type, amount: Number(r.amount),
      note: r.note, created_at: r.created_at,
    })),
    truncated: rows.length >= MAX_ROWS,
  };
}
