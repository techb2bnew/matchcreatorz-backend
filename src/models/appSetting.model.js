'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// Simple key/value store for platform-wide admin settings
// (platform fees, connect plans, app info, etc.). One row per key.
const AppSetting = sequelize.define('AppSetting', {

  id:  { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  key: { type: DataTypes.STRING(100), allowNull: false, unique: true },

  value: { type: DataTypes.JSONB, allowNull: true, defaultValue: {} },

}, {
  tableName:   'app_settings',
  timestamps:  true,
  underscored: true,
  paranoid:    false,
});

module.exports = AppSetting;
