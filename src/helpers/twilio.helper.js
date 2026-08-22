'use strict';
const env = require('../config/env');

// ── Lazy-init Twilio client (API Key auth) ─────────────────────────────
let _client = null;

function getClient() {
  if (_client) return _client;
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_API_KEY_SID || !env.TWILIO_API_KEY_SECRET) {
    console.warn('⚠️  Twilio env vars not set — phone OTP disabled');
    return null;
  }
  const twilio = require('twilio');
  _client = twilio(env.TWILIO_API_KEY_SID, env.TWILIO_API_KEY_SECRET, {
    accountSid: env.TWILIO_ACCOUNT_SID,
  });
  return _client;
}

/**
 * Send an OTP via Twilio Verify to `phoneE164` (e.g. "+919876543210").
 * Twilio manages the OTP code and its expiry itself — nothing to store here.
 */
const sendPhoneOtp = async (phoneE164) => {
  const client = getClient();
  if (!client) throw { statusCode: 500, message: 'Phone verification is not configured on the server' };
  if (!env.TWILIO_VERIFY_SERVICE_SID)
    throw { statusCode: 500, message: 'Phone verification is not configured on the server' };

  try {
    await client.verify.v2
      .services(env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: phoneE164, channel: 'sms' });
  } catch (err) {
    console.error('❌  Twilio send OTP error:', err.message);
    throw { statusCode: 400, message: 'Could not send OTP — check the phone number and try again' };
  }
};

/**
 * Check an OTP via Twilio Verify. Returns true if approved, false otherwise
 * (wrong code) — throws only on a genuine Twilio/network failure.
 */
const checkPhoneOtp = async (phoneE164, code) => {
  const client = getClient();
  if (!client) throw { statusCode: 500, message: 'Phone verification is not configured on the server' };

  try {
    const check = await client.verify.v2
      .services(env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phoneE164, code });
    return check.status === 'approved';
  } catch (err) {
    // Twilio throws (rather than returning pending/denied) for some invalid
    // states, e.g. an expired or already-checked verification — treat those
    // as "not approved" instead of a hard 500.
    console.warn('⚠️  Twilio check OTP:', err.message);
    return false;
  }
};

module.exports = { sendPhoneOtp, checkPhoneOtp };
