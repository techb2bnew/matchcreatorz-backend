'use strict';
const bcrypt   = require('bcryptjs');
const User     = require('../../models/user.model');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: Profile
 *   description: Get and update logged-in user profile + change password
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

    // Only update fields that were actually sent
    if (name     !== undefined) user.name     = name.trim();
    if (phone    !== undefined) user.phone    = phone.trim();
    if (bio      !== undefined) user.bio      = bio.trim();
    if (location !== undefined) user.location = location.trim();
    if (avatar   !== undefined) user.avatar   = avatar.trim();

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

module.exports = { getProfile, updateProfile, changePassword };
