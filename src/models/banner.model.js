'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// Promotional banner shown across the app (home/sidebar/etc.), managed by admins.
const Banner = sequelize.define('Banner', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  title:     { type: DataTypes.STRING(150), allowNull: false },
  image_url: { type: DataTypes.STRING,       allowNull: false },
  link_url:  { type: DataTypes.STRING,       allowNull: true },

  // Free-form placement tag (e.g. "Home Top", "Sidebar", "Footer") — kept as
  // text rather than an enum so admins can introduce new placements freely.
  position: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'Home Top' },

  is_active:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  display_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

}, {
  tableName:  'banners',
  timestamps: true,
  underscored: true,
  paranoid:   true,
  indexes: [{ fields: ['is_active'] }, { fields: ['position'] }],
});

module.exports = Banner;
