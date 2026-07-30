'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// Static marketing/legal page content (About, Privacy, Terms, FAQ, Contact),
// editable by admins. Fixed set of slugs — no create/delete from the UI.
const Page = sequelize.define('Page', {

  id:      { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  slug:    { type: DataTypes.STRING(50), allowNull: false, unique: true },
  title:   { type: DataTypes.STRING(150), allowNull: false },
  content: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },

}, {
  tableName:  'pages',
  timestamps: true,
  underscored: true,
  paranoid:   false,
});

module.exports = Page;
