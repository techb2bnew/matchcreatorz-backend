'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

const BuyerProfile = sequelize.define('BuyerProfile', {

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

  company_name: {
    type:      DataTypes.STRING(150),
    allowNull: true,
  },

  address: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  profile_image: {
    type:      DataTypes.STRING(255),
    allowNull: true,
  },

  // Default 'approved' protects existing rows when this column is added via
  // migration/alter — new signups explicitly pass 'pending' at creation time.
  approval_status: {
    type:         DataTypes.ENUM('pending', 'approved', 'rejected'),
    allowNull:    false,
    defaultValue: 'approved',
  },

}, {
  tableName:  'buyer_profiles',
  timestamps: true,
});

module.exports = BuyerProfile;
