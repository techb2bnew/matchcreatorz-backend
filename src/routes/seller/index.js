'use strict';
const router = require('express').Router();
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const multer = require('multer');

const { listMyServices, getMyService, createService, updateService, deleteService, publishService, pauseService } = require('../../controllers/seller/service.controller');
const { getProfile, updateProfile, changePassword } = require('../../controllers/shared/profile.controller');

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    allowed.has(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP allowed'));
  },
});

router.use(authenticate, authorize('SELLER'));

// ── Profile ────────────────────────────────────────────────────────────
router.get ('/profile',         getProfile);
router.put ('/profile',         updateProfile);
router.put ('/change-password', changePassword);

// ── Services ───────────────────────────────────────────────────────────
router.get   ('/services',              listMyServices);
router.post  ('/services',              imageUpload.array('images', 5), createService);
router.get   ('/services/:id',          getMyService);
router.put   ('/services/:id',          imageUpload.array('images', 5), updateService);
router.delete('/services/:id',          deleteService);
router.patch ('/services/:id/publish',  publishService);
router.patch ('/services/:id/pause',    pauseService);

module.exports = router;
