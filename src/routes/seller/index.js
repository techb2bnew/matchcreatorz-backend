'use strict';
const router = require('express').Router();
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const multer = require('multer');

const { listMyServices, getMyService, createService, updateService, deleteService, publishService, pauseService } = require('../../controllers/seller/service.controller');
const { uploadResume } = require('../../controllers/seller/upload.controller');
const { getSellerProfile, updateSellerProfile } = require('../../controllers/seller/profile.controller');
const { changePassword, deleteAccount, getPreferences, updatePreferences } = require('../../controllers/shared/profile.controller');
const { registerFcmToken, clearFcmToken } = require('../../controllers/shared/fcm.controller');
const { listNotifications, getUnreadCount, markOneRead, markAllRead, deleteOne: deleteNotification } = require('../../controllers/shared/notification.controller');
const { browseJobs, getJobDetail, placeBid, updateBid, withdrawBid, myBids, counterBidBySeller, acceptCounterBySeller } = require('../../controllers/seller/job.controller');
const { listBookings: listSellerBookings, getBooking: getSellerBooking, acceptOrder, submitWork, cancelBooking: cancelSellerBooking } = require('../../controllers/seller/booking.controller');
const { listReviews: listSellerReviews } = require('../../controllers/seller/review.controller');
const { getStats: getSellerStats }       = require('../../controllers/seller/stats.controller');
const { getBalance: getConnectsBalance, getHistory: getConnectsHistory, getPlans: getConnectsPlans, purchasePlan: purchaseConnects, confirmPurchase: confirmConnectsPurchase } = require('../../controllers/seller/connect.controller');
const { sendOffer, listSentOffers, withdrawOffer } = require('../../controllers/shared/offer.controller');
const { searchBuyers } = require('../../controllers/seller/buyer.controller');

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
router.get   ('/profile',         getSellerProfile);
router.put   ('/profile',         updateSellerProfile);
router.put   ('/change-password', changePassword);
router.delete('/account',         deleteAccount);
router.get   ('/preferences',     getPreferences);
router.put   ('/preferences',     updatePreferences);
router.put   ('/fcm-token',       registerFcmToken);
router.delete('/fcm-token',       clearFcmToken);

// ── Notifications ──────────────────────────────────────────────────────
router.get   ('/notifications',              listNotifications);
router.get   ('/notifications/unread-count', getUnreadCount);
router.put   ('/notifications/read-all',     markAllRead);
router.put   ('/notifications/:id/read',     markOneRead);
router.delete('/notifications/:id',          deleteNotification);
router.post  ('/upload/resume',   resumeUpload.single('resume'), uploadResume);

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
router.post  ('/jobs/:id/bid',         placeBid);
router.patch ('/jobs/:id/bid',         updateBid);
router.delete('/jobs/:id/bid',         withdrawBid);
router.patch ('/jobs/:id/bid/counter', counterBidBySeller);
router.patch ('/jobs/:id/bid/accept',  acceptCounterBySeller);

// ── Stats ──────────────────────────────────────────────────────────────
router.get('/stats', getSellerStats);

// ── Reviews ────────────────────────────────────────────────────────────
router.get('/reviews', listSellerReviews);

// ── Connects ───────────────────────────────────────────────────────────
router.get ('/connects/balance',          getConnectsBalance);
router.get ('/connects/history',          getConnectsHistory);
router.get ('/connects/plans',            getConnectsPlans);
router.post('/connects/purchase',         purchaseConnects);
router.get ('/connects/purchase/confirm', confirmConnectsPurchase);

// ── Buyer lookup (for offer picker) ────────────────────────────────────
router.get   ('/buyers',     searchBuyers);

// ── Offers (sent) ──────────────────────────────────────────────────────
router.get   ('/offers',     listSentOffers);
router.post  ('/offers',     sendOffer);
router.delete('/offers/:id', withdrawOffer);

module.exports = router;
