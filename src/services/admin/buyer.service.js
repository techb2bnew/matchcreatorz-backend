'use strict';
const bcrypt     = require('bcryptjs');
const { Op, literal } = require('sequelize');
const { User, BuyerProfile, Booking, Wallet } = require('../../models/index');
const { sendAdminWelcome }   = require('../../helpers/email.helper');
const notify                 = require('../../helpers/notification.helper');

const buyerInclude = {
  model:      BuyerProfile,
  as:         'buyerProfile',
  attributes: ['id','company_name','city','country','profile_image','approval_status'],
};

// Whitelist of columns the grid may sort by, mapped to a Sequelize order path.
// Never interpolate `sortBy` directly into an order clause — only these paths are used.
const SORT_FIELDS = {
  name:            ['name'],
  email:           ['email'],
  user_status:     ['status'],
  joined:          ['createdAt'],
  approval_status: [{ model: BuyerProfile, as: 'buyerProfile' }, 'approval_status'],
};

// These columns aren't raw DB fields — they're computed in JS per-buyer (booking
// count / wallet total), so they can't be pushed into Sequelize's `order`. They're
// sorted in JS after the stats are computed for the full filtered set.
const COMPUTED_SORT_FIELDS = new Set(['bookings_count', 'total_spent']);

// ── List buyers ───────────────────────────────────────────────────────
const listBuyers = async ({ page = 1, limit = 10, search, approval_status, status, deleted, sortBy, sortDir }) => {
  const offset = (page - 1) * limit;
  const direction = sortDir === 'asc' ? 'ASC' : 'DESC';
  const isComputedSort = COMPUTED_SORT_FIELDS.has(sortBy);
  const sortPath = SORT_FIELDS[sortBy] || SORT_FIELDS.joined;

  const userWhere = { role: 'BUYER' };
  if (status) userWhere.status = status;
  if (search) userWhere[Op.or] = [
    { name:  { [Op.iLike]: `%${search}%` } },
    { email: { [Op.iLike]: `%${search}%` } },
  ];

  const showDeleted = deleted === true || deleted === 'true';

  const profileWhere = {};
  if (approval_status) profileWhere.approval_status = approval_status;
  const hasProfileFilter = Object.keys(profileWhere).length > 0;

  const { rows } = await User.findAndCountAll({
    where:    userWhere,
    include:  [{
      ...buyerInclude,
      where:    hasProfileFilter ? profileWhere : undefined,
      paranoid: false,
      // required must flip to true when filtering by a profile field — with
      // required:false, Sequelize puts the where into the JOIN's ON clause
      // instead of filtering rows, so an INNER JOIN is needed to actually filter.
      required: hasProfileFilter,
    }],
    // When sorting by a computed field, the SQL order is irrelevant — the JS
    // sort below re-orders everything once stats are available.
    order:     isComputedSort ? [['createdAt', 'DESC']] : [[...sortPath, direction]],
    paranoid:  false,   // fetch ALL, filter in JS
    distinct:  true,
    subQuery:  false,
  });

  // JS filter — deletedAt value confirmed correct from debug log
  const filtered = showDeleted
    ? rows.filter(r => r.dataValues.deletedAt != null)   // deleted users only
    : rows.filter(r => r.dataValues.deletedAt == null);  // non-deleted only

  const total = filtered.length;

  if (isComputedSort) {
    // Sorting by bookings_count/total_spent requires stats for the ENTIRE
    // filtered set (not just the current page) before we can sort and slice.
    const withStats = await Promise.all(filtered.map(async (u) => {
      const [bookingsCount, wallet] = await Promise.all([
        Booking.count({ where: { buyer_id: u.id } }),
        Wallet.findOne({ where: { user_id: u.id }, attributes: ['total_out'] }),
      ]);
      return { user: u, bookingsCount, totalSpent: Number(wallet?.total_out || 0) };
    }));

    withStats.sort((a, b) => {
      const av = sortBy === 'bookings_count' ? a.bookingsCount : a.totalSpent;
      const bv = sortBy === 'bookings_count' ? b.bookingsCount : b.totalSpent;
      return direction === 'ASC' ? av - bv : bv - av;
    });

    const paginated = withStats.slice(offset, offset + Number(limit));
    const buyers = paginated.map(({ user, bookingsCount, totalSpent }) => formatBuyer(user, bookingsCount, totalSpent));
    return { buyers, total, page: Number(page), limit: Number(limit) };
  }

  // Apply pagination after filter
  const paginated = filtered.slice(offset, offset + Number(limit));

  // Real per-buyer stats (bookings placed, total spent) — only computed for
  // the current page, since the buyer list itself is not paginated at the SQL level.
  const buyers = await Promise.all(paginated.map(async (u) => {
    const [bookingsCount, wallet] = await Promise.all([
      Booking.count({ where: { buyer_id: u.id } }),
      Wallet.findOne({ where: { user_id: u.id }, attributes: ['total_out'] }),
    ]);
    return formatBuyer(u, bookingsCount, Number(wallet?.total_out || 0));
  }));

  return { buyers, total, page: Number(page), limit: Number(limit) };
};

