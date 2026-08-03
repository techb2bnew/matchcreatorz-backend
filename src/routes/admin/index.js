'use strict';
const router = require('express').Router();
const multer = require('multer');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');

const { listSellers, getSellerById, addSeller, editSeller, approveSeller, rejectSeller, blockSeller, unblockSeller } = require('../../controllers/admin/seller.controller');
const { listBuyers, getBuyerById, addBuyer, editBuyer, approveBuyer, rejectBuyer, blockBuyer, unblockBuyer } = require('../../controllers/admin/buyer.controller');
const { listCategories, getCategoryById, addCategory, editCategory, deleteCategory } = require('../../controllers/admin/category.controller');
const { listServices, getServiceById, rejectService, restoreService, toggleFeatured, deleteService: deleteAdminService } = require('../../controllers/admin/service.controller');
const { getProfile, updateProfile, changePassword } = require('../../controllers/shared/profile.controller');
const { listBookings: listAdminBookings, getBooking: getAdminBooking, resolveDispute, deleteBooking } = require('../../controllers/admin/booking.controller');
const { listReviews: listAdminReviews, publishReview, hideReview, deleteReview } = require('../../controllers/admin/review.controller');
const { getStats: getAdminStats } = require('../../controllers/admin/stats.controller');
const { listJobs, getJob, closeJob, deleteJob } = require('../../controllers/admin/job.controller');
const { addConnects, sellerHistory: connectsSellerHistory } = require('../../controllers/admin/connect.controller');
const { getSettings, updateSettings } = require('../../controllers/admin/setting.controller');
const { listNotifications, getUnreadCount, markOneRead, markAllRead, deleteOne } = require('../../controllers/shared/notification.controller');
const { registerFcmToken, clearFcmToken } = require('../../controllers/shared/fcm.controller');
const { listBanners, createBanner, updateBanner, deleteBanner } = require('../../controllers/admin/banner.controller');
const { listPages, updatePage } = require('../../controllers/admin/page.controller');

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    allowed.has(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP allowed'));
  },
});

router.use(authenticate, authorize('ADMIN'));

// ── Notifications ──────────────────────────────────────────────────────
router.get   ('/notifications',              listNotifications);
router.get   ('/notifications/unread-count', getUnreadCount);
router.put   ('/notifications/:id/read',     markOneRead);
router.put   ('/notifications/read-all',     markAllRead);
router.delete('/notifications/:id',          deleteOne);

// ── Push notification token ───────────────────────────────────────────
router.put   ('/fcm-token', registerFcmToken);
router.delete('/fcm-token', clearFcmToken);

// ── Profile ────────────────────────────────────────────────────────────
router.get ('/profile',         getProfile);
router.put ('/profile',         updateProfile);
router.put ('/change-password', changePassword);

// ── Sellers ────────────────────────────────────────────────────────────
router.get   ('/sellers',              listSellers);
router.post  ('/sellers',              addSeller);
router.get   ('/sellers/:id',          getSellerById);
router.put   ('/sellers/:id',          editSeller);
router.patch ('/sellers/:id/approve',  approveSeller);
router.patch ('/sellers/:id/reject',   rejectSeller);
router.patch ('/sellers/:id/block',    blockSeller);
router.patch ('/sellers/:id/unblock',  unblockSeller);

// ── Buyers ─────────────────────────────────────────────────────────────
router.get   ('/buyers',               listBuyers);
router.post  ('/buyers',               addBuyer);
router.get   ('/buyers/:id',           getBuyerById);
router.put   ('/buyers/:id',           editBuyer);
router.patch ('/buyers/:id/approve',   approveBuyer);
router.patch ('/buyers/:id/reject',    rejectBuyer);
router.patch ('/buyers/:id/block',     blockBuyer);
router.patch ('/buyers/:id/unblock',   unblockBuyer);

// ── Categories ─────────────────────────────────────────────────────────
router.get   ('/categories',           listCategories);
router.post  ('/categories',           addCategory);
router.get   ('/categories/:id',       getCategoryById);
router.put   ('/categories/:id',       editCategory);
router.delete('/categories/:id',       deleteCategory);

// ── Bookings ───────────────────────────────────────────────────────────
router.get   ('/bookings',                  listAdminBookings);
router.get   ('/bookings/:id',              getAdminBooking);
router.patch ('/bookings/:id/resolve',      resolveDispute);
router.delete('/bookings/:id',              deleteBooking);

// ── Services ───────────────────────────────────────────────────────────
router.get   ('/services',             listServices);
router.get   ('/services/:id',         getServiceById);
router.patch ('/services/:id/reject',  rejectService);
router.patch ('/services/:id/restore', restoreService);
router.patch ('/services/:id/feature', toggleFeatured);
router.delete('/services/:id',         deleteAdminService);

// ── Jobs ───────────────────────────────────────────────────────────────
router.get   ('/jobs',              listJobs);
router.get   ('/jobs/:id',          getJob);
router.patch ('/jobs/:id/close',    closeJob);
router.delete('/jobs/:id',          deleteJob);

// ── Connects ───────────────────────────────────────────────────────────
router.post('/connects/:sellerId',         addConnects);
router.get ('/connects/:sellerId/history', connectsSellerHistory);

// ── Settings ───────────────────────────────────────────────────────────
router.get('/settings', getSettings);
router.put('/settings', updateSettings);

// ── Stats ──────────────────────────────────────────────────────────────
router.get('/stats', getAdminStats);

// ── Reviews ────────────────────────────────────────────────────────────
router.get   ('/reviews',              listAdminReviews);
router.patch ('/reviews/:id/publish',  publishReview);
router.patch ('/reviews/:id/hide',     hideReview);
router.delete('/reviews/:id',          deleteReview);

// ── Banners ────────────────────────────────────────────────────────────
router.get   ('/banners',      listBanners);
router.post  ('/banners',      imageUpload.single('image'), createBanner);
router.put   ('/banners/:id',  imageUpload.single('image'), updateBanner);
router.delete('/banners/:id',  deleteBanner);

// ── Static Pages ───────────────────────────────────────────────────────
router.get ('/pages',      listPages);
router.put ('/pages/:id',  updatePage);

module.exports = router;
