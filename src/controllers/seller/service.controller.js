'use strict';
const svc      = require('../../services/seller/service.service');
const response = require('../../helpers/response.helper');
const { uploadToS3 } = require('../../helpers/s3.helper');

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
 *         description: Searches title, description, tags, and category name
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
 *     summary: Create a new service with optional image uploads (multipart/form-data)
 *     tags: [Seller - Services]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [title, price]
 *             properties:
 *               title:
 *                 type: string
 *                 example: "I will design your logo"
 *               description:
 *                 type: string
 *                 example: "Professional logo design..."
 *               price:
 *                 type: number
 *                 example: 999
 *               delivery_days:
 *                 type: integer
 *                 example: 3
 *               revisions:
 *                 type: integer
 *                 example: 2
 *               category_ids:
 *                 type: string
 *                 description: JSON array of category IDs e.g. "[1,3]"
 *                 example: "[1,3]"
 *               tags:
 *                 type: string
 *                 description: JSON array of tags e.g. '["logo","design"]'
 *                 example: '["logo","design"]'
 *               images:
 *                 type: array
 *                 description: Up to 5 image files (JPG / PNG / WEBP, max 5 MB each)
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: Service created
 */
const createService = async (req, res, next) => {
  try {
    const body = { ...req.body };

    // Parse JSON-stringified arrays sent via FormData
    if (typeof body.category_ids === 'string') {
      try { body.category_ids = JSON.parse(body.category_ids); } catch { body.category_ids = []; }
    }
    if (typeof body.tags === 'string') {
      try { body.tags = JSON.parse(body.tags); } catch { body.tags = []; }
    }

    // Upload images to S3 if files are attached
    if (req.files && req.files.length > 0) {
      body.images = await Promise.all(req.files.map((f) => uploadToS3(f, 'services')));
    }

    const data = await svc.createService(req.user.id, body);
    return response.created(res, 'Service created successfully', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/services/{id}:
 *   put:
 *     summary: Update my service with optional new image uploads (multipart/form-data)
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:         { type: string }
 *               description:   { type: string }
 *               price:         { type: number }
 *               delivery_days: { type: integer }
 *               revisions:     { type: integer }
 *               category_ids:
 *                 type: string
 *                 description: JSON array of category IDs e.g. "[1,3]"
 *               tags:
 *                 type: string
 *                 description: JSON array of tags e.g. '["logo"]'
 *               existing_images:
 *                 type: string
 *                 description: JSON array of existing S3 URLs to keep e.g. '["https://..."]'
 *               images:
 *                 type: array
 *                 description: New image files to add (max 5 total including existing)
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Service updated
 */
const updateService = async (req, res, next) => {
  try {
    const body = { ...req.body };

    // Parse JSON-stringified arrays sent via FormData
    if (typeof body.category_ids === 'string') {
      try { body.category_ids = JSON.parse(body.category_ids); } catch { body.category_ids = []; }
    }
    if (typeof body.tags === 'string') {
      try { body.tags = JSON.parse(body.tags); } catch { body.tags = []; }
    }

    // Existing URLs to keep (sent as JSON string)
    let existingImages = [];
    if (body.existing_images) {
      try { existingImages = JSON.parse(body.existing_images); } catch { existingImages = []; }
      delete body.existing_images;
    }

    // Upload new files to S3 if attached
    let newUrls = [];
    if (req.files && req.files.length > 0) {
      newUrls = await Promise.all(req.files.map((f) => uploadToS3(f, 'services')));
    }

    body.images = [...existingImages, ...newUrls];

    const data = await svc.updateService(req.user.id, req.params.id, body);
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
