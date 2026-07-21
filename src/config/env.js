'use strict';
require('dotenv').config();

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

  // Twilio SMS
  TWILIO_ACCOUNT_SID:  process.env.TWILIO_ACCOUNT_SID  || '',
  TWILIO_AUTH_TOKEN:   process.env.TWILIO_AUTH_TOKEN    || '',
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER  || '',

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
