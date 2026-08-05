'use strict';
const buyerService = require('../../services/admin/buyer.service');
const response     = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: Admin - Buyers
 *   description: Admin APIs for managing buyers
 */

/**
 * @swagger
 * /api/v1/admin/buyers:
 *   get:
 *     summary: List all buyers (paginated)
 *     tags: [Admin - Buyers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: "Search by name or email"
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive, banned] }
 *       - in: query
 *         name: approval_status
 *         schema: { type: string, enum: [pending, approved, rejected] }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [name, email, user_status, joined, approval_status, bookings_count, total_spent] }
 *       - in: query
 *         name: sortDir
 *         schema: { type: string, enum: [asc, desc] }
 *     responses:
 *       200:
 *         description: Buyers list
 */
const listBuyers = async (req, res, next) => {
  try {
    const { page, limit, search, status, approval_status, sortBy, sortDir } = req.query;
    const result = await buyerService.listBuyers({ page, limit, search, status, approval_status, sortBy, sortDir });
    return response.paginate(res, 'Buyers fetched', result.buyers, {
      page: result.page, limit: result.limit, total: result.total,
    });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/buyers/{id}:
 *   get:
 *     summary: Get buyer by ID
 *     tags: [Admin - Buyers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Buyer detail
 *       404:
 *         description: Buyer not found
 */
const getBuyerById = async (req, res, next) => {
  try {
    const data = await buyerService.getBuyerById(req.params.id);
    return response.success(res, 'Buyer fetched', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/buyers:
 *   post:
 *     summary: Add new buyer
 *     tags: [Admin - Buyers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name:         { type: string, example: "Jane Doe" }
 *               email:        { type: string, example: "jane@example.com" }
 *               password:     { type: string, example: "Password@123" }
 *               phone:        { type: string, example: "+919876543210" }
 *               company_name: { type: string, example: "ABC Pvt Ltd" }
 *               city:         { type: string, example: "Delhi" }
 *               country:      { type: string, example: "India" }
 *     responses:
 *       201:
 *         description: Buyer created
 *       409:
 *         description: Email already exists
 */
const addBuyer = async (req, res, next) => {
  try {
    const data = await buyerService.addBuyer(req.body);
    return response.created(res, 'Buyer created successfully', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/buyers/{id}:
 *   put:
 *     summary: Edit buyer
 *     tags: [Admin - Buyers]
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
 *               name:         { type: string }
 *               phone:        { type: string }
 *               company_name: { type: string }
 *               city:         { type: string }
 *               country:      { type: string }
 *               status:       { type: string, enum: [active, inactive, banned] }
 *     responses:
 *       200:
 *         description: Buyer updated
 *       404:
 *         description: Buyer not found
 */
const editBuyer = async (req, res, next) => {
  try {
    const data = await buyerService.editBuyer(req.params.id, req.body);
    return response.success(res, 'Buyer updated successfully', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/buyers/{id}/approve:
 *   patch:
 *     summary: Approve a pending buyer
 *     tags: [Admin - Buyers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Buyer approved }
 *       404: { description: Buyer not found }
 */
const approveBuyer = async (req, res, next) => {
  try {
    const data = await buyerService.approveBuyer(req.params.id);
    return response.success(res, 'Buyer approved', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/buyers/{id}/reject:
 *   patch:
 *     summary: Reject a pending buyer
 *     tags: [Admin - Buyers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Buyer rejected }
 *       404: { description: Buyer not found }
 */
const rejectBuyer = async (req, res, next) => {
  try {
    const data = await buyerService.rejectBuyer(req.params.id);
    return response.success(res, 'Buyer rejected', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/buyers/{id}/block:
 *   patch:
 *     summary: Block buyer
 *     tags: [Admin - Buyers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Buyer blocked
 *       404:
 *         description: Buyer not found
 */
const blockBuyer = async (req, res, next) => {
  try {
    const data = await buyerService.blockBuyer(req.params.id);
    return response.success(res, 'Buyer blocked', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/buyers/{id}/unblock:
 *   patch:
 *     summary: Unblock buyer
 *     tags: [Admin - Buyers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Buyer unblocked
 *       404:
 *         description: Buyer not found
 */
const unblockBuyer = async (req, res, next) => {
  try {
    const data = await buyerService.unblockBuyer(req.params.id);
    return response.success(res, 'Buyer unblocked', data);
  } catch (err) { next(err); }
};

module.exports = { listBuyers, getBuyerById, addBuyer, editBuyer, approveBuyer, rejectBuyer, blockBuyer, unblockBuyer };
