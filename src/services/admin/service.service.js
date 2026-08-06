'use strict';
const { Op, literal } = require('sequelize');
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

  if (search) {
    const term = String(search).trim();
    const safe = term.replace(/'/g, "''");
    where[Op.or] = [
      { title:              { [Op.iLike]: `%${term}%` } },
      { '$seller.name$':    { [Op.iLike]: `%${term}%` } },
      { '$category.name$':  { [Op.iLike]: `%${term}%` } },
      // `price`/`orders_count` are numeric and `status` is a Postgres ENUM —
      // ILIKE needs an explicit ::text cast on all three, or Postgres errors
      // ("operator does not exist") rather than just not matching.
      literal(`"Service"."price"::text ILIKE '%${safe}%'`),
      literal(`"Service"."orders_count"::text ILIKE '%${safe}%'`),
      literal(`"Service"."status"::text ILIKE '%${safe}%'`),
    ];

    // Support matching by the date shown in the grid (e.g. "Aug 3, 2026").
    const parsedDate = new Date(term);
    if (!isNaN(parsedDate.getTime())) {
      const dayStart = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
      const dayEnd   = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      where[Op.or].push({ createdAt: { [Op.gte]: dayStart, [Op.lt]: dayEnd } });
    }
  }
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
