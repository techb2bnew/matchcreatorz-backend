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

// Attach live services_count/sellers_count to a category row (and, if it has
// subcategories loaded, to each of those too) — not the dead
// services_count/sellers_count columns, which are never updated.
const withLiveCounts = async (cat) => {
  const j = cat.toJSON ? cat.toJSON() : cat;
  j.services_count = await Service.count({ where: { category_id: j.id } });
  j.sellers_count  = await Service.count({ where: { category_id: j.id }, distinct: true, col: 'seller_id' });
  if (Array.isArray(j.subcategories)) {
    j.subcategories = await Promise.all(j.subcategories.map(withLiveCounts));
  }
  return j;
};

// ── List categories ───────────────────────────────────────────────────
// Only top-level categories (parent_id IS NULL) are paginated/searched here —
// each one comes back with its `subcategories` nested underneath.
const listCategories = async ({ page = 1, limit = 20, search, sortBy, sortDir }) => {
  const offset = (page - 1) * limit;

  const where = { parent_id: null };
  if (search) where.name = { [Op.iLike]: `%${search}%` };

  const direction    = sortDir === 'desc' ? 'DESC' : 'ASC';
  const isComputed   = COMPUTED_SORT_FIELDS.includes(sortBy);
  const sortPath     = SORT_FIELDS[sortBy] || SORT_FIELDS.name;
  const include      = [{ model: Category, as: 'subcategories', separate: true, order: [['name', 'ASC']] }];

  // Sorting by a computed count can't be pushed into the DB query, so a
  // page-then-sort would only reorder within whatever page name-order handed
  // us. Instead fetch every matching row, compute+sort in full, then slice
  // the page out afterward — category lists are small enough for this to be
  // cheap, and it's the only way the ordering is globally correct.
  if (isComputed) {
    const allRows = await Category.findAll({ where, include, order: [['name', 'ASC']] });
    let all = await Promise.all(allRows.map(withLiveCounts));
    all = all.sort((a, b) => {
      const diff = a[sortBy] - b[sortBy];
      return direction === 'ASC' ? diff : -diff;
    });
    const categories = all.slice(offset, offset + Number(limit));
    return { categories, total: all.length, page: Number(page), limit: Number(limit) };
  }

  const { rows, count } = await Category.findAndCountAll({
    where,
    include,
    order:    [[...sortPath, direction]],
    limit:    Number(limit),
    offset,
    distinct: true,
  });

  const categories = await Promise.all(rows.map(withLiveCounts));

  return { categories, total: count, page: Number(page), limit: Number(limit) };
};

// ── Get by ID ─────────────────────────────────────────────────────────
const getCategoryById = async (id) => {
  const cat = await Category.findByPk(id, {
    include: [
      { model: Category, as: 'subcategories', separate: true, order: [['name', 'ASC']] },
      { model: Category, as: 'parent', attributes: ['id', 'name'] },
    ],
  });
  if (!cat) throw { statusCode: 404, message: 'Category not found' };
  return cat;
};

// ── Add category ──────────────────────────────────────────────────────
// parent_id (optional) makes this a subcategory instead of a top-level one.
const addCategory = async ({ name, icon, description, parent_id }) => {
  const existing = await Category.findOne({ where: { name: { [Op.iLike]: name } } });
  if (existing) throw { statusCode: 409, message: 'Category already exists' };

  let parentId = null;
  if (parent_id != null && parent_id !== '') {
    const parent = await Category.findByPk(parent_id);
    if (!parent) throw { statusCode: 404, message: 'Parent category not found' };
    if (parent.parent_id != null)
      throw { statusCode: 400, message: 'Only one level of subcategories is supported' };
    parentId = parent.id;
  }

  const cat = await Category.create({
    name:        name.trim(),
    icon:        icon        || null,
    description: description || null,
    parent_id:   parentId,
  });
  return cat;
};

// ── Edit category ─────────────────────────────────────────────────────
const editCategory = async (id, { name, icon, description, parent_id }) => {
  const cat = await Category.findByPk(id);
  if (!cat) throw { statusCode: 404, message: 'Category not found' };

  if (name && name.trim() !== cat.name) {
    const dup = await Category.findOne({ where: { name: { [Op.iLike]: name.trim() } } });
    if (dup) throw { statusCode: 409, message: 'Category name already exists' };
  }

  let parentId = cat.parent_id;
  if (parent_id !== undefined) {
    if (parent_id == null || parent_id === '') {
      parentId = null;
    } else {
      if (Number(parent_id) === cat.id)
        throw { statusCode: 400, message: 'A category cannot be its own parent' };
      const parent = await Category.findByPk(parent_id);
      if (!parent) throw { statusCode: 404, message: 'Parent category not found' };
      if (parent.parent_id != null)
        throw { statusCode: 400, message: 'Only one level of subcategories is supported' };
      const hasChildren = await Category.count({ where: { parent_id: cat.id } });
      if (hasChildren > 0)
        throw { statusCode: 400, message: 'Cannot make this a subcategory — it already has its own subcategories' };
      parentId = parent.id;
    }
  }

  await cat.update({
    ...(name        !== undefined && { name: name.trim() }),
    ...(icon        !== undefined && { icon }),
    ...(description !== undefined && { description }),
    parent_id: parentId,
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

  // Guard: don't delete a category that still has subcategories under it
  const children = await Category.count({ where: { parent_id: id } });
  if (children > 0)
    throw { statusCode: 400, message: `Cannot delete: ${children} subcategor${children === 1 ? 'y' : 'ies'} still under this category` };

  await cat.destroy();
  return { deleted: true };
};

module.exports = { listCategories, getCategoryById, addCategory, editCategory, deleteCategory };
