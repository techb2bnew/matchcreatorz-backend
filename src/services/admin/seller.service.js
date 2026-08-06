'use strict';
const bcrypt      = require('bcryptjs');
const { Op, literal, fn, col, where: whereFn } = require('sequelize');
const { User, SellerProfile, Booking, WalletTransaction } = require('../../models/index');
const { sendAdminWelcome }    = require('../../helpers/email.helper');
const notify                  = require('../../helpers/notification.helper');

const sellerInclude = {
  model:      SellerProfile,
  as:         'sellerProfile',
  attributes: ['id','bio','skills','hourly_rate','city','country','profile_image',
                'resume','portfolio_files','portfolio_links','rating','total_reviews',
                'connects_balance','is_available','approval_status'],
};

// Whitelist of columns the Sellers grid may sort by, mapped to a Sequelize
// order path. Security requirement: never interpolate sortBy directly into
// an order clause (SQL-injection-via-column-name risk) — only pass through
// this whitelist.
const SORT_FIELDS = {
  name:       ['name'],
  hourlyRate: [{ model: SellerProfile, as: 'sellerProfile' }, 'hourly_rate'],
  rating:     [{ model: SellerProfile, as: 'sellerProfile' }, 'rating'],
  status:     [{ model: SellerProfile, as: 'sellerProfile' }, 'approval_status'],
  userStatus: ['status'],
  joined:     ['createdAt'],
};

