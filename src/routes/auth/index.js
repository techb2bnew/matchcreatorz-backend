'use strict';
const router = require('express').Router();
const {
  register, login, logout,
  verifyOtp, resendOtp,
  verifyPhoneOtp, resendPhoneOtp,
  forgotPassword, verifyForgotOtp, resetPassword,
  google, apple,
} = require('../../controllers/auth/auth.controller');
const { authenticate }            = require('../../middlewares/auth.middleware');
const { validateBody }            = require('../../middlewares/validate.middleware');
const { authSchemas }             = require('../../helpers/validation.helper');
const upload                      = require('../../middlewares/upload.middleware');

/**
 * Normalize multipart text fields before Joi validation:
 *  - skills arrives as a JSON string → parse to array
 *  - hourly_rate arrives as string   → coerce to number
 */
const normalizeMultipart = (req, _res, next) => {
  // skills → JSON string to array
  if (req.body.skills && typeof req.body.skills === 'string') {
    try { req.body.skills = JSON.parse(req.body.skills); }
    catch { req.body.skills = [req.body.skills]; }
  }
  // portfolio_links → JSON string to array
  if (req.body.portfolio_links && typeof req.body.portfolio_links === 'string') {
    try { req.body.portfolio_links = JSON.parse(req.body.portfolio_links); }
    catch { req.body.portfolio_links = []; }
  }
  // hourly_rate → string to number
  if (req.body.hourly_rate !== undefined) {
    req.body.hourly_rate = Number(req.body.hourly_rate);
  }
  next();
};

// Accept resume, profile image, and portfolio files
const uploadFields = upload.fields([
  { name: 'resume',           maxCount: 1  },
  { name: 'profile_image',    maxCount: 1  },
  { name: 'portfolio_files',  maxCount: 10 },
]);

router.post('/register',
  uploadFields,
  normalizeMultipart,
  validateBody(authSchemas.register),
  register,
);

router.post('/login',      validateBody(authSchemas.login),      login);
router.post('/google',     google);
router.post('/apple',      apple);
router.post('/logout',     authenticate,                          logout);
router.post('/verify-otp',       validateBody(authSchemas.verifyOtp),      verifyOtp);
router.post('/resend-otp',       validateBody(authSchemas.forgotPassword),  resendOtp);
router.post('/verify-phone-otp', validateBody(authSchemas.verifyPhoneOtp),  verifyPhoneOtp);
router.post('/resend-phone-otp', validateBody(authSchemas.resendPhoneOtp),  resendPhoneOtp);

// ── Forgot password (phone OTP flow) ────────────────────────────────
router.post('/forgot-password',    validateBody(authSchemas.forgotPasswordPhone),  forgotPassword);
router.post('/verify-forgot-otp',  validateBody(authSchemas.verifyForgotPhoneOtp), verifyForgotOtp);
router.post('/reset-password',     validateBody(authSchemas.resetPassword),        resetPassword);

module.exports = router;
