'use strict';
const { Op, literal }     = require('sequelize');
const { Service, Category, User, SellerProfile } = require('../../models/index');

// ── List seller's own services ────────────────────────────────────────
const listMyServices = async (sellerId, { page = 1, limit = 10, search, status }) => {
  const offset = (page - 1) * limit;
  const where  = { seller_id: sellerId };

  if (search) {
    const safe = search.replace(/'/g, "''");
    where[Op.or] = [
      { title:              { [Op.iLike]: `%${search}%` } },
      { description:        { [Op.iLike]: `%${search}%` } },
      { '$category.name$':  { [Op.iLike]: `%${search}%` } },
      literal(`EXISTS (SELECT 1 FROM jsonb_array_elements_text("Service"."tags") t WHERE t ILIKE '%${safe}%')`),
    ];
  }
  if (status) where.status = status;

  const { rows, count } = await Service.findAndCountAll({
    where,
    include:  [{ model: Category, as: 'category', attributes: ['id', 'name', 'icon'] }],
    order:    [['created_at', 'DESC']],
    limit:    Number(limit),
    offset,
    distinct: true,
    subQuery: false,
  });

  return { services: rows, total: count, page: Number(page), limit: Number(limit) };
};

// ── Get one service (must belong to this seller) ──────────────────────
const getMyService = async (sellerId, id) => {
  const svc = await Service.findOne({
    where:   { id, seller_id: sellerId },
    include: [{ model: Category, as: 'category', attributes: ['id', 'name', 'icon'] }],
  });
  if (!svc) throw { statusCode: 404, message: 'Service not found' };
  return svc;
};

// ── Category / tag input clean-up ──────────────────────────────────────
// Custom ("Other") category: trimmed, max 100 chars, empty → null.
const cleanCustomCategory = (v) => {
  const s = typeof v === 'string' ? v.trim().slice(0, 100) : '';
  return s || null;
};

// Tags: picked suggestions and/or the seller's own — trimmed, max 50 chars
// each, duplicates (case-insensitive) dropped, at most 20.
const cleanTags = (tags) => {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out  = [];
  for (const t of tags) {
    const tag = typeof t === 'string' ? t.trim().slice(0, 50) : '';
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out.slice(0, 20);
};

// ── Create service — starts as active ────────────────────────────────
const createService = async (sellerId, data) => {
  const { title, description, price, delivery_days, revisions, category_ids, custom_category, tags, images } = data;

  if (!title?.trim())       throw { statusCode: 400, message: 'Title is required' };
  if (!price || price <= 0) throw { statusCode: 400, message: 'Price must be greater than 0' };

  const catIds = Array.isArray(category_ids) ? category_ids.map(Number).filter(Boolean) : [];

  // Validate category IDs
  if (catIds.length > 0) {
    const found = await Category.count({ where: { id: catIds } });
    if (found !== catIds.length)
      throw { statusCode: 400, message: 'One or more category IDs are invalid' };
  }

  const svc = await Service.create({
    seller_id:     sellerId,
    category_id:   catIds[0] || null,
    category_ids:  catIds,
    custom_category: cleanCustomCategory(custom_category),
    title:         title.trim(),
    description:   description || null,
    price:         Number(price),
    delivery_days: Number(delivery_days) || 1,
    revisions:     Number(revisions)     || 1,
    tags:          cleanTags(tags),
    images:        Array.isArray(images) ? images : [],
    status:        'active',
  });

  return svc;
};

// ── Update service ────────────────────────────────────────────────────
const updateService = async (sellerId, id, data) => {
  const svc = await Service.findOne({ where: { id, seller_id: sellerId } });
  if (!svc) throw { statusCode: 404, message: 'Service not found' };

  const { title, description, price, delivery_days, revisions, category_ids, custom_category, tags, images } = data;

  if (price !== undefined && Number(price) <= 0)
    throw { statusCode: 400, message: 'Price must be greater than 0' };

  const catIds = category_ids !== undefined
    ? (Array.isArray(category_ids) ? category_ids.map(Number).filter(Boolean) : [])
    : undefined;

  // Validate that all supplied category IDs exist
  if (catIds && catIds.length > 0) {
    const found = await Category.count({ where: { id: catIds } });
    if (found !== catIds.length)
      throw { statusCode: 400, message: 'One or more category IDs are invalid' };
  }

  await svc.update({
    ...(title         !== undefined && { title: title.trim() }),
    ...(description   !== undefined && { description }),
    ...(price         !== undefined && { price: Number(price) }),
    ...(delivery_days !== undefined && { delivery_days: Number(delivery_days) }),
    ...(revisions     !== undefined && { revisions: Number(revisions) }),
    ...(catIds        !== undefined && { category_id: catIds[0] || null, category_ids: catIds }),
    ...(custom_category !== undefined && { custom_category: cleanCustomCategory(custom_category) }),
    ...(tags          !== undefined && { tags: cleanTags(tags) }),
    ...(images        !== undefined && { images: Array.isArray(images) ? images : [] }),
  });

  return svc;
};

// ── Delete service ────────────────────────────────────────────────────
const deleteService = async (sellerId, id) => {
  const svc = await Service.findOne({ where: { id, seller_id: sellerId } });
  if (!svc) throw { statusCode: 404, message: 'Service not found' };
  if (svc.orders_count > 0) throw { statusCode: 400, message: 'Cannot delete a service with existing orders' };
  await svc.destroy();
  return { deleted: true };
};

// ── Publish (paused -> active) ────────────────────────────────────────
const publishService = async (sellerId, id) => {
  const svc = await Service.findOne({ where: { id, seller_id: sellerId } });
  if (!svc) throw { statusCode: 404, message: 'Service not found' };
  if (svc.status === 'rejected') throw { statusCode: 403, message: 'Rejected service cannot be published' };
  await svc.update({ status: 'active' });
  return svc;
};

// ── Pause (active -> paused) ──────────────────────────────────────────
const pauseService = async (sellerId, id) => {
  const svc = await Service.findOne({ where: { id, seller_id: sellerId } });
  if (!svc) throw { statusCode: 404, message: 'Service not found' };
  if (svc.status !== 'active') throw { statusCode: 400, message: 'Only active services can be paused' };
  await svc.update({ status: 'paused' });
  return svc;
};

module.exports = { listMyServices, getMyService, createService, updateService, deleteService, publishService, pauseService };
