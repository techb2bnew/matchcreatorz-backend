'use strict';
const { Favourite, Service, User, Category } = require('../../models');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: Buyer - Favourites
 *   description: Buyer saved / favourited services
 */

/**
 * @swagger
 * /api/v1/buyer/favourites:
 *   get:
 *     summary: List my favourite services
 *     tags: [Buyer - Favourites]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of favourited services
 */
exports.listFavourites = async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const { count, rows } = await Favourite.findAndCountAll({
      where:   { user_id: req.user.id },
      include: [{
        model:   Service,
        as:      'service',
        include: [
          { model: User,     as: 'seller',   attributes: ['id', 'name'] },
          { model: Category, as: 'category', attributes: ['id', 'name'], required: false },
        ],
      }],
      order:  [['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return response.paginate(res, 'Favourites fetched', rows, { total: count, page, limit });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/buyer/favourites/ids:
 *   get:
 *     summary: Get the list of service IDs I have favourited (for UI heart-toggle state)
 *     tags: [Buyer - Favourites]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Array of service ids
 */
exports.listFavouriteIds = async (req, res, next) => {
  try {
    const rows = await Favourite.findAll({
      where:      { user_id: req.user.id },
      attributes: ['service_id'],
      raw:        true,
    });
    return response.success(res, 'Favourite ids fetched', rows.map(r => r.service_id));
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/buyer/favourites/{serviceId}:
 *   post:
 *     summary: Add a service to favourites
 *     tags: [Buyer - Favourites]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Added (idempotent)
 *       404:
 *         description: Service not found
 */
exports.addFavourite = async (req, res, next) => {
  try {
    const serviceId = Number(req.params.serviceId);
    const service   = await Service.findByPk(serviceId, { attributes: ['id'] });
    if (!service) return response.notFound(res, 'Service not found');

    await Favourite.findOrCreate({
      where:    { user_id: req.user.id, service_id: serviceId },
      defaults: { user_id: req.user.id, service_id: serviceId },
    });

    return response.success(res, 'Added to favourites');
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/buyer/favourites/{serviceId}:
 *   delete:
 *     summary: Remove a service from favourites
 *     tags: [Buyer - Favourites]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Removed (idempotent)
 */
exports.removeFavourite = async (req, res, next) => {
  try {
    await Favourite.destroy({
      where: { user_id: req.user.id, service_id: Number(req.params.serviceId) },
    });
    return response.success(res, 'Removed from favourites');
  } catch (err) { next(err); }
};
