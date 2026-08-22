'use strict';
const env = require('../config/env');

// ── Lazy-init Firebase Admin ──────────────────────────────────────────────────
function getAdminApp() {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.warn('⚠️  Firebase env vars not set — Firebase Admin features disabled');
    return null;
  }
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId:   env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          // env file stores \n as literal \\n — convert back
          privateKey:  env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    }
    return admin;
  } catch (err) {
    console.error('❌  Firebase init failed:', err.message);
    return null;
  }
}

let _messaging = null;

function getMessaging() {
  if (_messaging) return _messaging;
  const admin = getAdminApp();
  if (!admin) return null;
  _messaging = admin.messaging();
  return _messaging;
}

// ── Send to single device ─────────────────────────────────────────────────────
/**
 * @param {string} fcmToken  - Device FCM token
 * @param {string} title     - Notification title
 * @param {string} body      - Notification body
 * @param {object} [data]    - Optional key-value data payload
 */
const sendPush = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken) return null;

  const messaging = getMessaging();
  if (!messaging) return null;

  try {
    const stringData = {};
    for (const [k, v] of Object.entries(data)) {
      stringData[k] = String(v);
    }

    const result = await messaging.send({
      token: fcmToken,
      notification: { title, body },
      data: stringData,
      android: {
        priority: 'high',
        notification: { sound: 'default', clickAction: 'FLUTTER_NOTIFICATION_CLICK' },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    });

    console.log(`🔔  FCM sent to token ...${fcmToken.slice(-8)} — ${title}`);
    return result;
  } catch (err) {
    // Log but never crash the main flow
    if (err.code === 'messaging/registration-token-not-registered' ||
        err.code === 'messaging/invalid-registration-token') {
      console.warn(`⚠️  FCM token invalid/expired — clearing for user`);
      return { invalidToken: true };
    }
    console.error('❌  FCM send error:', err.message);
    return null;
  }
};

// ── Send to multiple tokens ───────────────────────────────────────────────────
const sendMulticastPush = async (fcmTokens, title, body, data = {}) => {
  const validTokens = fcmTokens.filter(Boolean);
  if (!validTokens.length) return null;

  const messaging = getMessaging();
  if (!messaging) return null;

  try {
    const stringData = {};
    for (const [k, v] of Object.entries(data)) stringData[k] = String(v);

    const result = await messaging.sendEachForMulticast({
      tokens: validTokens,
      notification: { title, body },
      data: stringData,
      android: { priority: 'high', notification: { sound: 'default' } },
      apns:    { payload: { aps: { sound: 'default', badge: 1 } } },
    });

    console.log(`🔔  FCM multicast: ${result.successCount} success, ${result.failureCount} failed`);
    return result;
  } catch (err) {
    console.error('❌  FCM multicast error:', err.message);
    return null;
  }
};

// ── Web Push (native browser push via VAPID) ──────────────────────────────────
let _webpushReady = false;

function initWebPush() {
  if (_webpushReady) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_EMAIL) {
    console.warn('⚠️  VAPID env vars not set — web push disabled');
    return false;
  }
  try {
    const webpush = require('web-push');
    webpush.setVapidDetails(env.VAPID_EMAIL, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    _webpushReady = true;
  } catch (err) {
    console.error('❌  web-push init failed:', err.message);
    return false;
  }
  return true;
}

/**
 * @param {string} subscriptionJson  - JSON string of PushSubscription object
 * @param {string} title
 * @param {string} body
 * @param {object} [data]
 */
const sendWebPush = async (subscriptionJson, title, body, data = {}) => {
  if (!subscriptionJson) return null;
  if (!initWebPush()) return null;

  try {
    const webpush      = require('web-push');
    const subscription = typeof subscriptionJson === 'string'
      ? JSON.parse(subscriptionJson)
      : subscriptionJson;

    const payload = JSON.stringify({ title, body, data });
    await webpush.sendNotification(subscription, payload);
    console.log(`🔔  Web push sent — ${title}`);
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired / unsubscribed
      console.warn('⚠️  Web push subscription expired');
      return { expired: true };
    }
    console.error('❌  Web push error:', err.statusCode || '', err.message);
    return null;
  }
};

module.exports = { sendPush, sendMulticastPush, sendWebPush };
