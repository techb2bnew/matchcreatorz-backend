'use strict';
const router = require('express').Router();
const { authenticate, authorize } = require('../../middlewares/auth.middleware');

const { listSellers, getSellerById, addSeller, editSeller, approveSeller, rejectSeller, blockSeller, unblockSeller } = require('../../controllers/admin/seller.controller');
const { listBuyers, getBuyerById, addBuyer, editBuyer, blockBuyer, unblockBuyer } = require('../../controllers/admin/buyer.controller');
const { listCategories, getCategoryById, addCategory, editCategory, deleteCategory } = require('../../controllers/admin/category.controller');
const { listServices, getServiceById, rejectService, restoreService, toggleFeatured, deleteService: deleteAdminService } = require('../../controllers/admin/service.controller');
const { getProfile, updateProfile, changePassword } = require('../../controllers/shared/profile.controller');
const { listBookings: listAdminBookings, getBooking: getAdminBooking, resolveDispute, deleteBooking } = require('../../controllers/admin/booking.controller');
const { listReviews: listAdminReviews, publishReview, hideReview, deleteReview } = require('../../controllers/admin/review.controller');
const { getStats: getAdminStats } = require('../../controllers/admin/stats.controller');

router.use(authenticate, authorize('ADMIN'));

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

// ── Stats ──────────────────────────────────────────────────────────────
router.get('/stats', getAdminStats);

// ── Reviews ────────────────────────────────────────────────────────────
router.get   ('/reviews',              listAdminReviews);
router.patch ('/reviews/:id/publish',  publishReview);
router.patch ('/reviews/:id/hide',     hideReview);
router.delete('/reviews/:id',          deleteReview);

module.exports = router;
