'use strict';
const router = require('express').Router();
const { authenticate } = require('../../middlewares/auth.middleware');
const c = require('../../controllers/wallet/wallet.controller');

// NOTE: POST /wallet/webhook is registered in app.js (raw body) — NOT here.
router.use(authenticate);

// Shared
router.get('/',             c.summary);
router.get('/config',       c.config);
router.get('/transactions', c.transactions);

// Buyer top-up
router.post('/topup',         c.topup);
router.get ('/topup/confirm', c.confirmTopup);

// Seller payouts
router.post('/connect/onboard', c.connectOnboard);
router.get ('/connect/status',  c.connectStatus);
router.post('/withdraw',        c.withdraw);
router.get ('/withdrawals',     c.myWithdrawals);

// Admin
router.get  ('/admin/overview',              c.adminOverview);
router.get  ('/admin/withdrawals',           c.adminWithdrawals);
router.patch('/admin/withdrawals/:id/approve', c.approveWithdrawal);
router.patch('/admin/withdrawals/:id/reject',  c.rejectWithdrawal);
router.post ('/admin/adjust',                c.adminAdjust);

module.exports = router;
