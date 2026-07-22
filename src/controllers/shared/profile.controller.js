'use strict';
const bcrypt   = require('bcryptjs');
const { User, SellerProfile } = require('../../models');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   - name: Admin - Profile
 *     description: Admin profile management
 *   - name: Seller - Profile
 *     description: Seller profile management
 *   - name: Buyer - Profile
 *     description: Buyer profile management
 */

/**
 * @swagger
 * /api/v1/admin/profile:
 *   get:
 *     summary: Get admin profile
 *     tags: [Admin - Profile]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile fetched }
 *   put:
 *     summary: Update admin profile
 *     tags: [Admin - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:     { type: string, example: "Admin User" }
 *               phone:    { type: string, example: "9876543210" }
 *               bio:      { type: string }
 *               location: { type: string, example: "Delhi, India" }
 *     responses:
 *       200: { description: Profile updated }
 *
 * /api/v1/admin/change-password:
 *   put:
 *     summary: Change admin password
 *     tags: [Admin - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [current_password, new_password]
 *             properties:
 *               current_password: { type: string, example: "OldPass@123" }
 *               new_password:     { type: string, example: "NewPass@456" }
 *     responses:
 *       200: { description: Password changed }
 *       400: { description: Incorrect current password }
 *
 * /api/v1/seller/profile:
 *   get:
 *     summary: Get seller profile
 *     tags: [Seller - Profile]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile fetched }
 *   put:
 *     summary: Update seller profile
 *     tags: [Seller - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:     { type: string }
 *               phone:    { type: string }
 *               bio:      { type: string }
 *               location: { type: string }
 *     responses:
 *       200: { description: Profile updated }
 *
 * /api/v1/seller/change-password:
 *   put:
 *     summary: Change seller password
 *     tags: [Seller - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [current_password, new_password]
 *             properties:
 *               current_password: { type: string, example: "OldPass@123" }
 *               new_password:     { type: string, example: "NewPass@456" }
 *     responses:
 *       200: { description: Password changed }
 *
 * /api/v1/buyer/profile:
 *   get:
 *     summary: Get buyer profile
 *     tags: [Buyer - Profile]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile fetched }
 *   put:
 *     summary: Update buyer profile
 *     tags: [Buyer - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:     { type: string }
 *               phone:    { type: string }
 *               bio:      { type: string }
 *               location: { type: string }
 *     responses:
 *       200: { description: Profile updated }
 *
 * /api/v1/buyer/change-password:
 *   put:
 *     summary: Change buyer password
 *     tags: [Buyer - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [current_password, new_password]
 *             properties:
 *               current_password: { type: string, example: "OldPass@123" }
 *               new_password:     { type: string, example: "NewPass@456" }
 *     responses:
 *       200: { description: Password changed }
 */

// Safe fields to return (never expose password/OTP)
const SAFE_FIELDS = ['id','name','email','phone','role','status','is_verified','bio','location','avatar','created_at'];

/**
 * @swagger
 * /api/v1/{role}/profile:
 *   get:
 *     summary: Get my profile
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: role
 *         schema: { type: string, enum: [admin, seller, buyer] }
 *     responses:
 *       200:
 *         description: Profile fetched
 */
const getProfile = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: SAFE_FIELDS,
    });
    if (!user) return response.notFound(res, 'User not found');
    return response.success(res, 'Profile fetched', user);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/{role}/profile:
 *   put:
 *     summary: Update my profile
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: role
 *         schema: { type: string, enum: [admin, seller, buyer] }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:     { type: string,  example: "John Doe" }
 *               phone:    { type: string,  example: "9876543210" }
 *               bio:      { type: string,  example: "Creative designer with 5 years experience" }
 *               location: { type: string,  example: "Mumbai, India" }
 *               avatar:   { type: string,  example: "https://..." }
 *     responses:
 *       200:
 *         description: Profile updated
 */
