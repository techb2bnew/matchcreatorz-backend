'use strict';
const { AppSetting } = require('../../models');
const response = require('../../helpers/response.helper');

// Sensible defaults returned when a key has not been saved yet.
const DEFAULTS = {
  platform_fees: { platform_fee: 10, min_settlement: 2, tax_rate: 18 },
  bid_settings:  { connects_per_bid: 1 },
  connect_plans: [
    { id: 1, name: 'Starter',  price: 9.99,  connects: 30,  color: '#e84545', icon: 'fa-leaf' },
    { id: 2, name: 'Pro',      price: 19.99, connects: 80,  color: '#4f9ef8', icon: 'fa-bolt' },
    { id: 3, name: 'Business', price: 39.99, connects: 200, color: '#10b981', icon: 'fa-building' },
  ],
  app_info: {
    app_name: 'MatchCreatorz', support_email: 'support@matchcreatorz.com',
    support_phone: '', app_version: '1.0.0', timezone: 'Asia/Kolkata', currency: 'INR',
  },
  escrow_settings: { enabled: false },
};

/**
 * @swagger
 * tags:
 *   name: Admin - Settings
 *   description: Platform-wide settings (fees, connect plans, app info)
 */

/**
 * @swagger
 * /api/v1/admin/settings:
 *   get:
 *     summary: Get all platform settings
 *     tags: [Admin - Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Settings object keyed by setting name (defaults applied for missing keys)
 */
exports.getSettings = async (req, res, next) => {
  try {
    const rows = await AppSetting.findAll();
    const saved = {};
    rows.forEach(r => { saved[r.key] = r.value; });
    // merge defaults with saved values
    const out = { ...DEFAULTS, ...saved };
    return response.success(res, 'Settings fetched', out);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/settings:
 *   put:
 *     summary: Update one or more platform settings
 *     tags: [Admin - Settings]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       description: Object of setting keys to upsert. Any subset is allowed.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               platform_fees:
 *                 type: object
 *                 example: { platform_fee: 10, min_settlement: 2, tax_rate: 18 }
 *               bid_settings:
 *                 type: object
 *                 example: { connects_per_bid: 1 }
 *               connect_plans:
 *                 type: array
 *                 items: { type: object }
 *               app_info:
 *                 type: object
 *               escrow_settings:
 *                 type: object
 *                 description: Admin toggle for Stripe-backed escrow payments (fixed-price/milestone bookings). Off by default — existing wallet flow is unaffected until enabled.
 *                 example: { enabled: false }
 *     responses:
 *       200:
 *         description: Settings saved, returns the full merged settings object
 *       400:
 *         description: No valid settings provided
 */
exports.updateSettings = async (req, res, next) => {
  try {
    const body = req.body || {};
    const allowed = ['platform_fees', 'bid_settings', 'connect_plans', 'app_info', 'escrow_settings'];
    const keys = Object.keys(body).filter(k => allowed.includes(k));
    if (keys.length === 0)
      return response.badRequest(res, `Provide at least one of: ${allowed.join(', ')}`);

    for (const key of keys) {
      const [row, created] = await AppSetting.findOrCreate({
        where:    { key },
        defaults: { key, value: body[key] },
      });
      if (!created) await row.update({ value: body[key] });
    }

    const rows = await AppSetting.findAll();
    const saved = {};
    rows.forEach(r => { saved[r.key] = r.value; });
    return response.success(res, 'Settings saved', { ...DEFAULTS, ...saved });
  } catch (err) { next(err); }
};
