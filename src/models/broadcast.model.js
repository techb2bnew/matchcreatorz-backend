'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// A one-way announcement admin sends to a group of users (all / sellers / buyers).
// Delivery is fanned out into per-user Notification rows + push — this row is
// just the compose record (audience + how many it reached) for the admin's history.
const Broadcast = sequelize.define('Broadcast', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  admin_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },

  title: { type: DataTypes.STRING(255), allowNull: false },
  body:  { type: DataTypes.TEXT,        allowNull: false },

  audience: {
    type:         DataTypes.ENUM('ALL', 'SELLER', 'BUYER'),
    allowNull:    false,
    defaultValue: 'ALL',
  },

  recipient_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

}, {
  tableName:  'broadcasts',
  timestamps: true,
});

module.exports = Broadcast;