// ── Get buyer by ID ───────────────────────────────────────────────────
const getBuyerById = async (id) => {
  const user = await User.findOne({
    where:   { id, role: 'BUYER' },
    include: [buyerInclude],
  });
  if (!user) throw { statusCode: 404, message: 'Buyer not found' };
  const [bookingsCount, wallet] = await Promise.all([
    Booking.count({ where: { buyer_id: user.id } }),
    Wallet.findOne({ where: { user_id: user.id }, attributes: ['total_out'] }),
  ]);
  return formatBuyer(user, bookingsCount, Number(wallet?.total_out || 0));
};

// ── Add buyer ─────────────────────────────────────────────────────────
const addBuyer = async ({ name, email, password, phone, company_name, city, country }) => {
  const existing = await User.findOne({ where: { email } });
  if (existing) throw { statusCode: 409, message: 'Email already registered' };

  const hashed = await bcrypt.hash(password, 12);
  const user   = await User.create({ name, email, password: hashed, phone: phone || null, role: 'BUYER', status: 'active', is_verified: true });

  await BuyerProfile.create({
    user_id:      user.id,
    company_name: company_name || null,
    city:         city         || null,
    country:      country      || null,
  });

  // Send welcome email with credentials (fire-and-forget)
  sendAdminWelcome(email, name, 'Buyer', password).catch(err =>
    console.error('⚠️  Welcome email failed:', err.message)
  );

  return getBuyerById(user.id);
};

// ── Edit buyer ────────────────────────────────────────────────────────
const editBuyer = async (id, data) => {
  const user = await User.findOne({ where: { id, role: 'BUYER' }, include: [buyerInclude] });
  if (!user) throw { statusCode: 404, message: 'Buyer not found' };

  const { name, phone, status, company_name, city, country } = data;

  if (name || phone || status) {
    await user.update({ name: name||user.name, phone: phone||user.phone, ...(status && { status }) });
  }
  if (user.buyerProfile) {
    await user.buyerProfile.update({
      ...(company_name !== undefined && { company_name }),
      ...(city         !== undefined && { city }),
      ...(country      !== undefined && { country }),
    });
  }
  return getBuyerById(id);
};

// ── Approve buyer ─────────────────────────────────────────────────────
const approveBuyer = async (id) => {
  const user = await User.findOne({ where: { id, role: 'BUYER' }, include: [buyerInclude] });
  if (!user) throw { statusCode: 404, message: 'Buyer not found' };
  if (!user.buyerProfile) throw { statusCode: 400, message: 'Buyer profile not found' };

  await user.buyerProfile.update({ approval_status: 'approved' });
  await user.update({ status: 'active' });
  notify.buyerApproved(user);
  return { approval_status: 'approved' };
};

// ── Reject buyer ──────────────────────────────────────────────────────
const rejectBuyer = async (id) => {
  const user = await User.findOne({ where: { id, role: 'BUYER' }, include: [buyerInclude] });
  if (!user) throw { statusCode: 404, message: 'Buyer not found' };
  if (!user.buyerProfile) throw { statusCode: 400, message: 'Buyer profile not found' };

  await user.buyerProfile.update({ approval_status: 'rejected' });
  await user.update({ status: 'inactive' });   // block login on rejection
  notify.buyerRejected(user);
  return { approval_status: 'rejected' };
};

// ── Block buyer ───────────────────────────────────────────────────────
const blockBuyer = async (id) => {
  const user = await User.findOne({ where: { id, role: 'BUYER' } });
  if (!user) throw { statusCode: 404, message: 'Buyer not found' };
  if (user.status === 'banned') throw { statusCode: 400, message: 'Buyer is already blocked' };

  await user.update({ status: 'banned' });
  notify.buyerBlocked(user);
  return { status: 'banned' };
};

// ── Unblock buyer ─────────────────────────────────────────────────────
const unblockBuyer = async (id) => {
  const user = await User.findOne({ where: { id, role: 'BUYER' } });
  if (!user) throw { statusCode: 404, message: 'Buyer not found' };
  if (user.status !== 'banned') throw { statusCode: 400, message: 'Buyer is not blocked' };

  await user.update({ status: 'active' });
  notify.buyerUnblocked(user);
  return { status: 'active' };
};

// ── Format helper ─────────────────────────────────────────────────────
const formatBuyer = (user, bookingsCount = 0, totalSpent = 0) => ({
  id:          user.id,
  name:        user.name,
  email:       user.email,
  phone:       user.phone,
  status:      user.status,
  is_verified: user.is_verified,
  joined:      user.createdAt,
  profile:     user.buyerProfile || null,
  bookings_count: bookingsCount,
  total_spent:    totalSpent,
});

module.exports = { listBuyers, getBuyerById, addBuyer, editBuyer, approveBuyer, rejectBuyer, blockBuyer, unblockBuyer };
