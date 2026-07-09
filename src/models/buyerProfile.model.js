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

  city: {
    type:      DataTypes.STRING(100),
    allowNull: true,
  },

  country: {
    type:      DataTypes.STRING(100),
    allowNull: true,
  },

  profile_image: {
    type:      DataTypes.STRING(255),
    allowNull: true,
  },

}, {
  tableName:  'buyer_profiles',
  timestamps: true,
});

module.exports = BuyerProfile;
