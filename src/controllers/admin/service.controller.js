'use strict';
const svc      = require('../../services/admin/service.service');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: Admin - Services
 *   description: Admin APIs for managing all services
 */

/**
 * @swagger
 * /api/v1/admin/services:
 *   get:
 *     summary: List all services (paginated + search + filters)
 *     tags: [Admin - Services]
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
 *         description: Search by title
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, paused, rejected] }
 *       - in: query
 *         name: category_id
 *         schema: { type: integer }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [title, seller, category, price, orders, status, date] }
 *       - in: query
 *         name: sortDir
 *         schema: { type: string, enum: [asc, desc] }
 *     responses:
 *       200:
 *         description: Services list
 */
const listServices = async (req, res, next) => {
  try {
    const result = await svc.listServices(req.query);
    return response.paginate(res, 'Services fetched', result.services, {
      page: result.page, limit: result.limit, total: result.total,
    });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/services/{id}:
 *   get:
 *     summary: Get service by ID
 *     tags: [Admin - Services]
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
 *         description: Not found
 */
const getServiceById = async (req, res, next) => {
  try {
    const data = await svc.getServiceById(req.params.id);
    return response.success(res, 'Service fetched', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/services/{id}/reject:
 *   patch:
 *     summary: Reject a service
 *     tags: [Admin - Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Service rejected
 */
const rejectService = async (req, res, next) => {
  try {
    const data = await svc.rejectService(req.params.id);
    return response.success(res, 'Service rejected', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/services/{id}/restore:
 *   patch:
 *     summary: Restore a rejected service back to active
 *     tags: [Admin - Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Service restored to active
 */
const restoreService = async (req, res, next) => {
  try {
    const data = await svc.restoreService(req.params.id);
    return response.success(res, 'Service restored to active', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/services/{id}/feature:
 *   patch:
 *     summary: Toggle featured flag
 *     tags: [Admin - Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Featured toggled
 */
const toggleFeatured = async (req, res, next) => {
  try {
    const data = await svc.toggleFeatured(req.params.id);
    const msg  = data.is_featured ? 'Service marked as featured' : 'Service removed from featured';
    return response.success(res, msg, data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/services/{id}:
 *   delete:
 *     summary: Delete a service
 *     tags: [Admin - Services]
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
    const data = await svc.deleteService(req.params.id);
    return response.success(res, 'Service deleted successfully', data);
  } catch (err) { next(err); }
};

module.exports = { listServices, getServiceById, rejectService, restoreService, toggleFeatured, deleteService };
