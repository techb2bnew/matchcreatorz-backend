'use strict';
const twilio = require('twilio');
const env    = require('../config/env');

let client = null;

const getClient = () => {
  if (!client && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  }
  return client;
};

/**
 * Send an SMS OTP to a phone number.
 * @param {string} to   - E.164 format e.g. +919876543210
 * @param {string} otp  - 6-digit OTP
 */
const sendSmsOtp = async (to, otp) => {
  const c = getClient();
  if (!c) {
    console.warn('⚠️  Twilio not configured — skipping SMS OTP');
    return;
  }

  await c.messages.create({
    body: `Your MatchCreatorz verification code is: ${otp}. Valid for ${env.OTP_EXPIRES_MIN} minutes. Do not share it.`,
    from: env.TWILIO_PHONE_NUMBER,
    to,
  });

  console.log(`📱  SMS OTP sent to ${to}`);
};

module.exports = { sendSmsOtp };
