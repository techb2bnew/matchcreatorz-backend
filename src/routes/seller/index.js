'use strict';
const router = require('express').Router();
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const multer                      = require('multer');

const {
  listMyServices, getMyService, createService, updateService,
  deleteService, publishService, pauseService,
} = require('../../controllers/seller/service.controller');

const { uploadServiceImages } = require('../../controllers/seller/upload.controller');

// multer — images only, max 5 files, 5 MB each
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    allowed.has(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP allowed'));
  },
});

// All seller routes require authentication + SELLER role
router.use(authenticate, authorize('SELLER'));

// ── Image upload ───────────────────────────────────────────────────────
router.post  ('/upload',                imageUpload.array('images', 5), uploadServiceImages);

// ── Services ──────────────────────────────────────────────────────────
router.get   ('/services',              listMyServices);
router.post  ('/services',              createService);
router.get   ('/services/:id',          getMyService);
router.put   ('/services/:id',          updateService);
router.delete('/services/:id',          deleteService);
router.patch ('/services/:id/publish',  publishService);
router.patch ('/services/:id/pause',    pauseService);

module.exports = router;
