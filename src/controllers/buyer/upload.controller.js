'use strict';
const { uploadToS3 } = require('../../helpers/s3.helper');
const response       = require('../../helpers/response.helper');

/**
 * @swagger
 * /api/v1/buyer/jobs/upload:
 *   post:
 *     summary: Upload job attachment documents to S3 (max 5 files, 10 MB each)
 *     tags: [Buyer - Jobs]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Uploaded file list [{ url, name }]
 *       400:
 *         description: No files uploaded
 */
const uploadJobDocs = async (req, res, next) => {
  try {
    const files = req.files;
    if (!files || files.length === 0)
      return response.badRequest(res, 'No files uploaded');

    const uploaded = await Promise.all(
      files.map(async (file) => ({
        url:  await uploadToS3(file, 'job-docs'),
        name: file.originalname,
      }))
    );

    return response.success(res, 'Files uploaded', { files: uploaded });
  } catch (err) { next(err); }
};

module.exports = { uploadJobDocs };
