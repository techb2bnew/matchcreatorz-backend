'use strict';
const { Banner } = require('../../models');
const { uploadToS3 } = require('../../helpers/s3.helper');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: Admin - Banners
 *   description: Homepage/promotional banner management
 *
 * /api/v1/admin/banners:
 *   get:
 *     summary: List all banners
 *     tags: [Admin - Banners]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: All banners } }
 */
exports.listBanners = async (req, res, next) => {
  try {
    const banners = await Banner.findAll({ order: [['display_order', 'ASC'], ['created_at', 'DESC']] });
    return response.success(res, 'Banners fetched', banners);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/banners:
 *   post:
 *     summary: Create a banner
 *     tags: [Admin - Banners]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [title, image]
 *             properties:
 *               title:    { type: string }
 *               image:    { type: string, format: binary }
 *               link_url: { type: string, nullable: true }
 *               position: { type: string, example: "Home Top" }
 *               is_active: { type: boolean }
 *               display_order: { type: integer }
 *     responses:
 *       201: { description: Banner created }
 *       400: { description: Title and image are required }
 */
exports.createBanner = async (req, res, next) => {
  try {
    const { title, link_url, position, is_active, display_order } = req.body;
    if (!title || !title.trim()) return response.badRequest(res, 'Title is required');
    if (!req.file) return response.badRequest(res, 'Banner image is required');

    const image_url = await uploadToS3(req.file, 'banners');

    const banner = await Banner.create({
      title: title.trim(),
      image_url,
      link_url: link_url || null,
      position: position || 'Home Top',
      is_active: is_active === undefined ? true : is_active === 'true' || is_active === true,
      display_order: display_order ? Number(display_order) : 0,
    });

    return response.created(res, 'Banner created', banner);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/banners/{id}:
 *   put:
 *     summary: Update a banner (optionally replace the image)
 *     tags: [Admin - Banners]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: integer } }]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:    { type: string }
 *               image:    { type: string, format: binary }
 *               link_url: { type: string, nullable: true }
 *               position: { type: string }
 *               is_active: { type: boolean }
 *               display_order: { type: integer }
 *     responses:
 *       200: { description: Banner updated }
 *       404: { description: Banner not found }
 */
exports.updateBanner = async (req, res, next) => {
  try {
    const banner = await Banner.findByPk(req.params.id);
    if (!banner) return response.notFound(res, 'Banner not found');

    const { title, link_url, position, is_active, display_order } = req.body;
    const patch = {};
    if (title !== undefined)      patch.title = title.trim();
    if (link_url !== undefined)   patch.link_url = link_url || null;
    if (position !== undefined)   patch.position = position;
    if (is_active !== undefined)  patch.is_active = is_active === 'true' || is_active === true;
    if (display_order !== undefined) patch.display_order = Number(display_order) || 0;
    if (req.file) patch.image_url = await uploadToS3(req.file, 'banners');

    await banner.update(patch);
    return response.success(res, 'Banner updated', banner);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/banners/{id}:
 *   delete:
 *     summary: Delete a banner
 *     tags: [Admin - Banners]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: integer } }]
 *     responses:
 *       200: { description: Banner deleted }
 *       404: { description: Banner not found }
 */
exports.deleteBanner = async (req, res, next) => {
  try {
    const banner = await Banner.findByPk(req.params.id);
    if (!banner) return response.notFound(res, 'Banner not found');
    await banner.destroy();
    return response.success(res, 'Banner deleted');
  } catch (err) { next(err); }
};