// ── List sellers ─────────────────────────────────────────────────────
const listSellers = async ({ page = 1, limit = 10, search, approval_status, status, deleted, sortBy, sortDir }) => {
  const offset = (page - 1) * limit;

  const userWhere = { role: 'SELLER' };
  if (status)  userWhere.status = status;
  if (search) {
    const term = search.trim();
    const safe = term.replace(/'/g, "''");
    userWhere[Op.or] = [
      { name:  { [Op.iLike]: `%${term}%` } },
      { email: { [Op.iLike]: `%${term}%` } },
      // `status` is a Postgres ENUM, `hourly_rate`/`rating` are numeric — ILIKE
      // needs an explicit ::text cast on all three, or Postgres errors
      // ("operator does not exist") rather than just not matching.
      literal(`"User"."status"::text ILIKE '%${safe}%'`),
      literal(`"sellerProfile"."hourly_rate"::text ILIKE '%${safe}%'`),
      literal(`"sellerProfile"."rating"::text ILIKE '%${safe}%'`),
      literal(`"sellerProfile"."approval_status"::text ILIKE '%${safe}%'`),
      // skills is a text array — search each element.
      literal(`EXISTS (SELECT 1 FROM unnest("sellerProfile"."skills") sk WHERE sk ILIKE '%${safe}%')`),
    ];

    // Support matching by the "Joined" date shown in the UI (e.g. "Aug 3, 2026").
    const parsedDate = new Date(term);
    if (!isNaN(parsedDate.getTime())) {
      const dayStart = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
      const dayEnd   = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      userWhere[Op.or].push({ createdAt: { [Op.gte]: dayStart, [Op.lt]: dayEnd } });
    }
  }

  const showDeleted = deleted === true || deleted === 'true';

  const profileWhere = {};
  if (approval_status) profileWhere.approval_status = approval_status;
  const hasProfileFilter = Object.keys(profileWhere).length > 0;

  const sortPath  = SORT_FIELDS[sortBy] || SORT_FIELDS.joined;
  const direction = sortDir === 'asc' ? 'ASC' : 'DESC';

  const { rows } = await User.findAndCountAll({
    where:   userWhere,
    include: [{
      ...sellerInclude,
      where:    hasProfileFilter ? profileWhere : undefined,
      // required must flip to true when filtering by a profile field — with
      // required:false, Sequelize puts the where into the JOIN's ON clause
      // instead of filtering rows, so an INNER JOIN is needed to actually filter.
      required: hasProfileFilter,
      paranoid: false,
    }],
    order:    [[...sortPath, direction]],
    paranoid: false,   // fetch ALL (deleted + non-deleted), filter in JS
    distinct: true,
  });

  // JS filter — deletedAt value confirmed correct from debug log
  const filtered = showDeleted
    ? rows.filter(r => r.dataValues.deletedAt != null)   // deleted users only
    : rows.filter(r => r.dataValues.deletedAt == null);  // non-deleted only

  // Apply pagination after filter
  const total    = filtered.length;
  const paginated = filtered.slice(offset, offset + Number(limit));

  // Real per-seller stats (completed jobs, lifetime earnings) — only computed
  // for the current page, since the seller list itself is not paginated at the SQL level.
  const sellers = await Promise.all(paginated.map(async (u) => {
    const [jobsCount, earnings] = await Promise.all([
      Booking.count({ where: { seller_id: u.id, status: 'completed' } }),
      WalletTransaction.sum('amount', { where: { user_id: u.id, type: 'earning' } }),
    ]);
    return formatSeller(u, jobsCount, Number(earnings || 0));
  }));

  return {
    sellers,
    total,
    page:    Number(page),
    limit:   Number(limit),
  };
};

// ── Get seller by ID ──────────────────────────────────────────────────
const getSellerById = async (id) => {
  const user = await User.findOne({
    where:   { id, role: 'SELLER' },
    include: [sellerInclude],
  });
  if (!user) throw { statusCode: 404, message: 'Seller not found' };
  const [jobsCount, earnings] = await Promise.all([
    Booking.count({ where: { seller_id: user.id, status: 'completed' } }),
    WalletTransaction.sum('amount', { where: { user_id: user.id, type: 'earning' } }),
  ]);
  return formatSeller(user, jobsCount, Number(earnings || 0));
};

// ── Add seller ────────────────────────────────────────────────────────
const addSeller = async ({ name, email, password, phone, bio, skills, hourly_rate, city, country, company_name }) => {
  const existing = await User.findOne({ where: { email } });
  if (existing) throw { statusCode: 409, message: 'Email already registered' };

  const hashed = await bcrypt.hash(password, 12);
  const user   = await User.create({ name, email, password: hashed, phone: phone || null, role: 'SELLER', status: 'active', is_verified: true });

  await SellerProfile.create({
    user_id:         user.id,
    bio:             bio        || null,
    skills:          skills     || [],
    hourly_rate:     hourly_rate|| 0,
    city:            city       || null,
    country:         country    || null,
    approval_status: 'approved',
  });

  // Send welcome email with credentials (fire-and-forget)
  sendAdminWelcome(email, name, 'Seller', password).catch(err =>
    console.error('⚠️  Welcome email failed:', err.message)
  );

  return getSellerById(user.id);
};

// ── Edit seller ───────────────────────────────────────────────────────
const editSeller = async (id, data) => {
  const user = await User.findOne({ where: { id, role: 'SELLER' }, include: [sellerInclude] });
  if (!user) throw { statusCode: 404, message: 'Seller not found' };

  const { name, phone, status, bio, skills, hourly_rate, city, country, is_available } = data;

  if (name || phone || status) {
    await user.update({ name: name||user.name, phone: phone||user.phone, ...(status && { status }) });
  }
  if (user.sellerProfile) {
    await user.sellerProfile.update({
      ...(bio          !== undefined && { bio }),
      ...(skills       !== undefined && { skills }),
      ...(hourly_rate  !== undefined && { hourly_rate }),
      ...(city         !== undefined && { city }),
      ...(country      !== undefined && { country }),
      ...(is_available !== undefined && { is_available }),
    });
  }
  return getSellerById(id);
};

// ── Approve seller ────────────────────────────────────────────────────
const approveSeller = async (id) => {
  const user = await User.findOne({ where: { id, role: 'SELLER' }, include: [sellerInclude] });
  if (!user) throw { statusCode: 404, message: 'Seller not found' };
  if (!user.sellerProfile) throw { statusCode: 400, message: 'Seller profile not found' };

  await user.sellerProfile.update({ approval_status: 'approved' });
  await user.update({ status: 'active' });
  notify.sellerApproved(user);
  return { approval_status: 'approved' };
};

// ── Reject seller ─────────────────────────────────────────────────────
const rejectSeller = async (id) => {
  const user = await User.findOne({ where: { id, role: 'SELLER' }, include: [sellerInclude] });
  if (!user) throw { statusCode: 404, message: 'Seller not found' };
  if (!user.sellerProfile) throw { statusCode: 400, message: 'Seller profile not found' };

  await user.sellerProfile.update({ approval_status: 'rejected' });
  await user.update({ status: 'inactive' });   // block login on rejection
  notify.sellerRejected(user);
  return { approval_status: 'rejected' };
};

// ── Block seller ──────────────────────────────────────────────────────
const blockSeller = async (id) => {
  const user = await User.findOne({ where: { id, role: 'SELLER' } });
  if (!user) throw { statusCode: 404, message: 'Seller not found' };
  if (user.status === 'banned') throw { statusCode: 400, message: 'Seller is already blocked' };

  await user.update({ status: 'banned' });
  notify.sellerBlocked(user);
  return { status: 'banned' };
};

// ── Unblock seller ────────────────────────────────────────────────────
const unblockSeller = async (id) => {
  const user = await User.findOne({ where: { id, role: 'SELLER' } });
  if (!user) throw { statusCode: 404, message: 'Seller not found' };
  if (user.status !== 'banned') throw { statusCode: 400, message: 'Seller is not blocked' };

  await user.update({ status: 'active' });
  notify.sellerUnblocked(user);
  return { status: 'active' };
};

// ── Format helper ──────────────────────────────────────────────────────
const formatSeller = (user, jobsCount = 0, earnings = 0) => ({
  id:          user.id,
  name:        user.name,
  email:       user.email,
  phone:       user.phone,
  status:      user.status,
  is_verified: user.is_verified,
  joined:      user.createdAt,
  profile:     user.sellerProfile || null,
  jobs_count:  jobsCount,
  earnings,
});

module.exports = { listSellers, getSellerById, addSeller, editSeller, approveSeller, rejectSeller, blockSeller, unblockSeller };