const updateProfile = async (req, res, next) => {
  try {
    const { name, phone, bio, location, avatar } = req.body;

    const user = await User.findByPk(req.user.id);
    if (!user) return response.notFound(res, 'User not found');

    // Only update fields that were actually sent. Null-safe: coerce to string
    // before trimming so a null/number payload can never throw.
    const clean = (v) => (v === null || v === undefined ? v : String(v).trim());
    if (name     !== undefined) user.name     = clean(name);
    if (phone    !== undefined) user.phone    = clean(phone);
    if (bio      !== undefined) user.bio      = clean(bio);
    if (location !== undefined) user.location = clean(location);
    if (avatar   !== undefined) user.avatar   = clean(avatar);

    await user.save();

    const updated = await User.findByPk(req.user.id, { attributes: SAFE_FIELDS });
    return response.success(res, 'Profile updated successfully', updated);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/{role}/change-password:
 *   put:
 *     summary: Change my password
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: role
 *         schema: { type: string, enum: [admin, seller, buyer] }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [current_password, new_password]
 *             properties:
 *               current_password: { type: string, example: "OldPass@123" }
 *               new_password:     { type: string, example: "NewPass@456" }
 *     responses:
 *       200:
 *         description: Password changed
 *       400:
 *         description: Current password incorrect or new password too short
 */
const changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password)
      return response.badRequest(res, 'current_password and new_password are required');

    if (new_password.length < 8)
      return response.badRequest(res, 'New password must be at least 8 characters');

    const user = await User.findByPk(req.user.id);
    if (!user) return response.notFound(res, 'User not found');

    const match = await bcrypt.compare(current_password, user.password);
    if (!match) return response.badRequest(res, 'Current password is incorrect');

    user.password = await bcrypt.hash(new_password, 12);
    await user.save();

    return response.success(res, 'Password changed successfully');
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/buyer/account:
 *   delete:
 *     summary: Delete buyer account (soft delete)
 *     tags: [Buyer - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 example: "No longer needed"
 *                 description: Optional reason for deletion
 *     responses:
 *       200:
 *         description: Account deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Account deleted successfully" }
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *
 * /api/v1/seller/account:
 *   delete:
 *     summary: Delete seller account (soft delete)
 *     tags: [Seller - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 example: "Switching to another platform"
 *                 description: Optional reason for deletion
 *     responses:
 *       200:
 *         description: Account deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Account deleted successfully" }
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
const deleteAccount = async (req, res, next) => {
  try {
    const { reason } = req.body || {};

    const user = await User.findByPk(req.user.id);
    if (!user) return response.notFound(res, 'User not found');

    // Soft delete — sets deleted_at timestamp (paranoid: true on User model)
    await user.destroy();

    console.log(`Account soft-deleted: userId=${user.id} role=${user.role} reason="${reason || 'not provided'}"`);

    return response.success(res, 'Account deleted successfully');
  } catch (err) { next(err); }
};

/**
 * @swagger
 * tags:
 *   - name: Seller - Settings
 *     description: Seller settings & preferences (notifications, privacy, payout)
 *   - name: Buyer - Settings
 *     description: Buyer settings & preferences (notifications, privacy)
 *
 * /api/v1/seller/preferences:
 *   get:
 *     summary: Get my settings/preferences
 *     tags: [Seller - Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Preferences object }
 *   put:
 *     summary: Update my settings/preferences (shallow-merged per group)
 *     tags: [Seller - Settings]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             example: { notifications: { email: true, sms: false, jobAlert: true, bookingAlert: true, payAlert: true, chatAlert: false, offerAlert: true }, privacy: { showProfile: true, showEarnings: false, showRating: true, available: true, twoFactor: false }, payout: { minPayout: 500, payMethod: "bank", autoWithdraw: false } }
 *     responses:
 *       200: { description: Preferences saved }
 *
 * /api/v1/buyer/preferences:
 *   get:
 *     summary: Get my settings/preferences
 *     tags: [Buyer - Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Preferences object }
 *   put:
 *     summary: Update my settings/preferences (shallow-merged per group)
 *     tags: [Buyer - Settings]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             example: { notifications: { email: true, sms: false }, privacy: { showProfile: true } }
 *     responses:
 *       200: { description: Preferences saved }
 */
const getPreferences = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id, { attributes: ['preferences'] });
    if (!user) return response.notFound(res, 'User not found');
    return response.success(res, 'Preferences fetched', user.preferences || {});
  } catch (err) { next(err); }
};

const updatePreferences = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return response.notFound(res, 'User not found');
    const current = user.preferences || {};
    const incoming = req.body || {};
    // shallow-merge each top-level group (notifications / privacy / payout)
    const merged = { ...current };
    for (const [group, val] of Object.entries(incoming)) {
      merged[group] = (val && typeof val === 'object' && !Array.isArray(val))
        ? { ...(current[group] || {}), ...val }
        : val;
    }
    await user.update({ preferences: merged });

    // Enforce seller "Available for Work" → canonical SellerProfile.is_available
    if (user.role === 'SELLER' && incoming.privacy && incoming.privacy.available !== undefined) {
      await SellerProfile.update(
        { is_available: !!incoming.privacy.available },
        { where: { user_id: user.id } }
      ).catch(() => {});
    }

    return response.success(res, 'Preferences saved', merged);
  } catch (err) { next(err); }
};

module.exports = { getProfile, updateProfile, changePassword, deleteAccount, getPreferences, updatePreferences };
