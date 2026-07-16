'use strict';
const User          = require('../../models/user.model');
const SellerProfile = require('../../models/sellerProfile.model');
const response      = require('../../helpers/response.helper');

const SAFE_USER = ['id','name','email','phone','role','status','is_verified','bio','location','avatar','created_at'];

/**
 * @swagger
 * /api/v1/seller/profile:
 *   get:
 *     summary: Get seller profile (User + SellerProfile)
 *     tags: [Seller - Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Seller profile fetched
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:         { type: integer }
 *                 name:       { type: string }
 *                 email:      { type: string }
 *                 phone:      { type: string }
 *                 bio:        { type: string }
 *                 location:   { type: string }
 *                 avatar:     { type: string }
 *                 seller_profile:
 *                   type: object
 *                   properties:
 *                     skills:          { type: array, items: { type: string } }
 *                     hourly_rate:     { type: number }
 *                     city:            { type: string }
 *                     country:         { type: string }
 *                     resume:          { type: string }
 *                     portfolio_links: { type: array, items: { type: string } }
 *                     portfolio_files: { type: array, items: { type: string } }
 */
const getSellerProfile = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id, { attributes: SAFE_USER });
    if (!user) return response.notFound(res, 'User not found');

    let profile = await SellerProfile.findOne({ where: { user_id: req.user.id } });
    if (!profile) {
      profile = await SellerProfile.create({ user_id: req.user.id });
    }

    return response.success(res, 'Profile fetched', {
      ...user.toJSON(),
      seller_profile: profile,
    });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/seller/profile:
 *   put:
 *     summary: Update seller profile (User + SellerProfile fields)
 *     tags: [Seller - Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:            { type: string, example: "Alex Johnson" }
 *               phone:           { type: string, example: "+919876543210" }
 *               bio:             { type: string, example: "Experienced video editor" }
 *               location:        { type: string, example: "Mumbai, India" }
 *               avatar:          { type: string, example: "https://..." }
 *               skills:          { type: array,  items: { type: string }, example: ["Video Editing", "Motion Graphics"] }
 *               hourly_rate:     { type: number, example: 500 }
 *               city:            { type: string, example: "Mumbai" }
 *               country:         { type: string, example: "India" }
 *               resume:          { type: string, example: "https://s3.amazonaws.com/resumes/..." }
 *               portfolio_links: { type: array,  items: { type: string } }
 *               portfolio_files: { type: array,  items: { type: string } }
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
const updateSellerProfile = async (req, res, next) => {
  try {
    const {
      name, phone, bio, location, avatar,
      skills, hourly_rate, city, country,
      resume, portfolio_links, portfolio_files,
    } = req.body;

    const user = await User.findByPk(req.user.id);
    if (!user) return response.notFound(res, 'User not found');

    // User fields
    if (name     !== undefined) user.name     = name.trim();
    if (phone    !== undefined) user.phone    = phone.trim();
    if (bio      !== undefined) user.bio      = bio.trim();
    if (location !== undefined) user.location = location.trim();
    if (avatar   !== undefined) user.avatar   = avatar.trim();
    await user.save();

    // SellerProfile fields
    let profile = await SellerProfile.findOne({ where: { user_id: req.user.id } });
    if (!profile) profile = await SellerProfile.create({ user_id: req.user.id });

    if (skills          !== undefined) profile.skills          = Array.isArray(skills) ? skills : [];
    if (hourly_rate     !== undefined) profile.hourly_rate     = hourly_rate;
    if (city            !== undefined) profile.city            = city ? city.trim() : null;
    if (country         !== undefined) profile.country         = country ? country.trim() : null;
    if (resume          !== undefined) profile.resume          = resume ? resume.trim() : null;
    if (portfolio_links !== undefined) profile.portfolio_links = Array.isArray(portfolio_links) ? portfolio_links : [];
    if (portfolio_files !== undefined) profile.portfolio_files = Array.isArray(portfolio_files) ? portfolio_files : [];

    await profile.save();

    const updated = await User.findByPk(req.user.id, { attributes: SAFE_USER });
    return response.success(res, 'Profile updated successfully', {
      ...updated.toJSON(),
      seller_profile: profile,
    });
  } catch (err) { next(err); }
};

module.exports = { getSellerProfile, updateSellerProfile };
