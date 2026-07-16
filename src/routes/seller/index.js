'use strict';
const router = require('express').Router();
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const multer = require('multer');

const { listMyServices, getMyService, createService, updateService, deleteService, publishService, pauseService } = require('../../controllers/seller/service.controller');
const { uploadResume } = require('../../controllers/seller/upload.controller');
const { getSellerProfile, updateSellerProfile } = require('../../controllers/seller/profile.controller');
const { changePassword } = require('../../controllers/shared/profile.controller');
const { browseJobs, getJobDetail, placeBid, updateBid, withdrawBid, myBids } = require('../../controllers/seller/job.controller');
const { listBookings: listSellerBookings, getBooking: getSellerBooking, acceptOrder, submitWork, cancelBooking: cancelSellerBooking } = require('../../controllers/seller/booking.controller');
const { listReviews: listSellerReviews } = require('../../controllers/seller/review.controller');
const { getStats: getSellerStats }       = require('../../controllers/seller/stats.controller');

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    allowed.has(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP allowed'));
  },
});

const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
    allowed.has(file.mimetype) ? cb(null, true) : cb(new Error('Only PDF, DOC, DOCX allowed'));
  },
});

router.use(authenticate, authorize('SELLER'));

// ── Profile ────────────────────────────────────────────────────────────
router.get ('/profile',                   getSellerProfile);
router.put ('/profile',                   updateSellerProfile);
router.put ('/change-password',           changePassword);
router.post('/upload/resume',             resumeUpload.single('resume'), uploadResume);

// ── Services ───────────────────────────────────────────────────────────
router.get   ('/services',              listMyServices);
router.post  ('/services',              imageUpload.array('images', 5), createService);
router.get   ('/services/:id',          getMyService);
router.put   ('/services/:id',          imageUpload.array('images', 5), updateService);
router.delete('/services/:id',          deleteService);
router.patch ('/services/:id/publish',  publishService);
router.patch ('/services/:id/pause',    pauseService);

// ── Bookings ───────────────────────────────────────────────────────────
router.get   ('/bookings',              listSellerBookings);
router.get   ('/bookings/:id',          getSellerBooking);
router.patch ('/bookings/:id/accept',   acceptOrder);
router.patch ('/bookings/:id/submit',   submitWork);
router.patch ('/bookings/:id/cancel',   cancelSellerBooking);

// ── Browse Jobs & Bidding ──────────────────────────────────────────────
router.get   ('/bids',           myBids);
router.get   ('/jobs',           browseJobs);
router.get   ('/jobs/:id',       getJobDetail);
router.post  ('/jobs/:id/bid',   placeBid);
router.patch ('/jobs/:id/bid',   updateBid);
router.delete('/jobs/:id/bid',   withdrawBid);

// ── Stats ──────────────────────────────────────────────────────────────
router.get('/stats', getSellerStats);

// ── Reviews ────────────────────────────────────────────────────────────
router.get('/reviews', listSellerReviews);

module.exports = router;
