'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

const Booking = sequelize.define('Booking', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  buyer_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },

  seller_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },

  // Either service_id OR job_id (whichever triggered the booking)
  service_id: {
    type:      DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'services', key: 'id' },
  },

  job_id: {
    type:      DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'jobs', key: 'id' },
  },

  title: {
    type:      DataTypes.STRING(200),
    allowNull: false,
  },

  amount: {
    type:      DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },

  platform_fee: {
    type:         DataTypes.DECIMAL(10, 2),
    allowNull:    false,
    defaultValue: 0,
  },

  status: {
    type:         DataTypes.ENUM('pending', 'ongoing', 'amidst_completion', 'completed', 'cancelled', 'in_dispute'),
    allowNull:    false,
    defaultValue: 'pending',
  },

  notes: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  cancel_reason: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  dispute_reason: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  delivery_days: {
    type:      DataTypes.INTEGER,
    allowNull: true,
  },

}, {
  tableName:  'bookings',
  timestamps: true,
  paranoid:   true,
});

module.exports = Booking;
