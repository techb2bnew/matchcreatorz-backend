'use strict';
const bcrypt      = require('bcryptjs');
const { Op }      = require('sequelize');
const { User, SellerProfile } = require('../../models/index');
const { sendAdminWelcome }    = require('../../helpers/email.helper');

const sellerInclude = {
  model:      SellerProfile,
  as:         'sellerProfile',
  attributes: ['id','bio','skills','hourly_rate','city','country','profile_image',
                'resume','portfolio_files','portfolio_links','rating','total_reviews',
                'connects_balance','is_available','approval_status'],
};

// ── List sellers ─────────────────────────────────────────────────────
const listSellers = async ({ page = 1, limit = 10, search, approval_status, status }) => {
  const offset = (page - 1) * limit;

  const userWhere = { role: 'SELLER' };
  if (status)  userWhere.status = status;
  if (search)  userWhere[Op.or] = [
    { name:  { [Op.iLike]: `%${search}%` } },
    { email: { [Op.iLike]: `%${search}%` } },
  ];

  const profileWhere = {};
  if (approval_status) profileWhere.approval_status = approval_status;

  const { rows, count } = await User.findAndCountAll({
    where:   userWhere,
    include: [{
      ...sellerInclude,
      where:    Object.keys(profileWhere).length ? profileWhere : undefined,
      required: !!Object.keys(profileWhere).length,
    }],
    order:  [['createdAt', 'DESC']],
    limit:  Number(limit),
    offset,
    distinct: true,
  });

  return {
    sellers: rows.map(formatSeller),
    total: count,
    page:  Number(page),
    limit: Number(limit),
  };
};

// ── Get seller by ID ──────────────────────────────────────────────────
const getSellerById = async (id) => {
  const user = await User.findOne({
    where:   { id, role: 'SELLER' },
    include: [sellerInclude],
  });
  if (!user) throw { statusCode: 404, message: 'Seller not found' };
  return formatSeller(user);
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
  return { approval_status: 'approved' };
};

// ── Reject seller ─────────────────────────────────────────────────────
const rejectSeller = async (id) => {
  const user = await User.findOne({ where: { id, role: 'SELLER' }, include: [sellerInclude] });
  if (!user) throw { statusCode: 404, message: 'Seller not found' };
  if (!user.sellerProfile) throw { statusCode: 400, message: 'Seller profile not found' };

  await user.sellerProfile.update({ approval_status: 'rejected' });
  await user.update({ status: 'inactive' });   // block login on rejection
  return { approval_status: 'rejected' };
};

// ── Block seller ──────────────────────────────────────────────────────
const blockSeller = async (id) => {
  const user = await User.findOne({ where: { id, role: 'SELLER' } });
  if (!user) throw { statusCode: 404, message: 'Seller not found' };
  if (user.status === 'banned') throw { statusCode: 400, message: 'Seller is already blocked' };

  await user.update({ status: 'banned' });
  return { status: 'banned' };
};

// ── Unblock seller ────────────────────────────────────────────────────
const unblockSeller = async (id) => {
  const user = await User.findOne({ where: { id, role: 'SELLER' } });
  if (!user) throw { statusCode: 404, message: 'Seller not found' };
  if (user.status !== 'banned') throw { statusCode: 400, message: 'Seller is not blocked' };

  await user.update({ status: 'active' });
  return { status: 'active' };
};

// ── Format helper ──────────────────────────────────────────────────────
const formatSeller = (user) => ({
  id:          user.id,
  name:        user.name,
  email:       user.email,
  phone:       user.phone,
  status:      user.status,
  is_verified: user.is_verified,
  joined:      user.createdAt,
  profile:     user.sellerProfile || null,
});

module.exports = { listSellers, getSellerById, addSeller, editSeller, approveSeller, rejectSeller, blockSeller, unblockSeller };
