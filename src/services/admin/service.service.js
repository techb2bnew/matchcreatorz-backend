'use strict';
const { Op }       = require('sequelize');
const { Service, Category, User, SellerProfile } = require('../../models/index');

// Whitelist of columns the grid may sort by, mapped to a Sequelize order path.
// Never interpolate sortBy directly into the order clause -- only pass values
// through this whitelist (protects against SQL-injection-via-column-name).
const SORT_FIELDS = {
  title:    ['title'],
  seller:   [{ model: User,     as: 'seller'   }, 'name'],
  category: [{ model: Category, as: 'category' }, 'name'],
  price:    ['price'],
  orders:   ['orders_count'],
  status:   ['status'],
  date:     ['created_at'],
};

// ── List all services ─────────────────────────────────────────────────
const listServices = async ({ page = 1, limit = 10, search, status, category_id, sortBy, sortDir }) => {
  const offset = (page - 1) * limit;
  const where  = {};

  if (search)      where.title       = { [Op.iLike]: `%${search}%` };
  if (status)      where.status      = status;
  if (category_id) where.category_id = category_id;

  const sortPath  = SORT_FIELDS[sortBy] || SORT_FIELDS.date;
  const direction = sortDir === 'asc' ? 'ASC' : 'DESC';

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
    order:     [[...sortPath, direction]],
    limit:     Number(limit),
    offset,
    distinct:  true,
    subQuery:  false,
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
