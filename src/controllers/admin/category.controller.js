'use strict';
const categoryService = require('../../services/admin/category.service');
const response        = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: Admin - Categories
 *   description: Admin APIs for managing categories
 */

/**
 * @swagger
 * /api/v1/admin/categories:
 *   get:
 *     summary: List all categories (paginated + search)
 *     tags: [Admin - Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by category name
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [name, createdAt, services_count, sellers_count] }
 *       - in: query
 *         name: sortDir
 *         schema: { type: string, enum: [asc, desc] }
 *     responses:
 *       200:
 *         description: Categories list
 */
const listCategories = async (req, res, next) => {
  try {
    const { page, limit, search, sortBy, sortDir } = req.query;
    const result = await categoryService.listCategories({ page, limit, search, sortBy, sortDir });
    return response.paginate(res, 'Categories fetched', result.categories, {
      page: result.page, limit: result.limit, total: result.total,
    });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/categories/{id}:
 *   get:
 *     summary: Get category by ID
 *     tags: [Admin - Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Category detail
 *       404:
 *         description: Category not found
 */
const getCategoryById = async (req, res, next) => {
  try {
    const data = await categoryService.getCategoryById(req.params.id);
    return response.success(res, 'Category fetched', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/categories:
 *   post:
 *     summary: Add new category
 *     tags: [Admin - Categories]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:        { type: string, example: "Photography" }
 *               icon:        { type: string, example: "📷" }
 *               description: { type: string, example: "All photography services" }
 *     responses:
 *       201:
 *         description: Category created
 *       409:
 *         description: Category already exists
 */
const addCategory = async (req, res, next) => {
  try {
    const data = await categoryService.addCategory(req.body);
    return response.created(res, 'Category created successfully', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/categories/{id}:
 *   put:
 *     summary: Edit category
 *     tags: [Admin - Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:        { type: string }
 *               icon:        { type: string }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: Category updated
 *       404:
 *         description: Category not found
 *       409:
 *         description: Name already exists
 */
const editCategory = async (req, res, next) => {
  try {
    const data = await categoryService.editCategory(req.params.id, req.body);
    return response.success(res, 'Category updated successfully', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/categories/{id}:
 *   delete:
 *     summary: Delete category
 *     tags: [Admin - Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Category deleted
 *       404:
 *         description: Category not found
 */
const deleteCategory = async (req, res, next) => {
  try {
    const data = await categoryService.deleteCategory(req.params.id);
    return response.success(res, 'Category deleted successfully', data);
  } catch (err) { next(err); }
};

module.exports = { listCategories, getCategoryById, addCategory, editCategory, deleteCategory };
