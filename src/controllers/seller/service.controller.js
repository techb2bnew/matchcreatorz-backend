'use strict';
const svc      = require('../../services/seller/service.service');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: Seller - Services
 *   description: Seller APIs for managing their own services
 */

/**
 * @swagger
 * /api/v1/seller/services:
 *   get:
 *     summary: List my services (paginated + search + status filter)
 *     tags: [Seller - Services]
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
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, paused, rejected] }
 *     responses:
 *       200:
 *         description: Services list
 */
const listMyServices = async (req, res, next) => {
  try {
    const result = await svc.listMyServices(req.user.id, req.query);
    return response.paginate(res, 'Services fetched', result.services, {
      page: result.page, limit: result.limit, total: result.total,
    });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/services/{id}:
 *   get:
 *     summary: Get my service by ID
 *     tags: [Seller - Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Service detail
 *       404:
 *         description: Service not found
 */
const getMyService = async (req, res, next) => {
  try {
    const data = await svc.getMyService(req.user.id, req.params.id);
    return response.success(res, 'Service fetched', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/services:
 *   post:
 *     summary: Create a new service (starts as active)
 *     tags: [Seller - Services]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, price]
 *             properties:
 *               title:         { type: string,  example: "I will design your logo" }
 *               description:   { type: string,  example: "Professional logo design..." }
 *               price:         { type: number,  example: 999 }
 *               delivery_days: { type: integer, example: 3 }
 *               revisions:     { type: integer, example: 2 }
 *               category_ids:
 *                 type: array
 *                 description: Multiple category IDs (multi-select). First element becomes primary category_id.
 *                 items: { type: integer }
 *                 example: [1, 3]
 *               tags:          { type: array, items: { type: string }, example: ["logo", "design"] }
 *               images:        { type: array, items: { type: string }, example: ["https://s3.../img.jpg"] }
 *     responses:
 *       201:
 *         description: Service created
 */
const createService = async (req, res, next) => {
  try {
    const data = await svc.createService(req.user.id, req.body);
    return response.created(res, 'Service created successfully', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/services/{id}:
 *   put:
 *     summary: Update my service
 *     tags: [Seller - Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:         { type: string }
 *               description:   { type: string }
 *               price:         { type: number }
 *               delivery_days: { type: integer }
 *               revisions:     { type: integer }
 *               category_ids:
 *                 type: array
 *                 description: Multiple category IDs (multi-select). First element becomes primary category_id.
 *                 items: { type: integer }
 *                 example: [1, 3]
 *               tags:          { type: array, items: { type: string } }
 *               images:        { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Service updated
 */
const updateService = async (req, res, next) => {
  try {
    const data = await svc.updateService(req.user.id, req.params.id, req.body);
    return response.success(res, 'Service updated successfully', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/services/{id}:
 *   delete:
 *     summary: Delete my service
 *     tags: [Seller - Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Service deleted
 */
const deleteService = async (req, res, next) => {
  try {
    const data = await svc.deleteService(req.user.id, req.params.id);
    return response.success(res, 'Service deleted successfully', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/services/{id}/publish:
 *   patch:
 *     summary: Publish (paused → active)
 *     tags: [Seller - Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Service published
 */
const publishService = async (req, res, next) => {
  try {
    const data = await svc.publishService(req.user.id, req.params.id);
    return response.success(res, 'Service published successfully', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/services/{id}/pause:
 *   patch:
 *     summary: Pause service (active → paused)
 *     tags: [Seller - Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Service paused
 */
const pauseService = async (req, res, next) => {
  try {
    const data = await svc.pauseService(req.user.id, req.params.id);
    return response.success(res, 'Service paused successfully', data);
  } catch (err) { next(err); }
};

module.exports = { listMyServices, getMyService, createService, updateService, deleteService, publishService, pauseService };
