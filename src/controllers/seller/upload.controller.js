'use strict';
const { uploadToS3 } = require('../../helpers/s3.helper');
const response       = require('../../helpers/response.helper');

/**
 * @swagger
 * /api/v1/seller/upload:
 *   post:
 *     summary: Upload service images to S3 (max 5 images, 5 MB each)
 *     tags: [Seller - Services]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Uploaded image URLs
 */
const uploadServiceImages = async (req, res, next) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return response.error(res, 'No files uploaded', 400);
    }

    const urls = await Promise.all(
      files.map((file) => uploadToS3(file, 'services'))
    );

    return response.success(res, 'Images uploaded successfully', { urls });
  } catch (err) {
    next(err);
  }
};

module.exports = { uploadServiceImages };
