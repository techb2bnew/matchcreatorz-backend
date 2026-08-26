'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// Emails collected from the public "Join Our Newsletter" form on the
// marketing site — no user account required to subscribe.
const NewsletterSubscriber = sequelize.define('NewsletterSubscriber', {

  id:    { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  email: { type: DataTypes.STRING(255), allowNull: false, unique: true },

}, {
  tableName:  'newsletter_subscribers',
  timestamps: true,
  underscored: true,
  paranoid:   false,
});

module.exports = NewsletterSubscriber;
