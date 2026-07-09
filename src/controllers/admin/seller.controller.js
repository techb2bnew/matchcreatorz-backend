'use strict';
const sellerService = require('../../services/admin/seller.service');
const response      = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: Admin - Sellers
 *   description: Admin APIs for managing sellers
 */

/**
 * @swagger
 * /api/v1/admin/sellers:
 *   get:
 *     summary: List all sellers (paginated)
 *     tags: [Admin - Sellers]
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
 *         name: approval_status
 *         schema: { type: string, enum: [pending, approved, rejected] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive, banned] }
 *     responses:
 *       200:
 *         description: Sellers list
 */
const listSellers = async (req, res, next) => {
  try {
    const { page, limit, search, approval_status, status } = req.query;
    const result = await sellerService.listSellers({ page, limit, search, approval_status, status });
    return response.paginate(res, 'Sellers fetched', result.sellers, {
      page: result.page, limit: result.limit, total: result.total,
    });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/sellers/{id}:
 *   get:
 *     summary: Get seller by ID
 *     tags: [Admin - Sellers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Seller detail
 *       404:
 *         description: Seller not found
 */
const getSellerById = async (req, res, next) => {
  try {
    const data = await sellerService.getSellerById(req.params.id);
    return response.success(res, 'Seller fetched', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/sellers:
 *   post:
 *     summary: Add new seller
 *     tags: [Admin - Sellers]
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
 *               name:        { type: string, example: "John Doe" }
 *               email:       { type: string, example: "john@example.com" }
 *               password:    { type: string, example: "Password@123" }
 *               phone:       { type: string, example: "+919876543210" }
 *               bio:         { type: string }
 *               skills:      { type: array, items: { type: string }, example: ["React", "Node.js"] }
 *               hourly_rate: { type: number, example: 800 }
 *               city:        { type: string, example: "Mumbai" }
 *               country:     { type: string, example: "India" }
 *     responses:
 *       201:
 *         description: Seller created
 *       409:
 *         description: Email already exists
 */
const addSeller = async (req, res, next) => {
  try {
    const data = await sellerService.addSeller(req.body);
    return response.created(res, 'Seller created successfully', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/sellers/{id}:
 *   put:
 *     summary: Edit seller
 *     tags: [Admin - Sellers]
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
 *               bio:          { type: string }
 *               skills:       { type: array, items: { type: string } }
 *               hourly_rate:  { type: number }
 *               city:         { type: string }
 *               country:      { type: string }
 *               is_available: { type: boolean }
 *               status:       { type: string, enum: [active, inactive, banned] }
 *     responses:
 *       200:
 *         description: Seller updated
 *       404:
 *         description: Seller not found
 */
const editSeller = async (req, res, next) => {
  try {
    const data = await sellerService.editSeller(req.params.id, req.body);
    return response.success(res, 'Seller updated successfully', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/sellers/{id}/approve:
 *   patch:
 *     summary: Approve seller
 *     tags: [Admin - Sellers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Seller approved
 *       404:
 *         description: Seller not found
 */
const approveSeller = async (req, res, next) => {
  try {
    const data = await sellerService.approveSeller(req.params.id);
    return response.success(res, 'Seller approved', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/sellers/{id}/reject:
 *   patch:
 *     summary: Reject seller
 *     tags: [Admin - Sellers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Seller rejected
 */
const rejectSeller = async (req, res, next) => {
  try {
    const data = await sellerService.rejectSeller(req.params.id);
    return response.success(res, 'Seller rejected', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/sellers/{id}/block:
 *   patch:
 *     summary: Block seller
 *     tags: [Admin - Sellers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Seller blocked
 */
const blockSeller = async (req, res, next) => {
  try {
    const data = await sellerService.blockSeller(req.params.id);
    return response.success(res, 'Seller blocked', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/sellers/{id}/unblock:
 *   patch:
 *     summary: Unblock seller
 *     tags: [Admin - Sellers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Seller unblocked
 */
const unblockSeller = async (req, res, next) => {
  try {
    const data = await sellerService.unblockSeller(req.params.id);
    return response.success(res, 'Seller unblocked', data);
  } catch (err) { next(err); }
};

module.exports = { listSellers, getSellerById, addSeller, editSeller, approveSeller, rejectSeller, blockSeller, unblockSeller };
