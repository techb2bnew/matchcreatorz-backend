'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

const Review = sequelize.define('Review', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  buyer_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  seller_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  service_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'services', key: 'id' },
  },
  booking_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'bookings', key: 'id' },
  },

  rating: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 5 },
  },
  comment: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('published', 'hidden'),
    allowNull: false,
    defaultValue: 'published',
  },
}, {
  tableName:  'reviews',
  paranoid:   true,
  timestamps: true,
  createdAt:  'created_at',
  updatedAt:  'updated_at',
  deletedAt:  'deleted_at',
});

module.exports = Review;
