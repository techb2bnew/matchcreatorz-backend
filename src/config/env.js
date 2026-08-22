'use strict';
// override:true so values in .env always win over any stale/empty vars
// left in the process environment (e.g. cached by pm2).
require('dotenv').config({ override: true });

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT:     parseInt(process.env.PORT, 10) || 5000,

  // PostgreSQL
  DB_HOST:     process.env.DB_HOST     || 'localhost',
  DB_PORT:     parseInt(process.env.DB_PORT, 10) || 5432,
  DB_NAME:     process.env.DB_NAME     || 'matchcreatorz',
  DB_USER:     process.env.DB_USER     || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_SSL:      process.env.DB_SSL === 'true',

  // Google OAuth (Sign in with Google)
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',

  // Apple OAuth (Sign in with Apple) — comma-separated list of accepted
  // token audiences (Services ID for web, Bundle ID(s) for iOS apps).
  APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID || '',

  // JWT
  JWT_SECRET:         process.env.JWT_SECRET         || 'change_this_secret_in_production',
  JWT_EXPIRES_IN:     process.env.JWT_EXPIRES_IN     || '7d',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'change_this_refresh_secret',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '30d',

  // Email (SMTP)
  SMTP_HOST:     process.env.SMTP_HOST     || 'smtp.gmail.com',
  SMTP_PORT:     parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_SECURE:   process.env.SMTP_SECURE === 'true',
  SMTP_USER:     process.env.SMTP_USER     || '',
  SMTP_PASS:     process.env.SMTP_PASS     || '',
  EMAIL_FROM:    process.env.EMAIL_FROM    || '"MatchCreatorz" <noreply@matchcreatorz.com>',

  // Twilio Verify (phone OTP)
  TWILIO_ACCOUNT_SID:        process.env.TWILIO_ACCOUNT_SID        || '',
  TWILIO_API_KEY_SID:        process.env.TWILIO_API_KEY_SID        || '',
  TWILIO_API_KEY_SECRET:     process.env.TWILIO_API_KEY_SECRET     || '',
  TWILIO_VERIFY_SERVICE_SID: process.env.TWILIO_VERIFY_SERVICE_SID || '',

  // AWS S3
  AWS_S3_ACCESS_KEY_ID:     process.env.AWS_S3_ACCESS_KEY_ID     || '',
  AWS_S3_SECRET_ACCESS_KEY: process.env.AWS_S3_SECRET_ACCESS_KEY || '',
  AWS_S3_REGION:            process.env.AWS_S3_REGION            || 'us-east-1',
  AWS_S3_BUCKET:            process.env.AWS_S3_BUCKET            || 'matchcreatorz',
  AWS_S3_BASE:              process.env.AWS_S3_BASE              || 'https://matchcreatorz.s3.us-east-1.amazonaws.com/',

  // App
  CLIENT_URL:  process.env.CLIENT_URL  || 'http://localhost:3000',
  OTP_EXPIRES_MIN: parseInt(process.env.OTP_EXPIRES_MIN, 10) || 10,

  // Firebase FCM — mobile push notifications
  FIREBASE_PROJECT_ID:   process.env.FIREBASE_PROJECT_ID   || '',
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL || '',
  FIREBASE_PRIVATE_KEY:  process.env.FIREBASE_PRIVATE_KEY  || '',

  // Web Push (VAPID) — browser push notifications
  VAPID_PUBLIC_KEY:  process.env.VAPID_PUBLIC_KEY  || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
  VAPID_EMAIL:       process.env.VAPID_EMAIL       || '',

  // Stripe (wallet top-ups via Checkout + Connect payouts to sellers)
  STRIPE_SECRET_KEY:      process.env.STRIPE_SECRET_KEY      || '',
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || '',
  STRIPE_WEBHOOK_SECRET:  process.env.STRIPE_WEBHOOK_SECRET  || '',

  // Wallet business rules
  PLATFORM_FEE_PERCENT: parseFloat(process.env.PLATFORM_FEE_PERCENT || '10'), // % taken by platform on completed bookings
  MIN_WITHDRAW:         parseFloat(process.env.MIN_WITHDRAW || '50'),         // minimum seller withdrawal
  WALLET_CURRENCY:      (process.env.WALLET_CURRENCY || 'usd').toLowerCase(),

  // Google Maps / Places (address lookup — not yet wired into any endpoint)
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || '',
};

// Validate critical vars in production
if (env.NODE_ENV === 'production') {
  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DB_PASSWORD', 'SMTP_USER', 'SMTP_PASS'];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }
}

module.exports = env;
