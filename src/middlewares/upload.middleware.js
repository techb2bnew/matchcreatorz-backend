'use strict';
const multer = require('multer');

// Keep files in memory — we stream them directly to S3
const storage = multer.memoryStorage();

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Allowed: PDF, DOC, DOCX, JPG, PNG, WEBP'), false);
  }
};

const ALLOWED_PORTFOLIO_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
  'application/pdf',
]);

const portfolioFileFilter = (req, file, cb) => {
  const allowed = file.fieldname === 'portfolio_files'
    ? ALLOWED_PORTFOLIO_TYPES
    : ALLOWED_MIME_TYPES;
  if (allowed.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type for ${file.fieldname}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter: portfolioFileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
});

module.exports = upload;
