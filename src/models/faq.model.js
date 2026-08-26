'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// FAQ is a list of question/answer pairs (not a single content blob like the
// other static pages) — admin manages this as its own resource, ordered by
// `position` for display order.
const Faq = sequelize.define('Faq', {

  id:       { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  question: { type: DataTypes.TEXT, allowNull: false },
  answer:   { type: DataTypes.TEXT, allowNull: false },
  position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

}, {
  tableName:  'faqs',
  timestamps: true,
  underscored: true,
  paranoid:   false,
});

module.exports = Faq;
