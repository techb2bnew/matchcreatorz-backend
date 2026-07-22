'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

const User = sequelize.define('User', {

  id: {
    type:          DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey:    true,
  },

  name: {
    type:      DataTypes.STRING(100),
    allowNull: false,
  },

  email: {
    type:      DataTypes.STRING(150),
    allowNull: false,
    unique:    true,
    validate:  { isEmail: true },
  },

  password: {
    type:      DataTypes.STRING(255),
    allowNull: false,
  },

  phone: {
    type:      DataTypes.STRING(20),
    allowNull: true,
  },

  role: {
    type:         DataTypes.ENUM('ADMIN', 'SELLER', 'BUYER'),
    allowNull:    false,
    defaultValue: 'BUYER',
  },

  status: {
    type:         DataTypes.ENUM('active', 'inactive', 'banned'),
    allowNull:    false,
    defaultValue: 'active',
  },

  is_verified: {
    type:         DataTypes.BOOLEAN,
    defaultValue: false,
  },

  // Email OTP
  otp: {
    type:      DataTypes.STRING(6),
    allowNull: true,
  },

  otp_expiry: {
    type:      DataTypes.DATE,
    allowNull: true,
  },

  // Phone OTP (separate from email OTP)
  phone_otp: {
    type:      DataTypes.STRING(6),
    allowNull: true,
  },

  phone_otp_expiry: {
    type:      DataTypes.DATE,
    allowNull: true,
  },

  is_phone_verified: {
    type:         DataTypes.BOOLEAN,
    defaultValue: false,
  },

  // Profile fields
  bio: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  location: {
    type:      DataTypes.STRING(150),
    allowNull: true,
  },

  avatar: {
    type:      DataTypes.STRING(500),
    allowNull: true,
  },

  reset_token: {
    type:      DataTypes.STRING(255),
    allowNull: true,
  },

  reset_token_expiry: {
    type:      DataTypes.DATE,
    allowNull: true,
  },

  // FCM tokens for push notifications
  web_fcm_token: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  mobile_fcm_token: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  // Per-user settings (notification prefs, privacy toggles, payout prefs)
  preferences: {
    type:         DataTypes.JSONB,
    allowNull:    true,
    defaultValue: {},
  },

}, {
  tableName:  'users',
  timestamps: true,
  paranoid:   true,   // soft delete — adds deleted_at column
});

module.exports = User;
