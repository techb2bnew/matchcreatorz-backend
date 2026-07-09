'use strict';
const { Op }       = require('sequelize');
const { Service, Category, User, SellerProfile } = require('../../models/index');

// ── List all services ─────────────────────────────────────────────────
const listServices = async ({ page = 1, limit = 10, search, status, category_id }) => {
  const offset = (page - 1) * limit;
  const where  = {};

  if (search)      where.title       = { [Op.iLike]: `%${search}%` };
  if (status)      where.status      = status;
  if (category_id) where.category_id = category_id;

  const { rows, count } = await Service.findAndCountAll({
    where,
    include: [
      {
        model:      User,
        as:         'seller',
        attributes: ['id', 'name', 'email'],
      },
      {
        model:      Category,
        as:         'category',
        attributes: ['id', 'name', 'icon'],
      },
    ],
    order:  [['created_at', 'DESC']],
    limit:  Number(limit),
    offset,
  });

  return { services: rows, total: count, page: Number(page), limit: Number(limit) };
};

// ── Get one service ───────────────────────────────────────────────────
const getServiceById = async (id) => {
  const svc = await Service.findByPk(id, {
    include: [
      { model: User,     as: 'seller',   attributes: ['id', 'name', 'email'] },
      { model: Category, as: 'category', attributes: ['id', 'name', 'icon'] },
    ],
  });
  if (!svc) throw { statusCode: 404, message: 'Service not found' };
  return svc;
};

// ── Reject service ────────────────────────────────────────────────────
const rejectService = async (id) => {
  const svc = await Service.findByPk(id);
  if (!svc) throw { statusCode: 404, message: 'Service not found' };
  await svc.update({ status: 'rejected' });
  return svc;
};

// ── Restore (rejected → active) ───────────────────────────────────────
const restoreService = async (id) => {
  const svc = await Service.findByPk(id);
  if (!svc) throw { statusCode: 404, message: 'Service not found' };
  await svc.update({ status: 'active' });
  return svc;
};

// ── Toggle featured ───────────────────────────────────────────────────
const toggleFeatured = async (id) => {
  const svc = await Service.findByPk(id);
  if (!svc) throw { statusCode: 404, message: 'Service not found' };
  await svc.update({ is_featured: !svc.is_featured });
  return svc;
};

// ── Delete service ────────────────────────────────────────────────────
const deleteService = async (id) => {
  const svc = await Service.findByPk(id);
  if (!svc) throw { statusCode: 404, message: 'Service not found' };
  await svc.destroy();
  return { deleted: true };
};

module.exports = { listServices, getServiceById, rejectService, restoreService, toggleFeatured, deleteService };
