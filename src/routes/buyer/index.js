'use strict';
const router = require('express').Router();
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { getProfile, updateProfile, changePassword, deleteAccount } = require('../../controllers/shared/profile.controller');
const { registerFcmToken, clearFcmToken } = require('../../controllers/shared/fcm.controller');
const { listNotifications, getUnreadCount, markOneRead, markAllRead, deleteOne: deleteNotification } = require('../../controllers/shared/notification.controller');
const {
  listMyJobs, getJob, createJob, updateJob, closeJob, deleteJob,
  getJobBids, acceptBid, rejectBid, counterBid,
} = require('../../controllers/buyer/job.controller');
const { searchServices } = require('../../controllers/buyer/service.controller');
const { listBookings, getBooking, createBooking, acceptWork, rejectWork, cancelBooking } = require('../../controllers/buyer/booking.controller');
const { createReview, listReviews } = require('../../controllers/buyer/review.controller');
const { getStats: getBuyerStats }  = require('../../controllers/buyer/stats.controller');
const { listFavourites, listFavouriteIds, addFavourite, removeFavourite } = require('../../controllers/buyer/favourite.controller');
const { listReceivedOffers, acceptOffer, declineOffer } = require('../../controllers/shared/offer.controller');

router.use(authenticate, authorize('BUYER'));

// ── Profile ────────────────────────────────────────────────────────────
router.get   ('/profile',         getProfile);
router.put   ('/profile',         updateProfile);
router.put   ('/change-password', changePassword);
router.delete('/account',         deleteAccount);
router.put   ('/fcm-token',       registerFcmToken);
router.delete('/fcm-token',       clearFcmToken);

// ── Notifications ──────────────────────────────────────────────────────
router.get   ('/notifications',              listNotifications);
router.get   ('/notifications/unread-count', getUnreadCount);
router.put   ('/notifications/read-all',     markAllRead);
router.put   ('/notifications/:id/read',     markOneRead);
router.delete('/notifications/:id',          deleteNotification);

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

// ── Favourites ─────────────────────────────────────────────────────────
router.get   ('/favourites',            listFavourites);
router.get   ('/favourites/ids',        listFavouriteIds);
router.post  ('/favourites/:serviceId', addFavourite);
router.delete('/favourites/:serviceId', removeFavourite);

// ── Offers (received) ──────────────────────────────────────────────────
router.get   ('/offers',             listReceivedOffers);
router.patch ('/offers/:id/accept',  acceptOffer);
router.patch ('/offers/:id/decline', declineOffer);

// ── Jobs ───────────────────────────────────────────────────────────────
router.get   ('/jobs',          listMyJobs);
router.get   ('/jobs/:id',      getJob);
router.post  ('/jobs',          createJob);
router.put   ('/jobs/:id',      updateJob);
router.patch ('/jobs/:id/close',              closeJob);
router.delete('/jobs/:id',                    deleteJob);
router.get   ('/jobs/:id/bids',               getJobBids);
router.patch ('/jobs/:id/bids/:bidId/accept',  acceptBid);
router.patch ('/jobs/:id/bids/:bidId/reject',  rejectBid);
router.patch ('/jobs/:id/bids/:bidId/counter', counterBid);

module.exports = router;
