'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

const Bid = sequelize.define('Bid', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  job_id: {
    type:       DataTypes.INTEGER,
    allowNull:  false,
    references: { model: 'jobs', key: 'id' },
  },

  seller_id: {
    type:       DataTypes.INTEGER,
    allowNull:  false,
    references: { model: 'users', key: 'id' },
  },

  amount: {
    type:      DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },

  delivery_days: {
    type:      DataTypes.INTEGER,
    allowNull: false,
  },

  proposal: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  status: {
    type:         DataTypes.ENUM('pending', 'accepted', 'rejected'),
    allowNull:    false,
    defaultValue: 'pending',
  },

}, {
  tableName:  'bids',
  timestamps: true,
  paranoid:   true,
});

module.exports = Bid;
