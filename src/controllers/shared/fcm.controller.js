'use strict';
const { User } = require('../../models');
const response = require('../../helpers/response.helper');

/**
 * PUT /api/v1/buyer/fcm-token
 * PUT /api/v1/seller/fcm-token
 *
 * Register or update push token for web or mobile.
 *
 * MOBILE:  { platform: "mobile", token: "<Firebase FCM registration token>" }
 * WEB:     { platform: "web",    subscription: { endpoint, keys: { p256dh, auth } } }
 *
 * @swagger
 * components:
 *   schemas:
 *     FcmTokenMobile:
 *       type: object
 *       required: [platform, token]
 *       properties:
 *         platform:
 *           type: string
 *           enum: [mobile]
 *           example: mobile
 *           description: Use "mobile" for native iOS / Android apps
 *         token:
 *           type: string
 *           example: "dOj8kF3pT..."
 *           description: Firebase FCM registration token obtained from FirebaseMessaging.getToken() on the mobile app
 *     FcmTokenWeb:
 *       type: object
 *       required: [platform, subscription]
 *       properties:
 *         platform:
 *           type: string
 *           enum: [web]
 *           example: web
 *           description: Use "web" for browser / PWA
 *         subscription:
 *           type: object
 *           required: [endpoint, keys]
 *           description: PushSubscription JSON obtained from PushManager.subscribe() in the browser
 *           properties:
 *             endpoint:
 *               type: string
 *               example: "https://fcm.googleapis.com/fcm/send/..."
 *             keys:
 *               type: object
 *               properties:
 *                 p256dh: { type: string, example: "BNcRd..." }
 *                 auth:   { type: string, example: "tBHItJI5svbpez7KI4CCXg==" }
 *
 * @swagger
 * /api/v1/seller/fcm-token:
 *   put:
 *     summary: Register push token (mobile FCM or web subscription)
 *     description: |
 *       **Mobile (iOS / Android):** send `platform: "mobile"` and `token` (Firebase FCM registration token).
 *
 *       **Web / PWA:** send `platform: "web"` and `subscription` (PushSubscription JSON from the browser's PushManager).
 *     tags: [Seller - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - $ref: '#/components/schemas/FcmTokenMobile'
 *               - $ref: '#/components/schemas/FcmTokenWeb'
 *           examples:
 *             mobile:
 *               summary: Mobile — Firebase FCM token
 *               value: { platform: "mobile", token: "dOj8kF3pT2mXq..." }
 *             web:
 *               summary: Web — PushSubscription object
 *               value:
 *                 platform: web
 *                 subscription:
 *                   endpoint: "https://fcm.googleapis.com/fcm/send/abc123"
 *                   keys:
 *                     p256dh: "BNcRd..."
 *                     auth: "tBHItJI5svbpez7KI4CCXg=="
 *     responses:
 *       200:
 *         description: Push token registered successfully
 *       400:
 *         description: Missing or invalid fields
 *
 * @swagger
 * /api/v1/buyer/fcm-token:
 *   put:
 *     summary: Register push token (mobile FCM or web subscription)
 *     description: |
 *       **Mobile (iOS / Android):** send `platform: "mobile"` and `token` (Firebase FCM registration token).
 *
 *       **Web / PWA:** send `platform: "web"` and `subscription` (PushSubscription JSON from the browser's PushManager).
 *     tags: [Buyer - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - $ref: '#/components/schemas/FcmTokenMobile'
 *               - $ref: '#/components/schemas/FcmTokenWeb'
 *           examples:
 *             mobile:
 *               summary: Mobile — Firebase FCM token
 *               value: { platform: "mobile", token: "dOj8kF3pT2mXq..." }
 *             web:
 *               summary: Web — PushSubscription object
 *               value:
 *                 platform: web
 *                 subscription:
 *                   endpoint: "https://fcm.googleapis.com/fcm/send/abc123"
 *                   keys:
 *                     p256dh: "BNcRd..."
 *                     auth: "tBHItJI5svbpez7KI4CCXg=="
 *     responses:
 *       200:
 *         description: Push token registered successfully
 *       400:
 *         description: Missing or invalid fields
 */
const registerFcmToken = async (req, res, next) => {
  try {
    const { token, subscription, platform } = req.body;

    if (!platform || !['web', 'mobile'].includes(platform))
      return response.badRequest(res, 'platform must be "web" or "mobile"');

    if (platform === 'web') {
      // Web: subscription is a PushSubscription JSON object (from PushManager.subscribe())
      const sub = subscription || token; // accept either field name
      if (!sub || typeof sub !== 'object' || !sub.endpoint)
        return response.badRequest(res, 'subscription object with endpoint is required for web');
      const value = typeof sub === 'string' ? sub : JSON.stringify(sub);
      await User.update({ web_fcm_token: value }, { where: { id: req.user.id } });
    } else {
      // Mobile: token is a Firebase FCM registration token string
      if (!token || typeof token !== 'string' || !token.trim())
        return response.badRequest(res, 'token is required for mobile');
      await User.update({ mobile_fcm_token: token.trim() }, { where: { id: req.user.id } });
    }

    return response.success(res, `Push token registered for ${platform}`);
  } catch (err) { next(err); }
};

/**
 * DELETE /api/v1/buyer/fcm-token
 * DELETE /api/v1/seller/fcm-token
 *
 * Call on logout to clear push token(s).
 * Body (optional): { platform: 'web' | 'mobile' }
 * If platform is omitted, both tokens are cleared (full logout).
 *
 * @swagger
 * /api/v1/seller/fcm-token:
 *   delete:
 *     summary: Clear push token on logout
 *     description: |
 *       Call this on logout to stop push notifications to this device.
 *       Pass `platform` to clear only that token, or omit it to clear both web and mobile tokens.
 *     tags: [Seller - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               platform:
 *                 type: string
 *                 enum: [web, mobile]
 *                 description: Omit to clear both tokens
 *           examples:
 *             mobile:
 *               summary: Clear mobile token only
 *               value: { platform: "mobile" }
 *             all:
 *               summary: Clear all tokens (full logout)
 *               value: {}
 *     responses:
 *       200:
 *         description: Token cleared
 *
 * @swagger
 * /api/v1/buyer/fcm-token:
 *   delete:
 *     summary: Clear push token on logout
 *     description: |
 *       Call this on logout to stop push notifications to this device.
 *       Pass `platform` to clear only that token, or omit it to clear both web and mobile tokens.
 *     tags: [Buyer - Profile]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               platform:
 *                 type: string
 *                 enum: [web, mobile]
 *                 description: Omit to clear both tokens
 *           examples:
 *             mobile:
 *               summary: Clear mobile token only
 *               value: { platform: "mobile" }
 *             all:
 *               summary: Clear all tokens (full logout)
 *               value: {}
 *     responses:
 *       200:
 *         description: Token cleared
 */
const clearFcmToken = async (req, res, next) => {
  try {
    const { platform } = req.body || {};

    let update = {};
    if (platform === 'web') {
      update = { web_fcm_token: null };
    } else if (platform === 'mobile') {
      update = { mobile_fcm_token: null };
    } else {
      // Clear both (full logout or unspecified)
      update = { web_fcm_token: null, mobile_fcm_token: null };
    }

    await User.update(update, { where: { id: req.user.id } });
    return response.success(res, 'FCM token cleared');
  } catch (err) { next(err); }
};

module.exports = { registerFcmToken, clearFcmToken };
