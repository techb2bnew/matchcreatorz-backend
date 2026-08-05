'use strict';
const { Op }                 = require('sequelize');
const { Category, Service }  = require('../../models/index');

// Whitelist of columns the grid may sort by, mapped to a Sequelize order path.
// (services_count/sellers_count are computed post-query, not real columns —
// see COMPUTED_SORT_FIELDS below; never let an arbitrary sortBy reach `order`.)
const SORT_FIELDS = {
  name:      ['name'],
  createdAt: ['createdAt'],
};
const COMPUTED_SORT_FIELDS = ['services_count', 'sellers_count'];

// ── List categories ───────────────────────────────────────────────────
const listCategories = async ({ page = 1, limit = 20, search, sortBy, sortDir }) => {
  const offset = (page - 1) * limit;

  const where = {};
  if (search) where.name = { [Op.iLike]: `%${search}%` };

  const direction    = sortDir === 'desc' ? 'DESC' : 'ASC';
  const isComputed   = COMPUTED_SORT_FIELDS.includes(sortBy);
  const sortPath     = SORT_FIELDS[sortBy] || SORT_FIELDS.name;

  // Sorting by a computed count can't be pushed into the DB query, so a
  // page-then-sort would only reorder within whatever page name-order handed
  // us. Instead fetch every matching row, compute+sort in full, then slice
  // the page out afterward — category lists are small enough for this to be
  // cheap, and it's the only way the ordering is globally correct.
  if (isComputed) {
    const allRows = await Category.findAll({ where, order: [['name', 'ASC']] });
    let all = await Promise.all(allRows.map(async (cat) => {
      const j = cat.toJSON();
      j.services_count = await Service.count({ where: { category_id: cat.id } });
      j.sellers_count  = await Service.count({ where: { category_id: cat.id }, distinct: true, col: 'seller_id' });
      return j;
    }));
    all = all.sort((a, b) => {
      const diff = a[sortBy] - b[sortBy];
      return direction === 'ASC' ? diff : -diff;
    });
    const categories = all.slice(offset, offset + Number(limit));
    return { categories, total: all.length, page: Number(page), limit: Number(limit) };
  }

  const { rows, count } = await Category.findAndCountAll({
    where,
    order:  [[...sortPath, direction]],
    limit:  Number(limit),
    offset,
  });

  // Live counts (not the dead services_count/sellers_count columns, which are
  // never updated) so this always agrees with deleteCategory's own live check.
  const categories = await Promise.all(rows.map(async (cat) => {
    const j = cat.toJSON();
    j.services_count = await Service.count({ where: { category_id: cat.id } });
    j.sellers_count  = await Service.count({ where: { category_id: cat.id }, distinct: true, col: 'seller_id' });
    return j;
  }));

  return { categories, total: count, page: Number(page), limit: Number(limit) };
};

// ── Get by ID ─────────────────────────────────────────────────────────
const getCategoryById = async (id) => {
  const cat = await Category.findByPk(id);
  if (!cat) throw { statusCode: 404, message: 'Category not found' };
  return cat;
};

// ── Add category ──────────────────────────────────────────────────────
const addCategory = async ({ name, icon, description }) => {
  const existing = await Category.findOne({ where: { name: { [Op.iLike]: name } } });
  if (existing) throw { statusCode: 409, message: 'Category already exists' };

  const cat = await Category.create({
    name:        name.trim(),
    icon:        icon        || null,
    description: description || null,
  });
  return cat;
};

// ── Edit category ─────────────────────────────────────────────────────
const editCategory = async (id, { name, icon, description }) => {
  const cat = await Category.findByPk(id);
  if (!cat) throw { statusCode: 404, message: 'Category not found' };

  if (name && name.trim() !== cat.name) {
    const dup = await Category.findOne({ where: { name: { [Op.iLike]: name.trim() } } });
    if (dup) throw { statusCode: 409, message: 'Category name already exists' };
  }

  await cat.update({
    ...(name        !== undefined && { name: name.trim() }),
    ...(icon        !== undefined && { icon }),
    ...(description !== undefined && { description }),
  });
  return cat;
};

// ── Delete category ───────────────────────────────────────────────────
const deleteCategory = async (id) => {
  const cat = await Category.findByPk(id);
  if (!cat) throw { statusCode: 404, message: 'Category not found' };

  // Guard: don't delete a category that still has services linked to it
  const linked = await Service.count({ where: { category_id: id } });
  if (linked > 0)
    throw { statusCode: 400, message: `Cannot delete: ${linked} service(s) still use this category` };

  await cat.destroy();
  return { deleted: true };
};

module.exports = { listCategories, getCategoryById, addCategory, editCategory, deleteCategory };
