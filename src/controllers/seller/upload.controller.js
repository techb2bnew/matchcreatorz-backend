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

/**
 * @swagger
 * /api/v1/seller/upload/resume:
 *   post:
 *     summary: Upload resume to S3 (PDF / DOC / DOCX, max 10 MB)
 *     tags: [Seller - Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [resume]
 *             properties:
 *               resume:
 *                 type: string
 *                 format: binary
 *                 description: PDF, DOC, or DOCX file (max 10 MB)
 *     responses:
 *       200:
 *         description: Resume uploaded, returns public S3 URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                   example: "https://matchcreatorz.s3.amazonaws.com/resumes/abc123.pdf"
 *       400:
 *         description: No file uploaded or invalid file type
 */
const uploadResume = async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return response.error(res, 'No file uploaded', 400);

    const url = await uploadToS3(file, 'resumes');
    return response.success(res, 'Resume uploaded successfully', { url });
  } catch (err) {
    next(err);
  }
};

/**
 * @swagger
 * /api/v1/seller/bids/upload:
 *   post:
 *     summary: Upload a portfolio / work-sample file to attach to a bid (max 10 MB)
 *     tags: [Seller - Jobs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Image, PDF, DOC/DOCX, XLS/XLSX, TXT or ZIP (max 10 MB)
 *     responses:
 *       200:
 *         description: Uploaded — returns { url, name, type, size } to store on the bid
 *       400:
 *         description: No file uploaded or unsupported file type
 */
const uploadBidAttachment = async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return response.badRequest(res, 'No file uploaded');
    const url = await uploadToS3(file, 'bids');
    return response.success(res, 'File uploaded', {
      url, name: file.originalname, type: file.mimetype, size: file.size,
    });
  } catch (err) { next(err); }
};

module.exports = { uploadServiceImages, uploadResume, uploadBidAttachment };
