'use strict';
const { Op }                 = require('sequelize');
const { Category, Service }  = require('../../models/index');

// ── List categories ───────────────────────────────────────────────────
const listCategories = async ({ page = 1, limit = 20, search }) => {
  const offset = (page - 1) * limit;

  const where = {};
  if (search) where.name = { [Op.iLike]: `%${search}%` };

  const { rows, count } = await Category.findAndCountAll({
    where,
    order:  [['name', 'ASC']],
    limit:  Number(limit),
    offset,
  });

  return { categories: rows, total: count, page: Number(page), limit: Number(limit) };
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
