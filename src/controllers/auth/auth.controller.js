'use strict';
const authService     = require('../../services/auth/auth.service');
const response        = require('../../helpers/response.helper');
const { uploadToS3 }  = require('../../helpers/s3.helper');
const { authSchemas } = require('../../helpers/validation.helper');

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication APIs
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     RegisterRequest:
 *       type: object
 *       required: [name, email, password, role]
 *       properties:
 *         name:
 *           type: string
 *           description: "✅ Required — all roles"
 *           example: John Doe
 *         email:
 *           type: string
 *           format: email
 *           description: "✅ Required — all roles"
 *           example: john@example.com
 *         password:
 *           type: string
 *           description: "✅ Required — all roles | min 8 chars, 1 uppercase, 1 number"
 *           example: Password@123
 *         role:
 *           type: string
 *           enum: [SELLER, BUYER]
 *           description: "✅ Required — SELLER or BUYER only"
 *           example: SELLER
 *         phone:
 *           type: string
 *           description: "⬜ Optional — all roles. If present, must already be verified via /send-phone-otp + /verify-phone-otp (see phoneVerifyToken)"
 *           example: "+919876543210"
 *         phoneVerifyToken:
 *           type: string
 *           description: "✅ Required if phone is present — the token returned by /verify-phone-otp after confirming the phone OTP. Its phone number must match `phone`."
 *         profile_image:
 *           type: string
 *           format: uri
 *           description: "⬜ Optional — all roles"
 *           example: "https://example.com/avatar.jpg"
 *         skills:
 *           type: array
 *           items:
 *             type: string
 *           description: "✅ Required if role=SELLER"
 *           example: ["Node.js", "React", "PostgreSQL"]
 *         hourly_rate:
 *           type: number
 *           description: "✅ Required if role=SELLER | rate in INR"
 *           example: 500
 *         address:
 *           type: string
 *           description: "✅ Required if role=SELLER | Optional for BUYER"
 *           example: "221B Baker Street, Mumbai, India"
 *         bio:
 *           type: string
 *           maxLength: 500
 *           description: "⬜ Optional — Seller only"
 *           example: "Expert in web development with 5+ years experience"
 *         company_name:
 *           type: string
 *           description: "⬜ Optional — Buyer only"
 *           example: "ABC Pvt Ltd"
 *     LoginRequest:
 *       type: object
 *       required: [password]
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           description: "Email OR phone required"
 *           example: admin@matchcreatorz.com
 *         phone:
 *           type: string
 *           description: "Phone OR email required"
 *           example: "+919876543210"
 *         password:
 *           type: string
 *           example: Admin@123
 *     AuthResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: Login successful
 *         data:
 *           type: object
 *           properties:
 *             token:
 *               type: string
 *               description: JWT Bearer token
 *             user:
 *               type: object
 *               properties:
 *                 id:          { type: integer, example: 1 }
 *                 name:        { type: string,  example: John Doe }
 *                 email:       { type: string,  example: john@example.com }
 *                 role:        { type: string,  enum: [ADMIN, SELLER, BUYER] }
 *                 is_verified: { type: boolean, example: false }
 */

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Register new Seller or Buyer
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/RegisterRequest'
 *               - type: object
 *                 properties:
 *                   resume:
 *                     type: string
 *                     format: binary
 *                     description: "⬜ Optional — Seller CV/Resume (PDF, DOC, DOCX max 10MB)"
 *                   profile_image:
 *                     type: string
 *                     format: binary
 *                     description: "⬜ Optional — Profile photo (JPG, PNG max 10MB)"
 *                   portfolio_files:
 *                     type: array
 *                     items:
 *                       type: string
 *                       format: binary
 *                     description: "⬜ Optional — Seller portfolio files (images/videos/PDFs, max 10 files, 20MB each)"
 *                   portfolio_links:
 *                     type: string
 *                     description: "⬜ Optional — JSON array of external portfolio URLs e.g. [\"https://behance.net/work\"]"
 *     responses:
 *       201:
 *         description: Registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       409:
 *         description: Email already registered
 *       422:
 *         description: Validation error
 */
const register = async (req, res, next) => {
  try {
    // Upload all files to S3 in parallel
    const [resume_url, profile_image_url, ...portfolio_file_urls] = await Promise.all([
      req.files?.resume?.[0]
        ? uploadToS3(req.files.resume[0], 'resumes')
        : Promise.resolve(null),

      req.files?.profile_image?.[0]
        ? uploadToS3(req.files.profile_image[0], 'profiles')
        : Promise.resolve(null),

      ...(req.files?.portfolio_files || []).map(f => uploadToS3(f, 'portfolios')),
    ]);

    const result = await authService.register({
      ...req.body,
      resume_url,
      profile_image:      profile_image_url || req.body.profile_image || null,
      portfolio_file_urls,                                    // S3 URLs
      portfolio_links:    req.body.portfolio_links || [],     // external links
    });
    return response.created(res, 'Registered successfully', result);
  } catch (err) {
    next(err);
  }
};

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Login (Admin / Seller / Buyer)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account banned or inactive
 */
