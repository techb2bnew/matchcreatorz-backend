'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

const SellerProfile = sequelize.define('SellerProfile', {

  id: {
    type:          DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey:    true,
  },

  user_id: {
    type:       DataTypes.INTEGER,
    allowNull:  false,
    unique:     true,
    references: { model: 'users', key: 'id' },
    onDelete:   'CASCADE',
  },

  bio: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  skills: {
    type:         DataTypes.ARRAY(DataTypes.STRING),
    allowNull:    true,
    defaultValue: [],
  },

  hourly_rate: {
    type:         DataTypes.DECIMAL(10, 2),
    allowNull:    true,
    defaultValue: 0,
  },

  connects_balance: {
    type:         DataTypes.INTEGER,
    allowNull:    false,
    defaultValue: 0,
  },

  rating: {
    type:         DataTypes.DECIMAL(3, 2),
    allowNull:    true,
    defaultValue: 0.00,
  },

  total_reviews: {
    type:         DataTypes.INTEGER,
    defaultValue: 0,
  },

  address: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  profile_image: {
    type:      DataTypes.STRING(255),
    allowNull: true,
  },

  resume: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  portfolio_files: {
    type:         DataTypes.ARRAY(DataTypes.TEXT),  // S3 URLs of uploaded portfolio files
    allowNull:    true,
    defaultValue: [],
  },

  portfolio_links: {
    type:         DataTypes.ARRAY(DataTypes.TEXT),  // External portfolio URLs
    allowNull:    true,
    defaultValue: [],
  },

  is_available: {
    type:         DataTypes.BOOLEAN,
    defaultValue: true,
  },

  approval_status: {
    type:         DataTypes.ENUM('pending', 'approved', 'rejected'),
    allowNull:    false,
    defaultValue: 'pending',
  },

}, {
  tableName:  'seller_profiles',
  timestamps: true,
});

module.exports = SellerProfile;
