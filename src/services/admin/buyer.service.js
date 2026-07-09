'use strict';
const bcrypt     = require('bcryptjs');
const { Op }     = require('sequelize');
const { User, BuyerProfile } = require('../../models/index');
const { sendAdminWelcome }   = require('../../helpers/email.helper');

const buyerInclude = {
  model:      BuyerProfile,
  as:         'buyerProfile',
  attributes: ['id','company_name','city','country','profile_image'],
};

// ── List buyers ───────────────────────────────────────────────────────
const listBuyers = async ({ page = 1, limit = 10, search, status }) => {
  const offset = (page - 1) * limit;

  const userWhere = { role: 'BUYER' };
  if (status) userWhere.status = status;
  if (search) userWhere[Op.or] = [
    { name:  { [Op.iLike]: `%${search}%` } },
    { email: { [Op.iLike]: `%${search}%` } },
  ];

  const { rows, count } = await User.findAndCountAll({
    where:    userWhere,
    include:  [buyerInclude],
    order:    [['createdAt', 'DESC']],
    limit:    Number(limit),
    offset,
    distinct: true,
  });

  return { buyers: rows.map(formatBuyer), total: count, page: Number(page), limit: Number(limit) };
};

// ── Get buyer by ID ───────────────────────────────────────────────────
const getBuyerById = async (id) => {
  const user = await User.findOne({
    where:   { id, role: 'BUYER' },
    include: [buyerInclude],
  });
  if (!user) throw { statusCode: 404, message: 'Buyer not found' };
  return formatBuyer(user);
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

// ── Block buyer ───────────────────────────────────────────────────────
const blockBuyer = async (id) => {
  const user = await User.findOne({ where: { id, role: 'BUYER' } });
  if (!user) throw { statusCode: 404, message: 'Buyer not found' };
  if (user.status === 'banned') throw { statusCode: 400, message: 'Buyer is already blocked' };

  await user.update({ status: 'banned' });
  return { status: 'banned' };
};

// ── Unblock buyer ─────────────────────────────────────────────────────
const unblockBuyer = async (id) => {
  const user = await User.findOne({ where: { id, role: 'BUYER' } });
  if (!user) throw { statusCode: 404, message: 'Buyer not found' };
  if (user.status !== 'banned') throw { statusCode: 400, message: 'Buyer is not blocked' };

  await user.update({ status: 'active' });
  return { status: 'active' };
};

// ── Format helper ─────────────────────────────────────────────────────
const formatBuyer = (user) => ({
  id:          user.id,
  name:        user.name,
  email:       user.email,
  phone:       user.phone,
  status:      user.status,
  is_verified: user.is_verified,
  joined:      user.createdAt,
  profile:     user.buyerProfile || null,
});

module.exports = { listBuyers, getBuyerById, addBuyer, editBuyer, blockBuyer, unblockBuyer };
