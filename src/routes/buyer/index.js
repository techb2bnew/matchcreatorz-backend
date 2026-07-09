'use strict';
const router = require('express').Router();
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { getProfile, updateProfile, changePassword } = require('../../controllers/shared/profile.controller');
const {
  listMyJobs, getJob, createJob, updateJob, closeJob, deleteJob,
} = require('../../controllers/buyer/job.controller');

router.use(authenticate, authorize('BUYER'));

// ── Profile ────────────────────────────────────────────────────────────
router.get ('/profile',         getProfile);
router.put ('/profile',         updateProfile);
router.put ('/change-password', changePassword);

// ── Jobs ───────────────────────────────────────────────────────────────
router.get   ('/jobs',          listMyJobs);
router.get   ('/jobs/:id',      getJob);
router.post  ('/jobs',          createJob);
router.put   ('/jobs/:id',      updateJob);
router.patch ('/jobs/:id/close', closeJob);
router.delete('/jobs/:id',      deleteJob);

module.exports = router;