const login = async (req, res, next) => {
  try {
    const result = await authService.login(req.body);
    return response.success(res, 'Login successful', result);
  } catch (err) {
    next(err);
  }
};

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: Logout
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
const logout = async (req, res, next) => {
  try {
    await authService.logout();
    return response.success(res, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * @swagger
 * /api/v1/auth/verify-otp:
 *   post:
 *     summary: Verify email OTP after registration
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email: { type: string, format: email, example: john@example.com }
 *               otp:   { type: string, example: "847293" }
 *     responses:
 *       200:
 *         description: Verified successfully
 *       400:
 *         description: Invalid or expired OTP
 */
const verifyOtp = async (req, res, next) => {
  try {
    const result = await authService.verifyOtp(req.body);
    return response.success(res, 'Email verified successfully', result);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/auth/resend-otp:
 *   post:
 *     summary: Resend OTP to email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: john@example.com }
 *     responses:
 *       200:
 *         description: OTP resent
 */
const resendOtp = async (req, res, next) => {
  try {
    await authService.resendOtp(req.body);
    return response.success(res, 'OTP resent to your email');
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/auth/send-phone-otp:
 *   post:
 *     summary: Send a phone OTP via Twilio Verify
 *     description: |
 *       Shared by signup's phone-verify step and forgot-password's phone tab.
 *       Twilio Verify manages the code and its expiry — nothing is stored on our side.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone: { type: string, example: "+919876543210" }
 *     responses:
 *       200: { description: OTP sent }
 *       400: { description: Could not send OTP }
 */
const sendPhoneOtp = async (req, res, next) => {
  try {
    const result = await authService.sendPhoneOtpService(req.body);
    return response.success(res, 'OTP sent to your phone', result);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/auth/verify-phone-otp:
 *   post:
 *     summary: Verify a phone OTP (signup) → phone-verify token
 *     description: |
 *       Used by signup's phone-verify step. On success, returns a short-lived
 *       `phoneVerifyToken` (valid 15 minutes) — pass it along with `phone` to
 *       `/register` to complete account creation with a verified phone.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, otp]
 *             properties:
 *               phone: { type: string, example: "+919876543210" }
 *               otp:   { type: string, example: "847293" }
 *     responses:
 *       200: { description: OTP verified — phoneVerifyToken returned }
 *       400: { description: Invalid or expired OTP }
 */
const verifyPhoneOtp = async (req, res, next) => {
  try {
    const result = await authService.verifyPhoneOtpService(req.body);
    return response.success(res, 'Phone verified', result);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/auth/forgot-password:
 *   post:
 *     summary: Send OTP for password reset by email
 *     description: |
 *       Sends a 6-digit OTP via SMTP to the registered email address.
 *       Password reset by phone no longer goes through this endpoint — the frontend
 *       calls `/send-phone-otp` + `/verify-forgot-phone` instead.
 *       OTP is valid for the duration set in `OTP_EXPIRES_MIN` env variable.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john@example.com"
 *     responses:
 *       200:
 *         description: OTP sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "OTP sent to your email" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     via: { type: string, enum: [email], example: "email" }
 *       404:
 *         description: No account found with given email
 *       403:
 *         description: Account is banned
 */
const forgotPassword = async (req, res, next) => {
  try {
    const result = await authService.forgotPasswordByEmail(req.body);
    return response.success(res, 'OTP sent to your email', result);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/auth/verify-forgot-otp:
 *   post:
 *     summary: Verify email OTP for password reset
 *     description: |
 *       Pass the `email` used in `/forgot-password` along with the OTP.
 *       On success, returns a short-lived `reset_token` (valid 15 minutes) for `/reset-password`.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john@example.com"
 *               otp:
 *                 type: string
 *                 description: "6-digit OTP received"
 *                 example: "382910"
 *     responses:
 *       200:
 *         description: OTP verified — reset token returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "OTP verified" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     reset_token:
 *                       type: string
 *                       description: "UUID — pass to /reset-password (expires in 15 min)"
 *                       example: "a3f9e2c1-8b47-4d20-9c11-f0e1a2b3c4d5"
 *       400:
 *         description: Invalid or expired OTP
 *       404:
 *         description: Email not found
 */
const verifyForgotOtp = async (req, res, next) => {
  try {
    const result = await authService.verifyForgotEmailOtp(req.body);
    return response.success(res, 'OTP verified', result);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/auth/verify-forgot-phone:
 *   post:
 *     summary: Verify phone OTP for password reset → reset token
 *     description: |
 *       Pass the `phone` used in `/send-phone-otp` along with the OTP.
 *       On success, returns a short-lived `reset_token` (valid 15 minutes) for `/reset-password`.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, otp]
 *             properties:
 *               phone: { type: string, example: "+919876543210" }
 *               otp:   { type: string, example: "847293" }
 *     responses:
 *       200:
 *         description: OTP verified — reset token returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Phone verified" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     reset_token:
 *                       type: string
 *                       example: "a3f9e2c1-8b47-4d20-9c11-f0e1a2b3c4d5"
 *       400:
 *         description: Invalid or expired OTP
 *       404:
 *         description: No account found with this phone number
 *       403:
 *         description: Account is banned
 */
const verifyForgotPhone = async (req, res, next) => {
  try {
    const result = await authService.verifyPhoneForReset(req.body);
    return response.success(res, 'Phone verified', result);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/auth/reset-password:
 *   post:
 *     summary: Reset password using reset token
 *     description: |
 *       Sets a new password for the user. Requires the `reset_token` returned by
 *       `/verify-forgot-otp`. Token is single-use and expires after 15 minutes.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token:
 *                 type: string
 *                 description: "Reset token from /verify-forgot-otp"
 *                 example: "a3f9e2c1-8b47-4d20-9c11-f0e1a2b3c4d5"
 *               password:
 *                 type: string
 *                 description: "New password (min 8 chars, 1 uppercase, 1 number)"
 *                 example: "NewPass@123"
 *     responses:
 *       200:
 *         description: Password reset successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Password reset successfully" }
 *       400:
 *         description: Invalid or expired reset token
 */
const resetPassword = async (req, res, next) => {
  try {
    await authService.resetPassword(req.body);
    return response.success(res, 'Password reset successfully');
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/auth/google:
 *   post:
 *     summary: Sign in / sign up with Google
 *     description: |
 *       Send the Google ID-token (`credential`) obtained from Google Identity Services.
 *       - Existing user → returns `{ token, role, user }`.
 *       - New user without `role` → returns `{ isNew: true, profile }` so the client can ask for a role.
 *       - New user with `role` (BUYER|SELLER) → creates the account. BUYER logs in immediately; SELLER is created pending admin approval.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [credential]
 *             properties:
 *               credential: { type: string, description: Google ID token (JWT) from GSI }
 *               role:       { type: string, enum: [BUYER, SELLER], description: Required only when completing a new signup }
 *     responses:
 *       200: { description: Logged in, or isNew/pendingApproval info }
 *       401: { description: Invalid Google token }
 */
const google = async (req, res, next) => {
  try {
    const result = await authService.googleAuth(req.body);
    return response.success(res, result.token ? 'Login successful' : 'Google verified', result);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/auth/apple:
 *   post:
 *     summary: Sign in / sign up with Apple
 *     description: |
 *       Send the Apple identity token (`identity_token`) obtained from Sign in with Apple
 *       (`ASAuthorizationAppleIDCredential.identityToken` on iOS, or the `id_token` from
 *       Apple's web JS SDK — either field name is accepted).
 *
 *       Apple only sends the user's name on the **very first** authorization ever, as a
 *       separate `user` JSON object (never inside the token itself) — if present, pass it
 *       through untouched so the account gets a real name instead of falling back to the
 *       email handle.
 *       - Existing user → returns `{ token, role, user }`.
 *       - New user without `role` → returns `{ isNew: true, profile }` so the client can ask for a role.
 *       - New user with `role` (BUYER|SELLER) → creates the account. BUYER logs in immediately; SELLER is created pending admin approval.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identity_token]
 *             properties:
 *               identity_token: { type: string, description: Apple identity token (JWT) }
 *               id_token:       { type: string, description: "Alias for identity_token (web SDK naming)" }
 *               user:
 *                 type: object
 *                 nullable: true
 *                 description: Only present on the first-ever authorization — forward it as-is.
 *                 properties:
 *                   email: { type: string, nullable: true }
 *                   name:
 *                     type: object
 *                     nullable: true
 *                     properties:
 *                       firstName: { type: string, nullable: true }
 *                       lastName:  { type: string, nullable: true }
 *               role: { type: string, enum: [BUYER, SELLER], description: Required only when completing a new signup }
 *     responses:
 *       200: { description: Logged in, or isNew/pendingApproval info }
 *       401: { description: Invalid Apple token }
 */
const apple = async (req, res, next) => {
  try {
    const result = await authService.appleAuth(req.body);
    return response.success(res, result.token ? 'Login successful' : 'Apple verified', result);
  } catch (err) { next(err); }
};

module.exports = {
  register, login, logout,
  verifyOtp, resendOtp,
  sendPhoneOtp, verifyPhoneOtp,
  forgotPassword, verifyForgotOtp, verifyForgotPhone, resetPassword,
  google, apple,
};
