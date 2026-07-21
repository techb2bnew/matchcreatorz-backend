'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

const Notification = sequelize.define('Notification', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  user_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },

  title:   { type: DataTypes.STRING(255), allowNull: false },
  body:    { type: DataTypes.TEXT,        allowNull: true  },
  type:    { type: DataTypes.STRING(100), allowNull: true  }, // e.g. 'bid_placed', 'booking_created'
  data:    { type: DataTypes.JSONB,       allowNull: true, defaultValue: {} },
  is_read: { type: DataTypes.BOOLEAN,     allowNull: false, defaultValue: false },

}, {
  tableName:  'notifications',
  timestamps: true,
  underscored: true,
  paranoid:   false,
});

module.exports = Notification;
