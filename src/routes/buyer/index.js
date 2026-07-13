'use strict';
const router = require('express').Router();
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { getProfile, updateProfile, changePassword } = require('../../controllers/shared/profile.controller');
const {
  listMyJobs, getJob, createJob, updateJob, closeJob, deleteJob,
  getJobBids, acceptBid, rejectBid,
} = require('../../controllers/buyer/job.controller');
const { searchServices } = require('../../controllers/buyer/service.controller');
const { listBookings, getBooking, createBooking, acceptWork, rejectWork, cancelBooking } = require('../../controllers/buyer/booking.controller');
const { createReview, listReviews } = require('../../controllers/buyer/review.controller');
const { getStats: getBuyerStats }  = require('../../controllers/buyer/stats.controller');

router.use(authenticate, authorize('BUYER'));

// ── Profile ────────────────────────────────────────────────────────────
router.get ('/profile',         getProfile);
router.put ('/profile',         updateProfile);
router.put ('/change-password', changePassword);

// ── Stats ──────────────────────────────────────────────────────────────
router.get('/stats', getBuyerStats);

// ── Services ───────────────────────────────────────────────────────────
router.get('/services', searchServices);

// ── Bookings ───────────────────────────────────────────────────────────
router.get   ('/bookings',              listBookings);
router.post  ('/bookings',              createBooking);
router.get   ('/bookings/:id',          getBooking);
router.patch ('/bookings/:id/accept',   acceptWork);
router.patch ('/bookings/:id/reject',   rejectWork);
router.patch ('/bookings/:id/cancel',   cancelBooking);

// ── Reviews ────────────────────────────────────────────────────────────
router.get  ('/reviews', listReviews);
router.post ('/reviews', createReview);

// ── Jobs ───────────────────────────────────────────────────────────────
router.get   ('/jobs',          listMyJobs);
router.get   ('/jobs/:id',      getJob);
router.post  ('/jobs',          createJob);
router.put   ('/jobs/:id',      updateJob);
router.patch ('/jobs/:id/close',              closeJob);
router.delete('/jobs/:id',                    deleteJob);
router.get   ('/jobs/:id/bids',               getJobBids);
router.patch ('/jobs/:id/bids/:bidId/accept', acceptBid);
router.patch ('/jobs/:id/bids/:bidId/reject', rejectBid);

module.exports = router;
