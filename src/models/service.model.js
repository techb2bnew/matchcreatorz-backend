'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

const Service = sequelize.define('Service', {

  id: {
    type:          DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey:    true,
  },

  seller_id: {
    type:       DataTypes.INTEGER,
    allowNull:  false,
    references: { model: 'users', key: 'id' },
    onDelete:   'CASCADE',
  },

  category_id: {
    type:       DataTypes.INTEGER,
    allowNull:  true,
    references: { model: 'categories', key: 'id' },
    onDelete:   'SET NULL',
  },

  title: {
    type:      DataTypes.STRING(200),
    allowNull: false,
  },

  description: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  price: {
    type:         DataTypes.DECIMAL(10, 2),
    allowNull:    false,
    defaultValue: 0,
  },

  delivery_days: {
    type:         DataTypes.INTEGER,
    allowNull:    false,
    defaultValue: 1,
  },

  revisions: {
    type:         DataTypes.INTEGER,
    allowNull:    false,
    defaultValue: 1,
  },

  images: {
    type:         DataTypes.JSONB,      // array of S3 URLs
    allowNull:    true,
    defaultValue: [],
  },

  tags: {
    type:         DataTypes.JSONB,      // array of strings
    allowNull:    true,
    defaultValue: [],
  },

  category_ids: {
    type:         DataTypes.JSONB,      // array of category ids (multi-select)
    allowNull:    true,
    defaultValue: [],
  },

  // active = live, paused = seller hid it, rejected = admin blocked it
  status: {
    type:         DataTypes.ENUM('active', 'paused', 'rejected'),
    allowNull:    false,
    defaultValue: 'active',
  },

  is_featured: {
    type:         DataTypes.BOOLEAN,
    defaultValue: false,
  },

  views_count: {
    type:         DataTypes.INTEGER,
    defaultValue: 0,
  },

  orders_count: {
    type:         DataTypes.INTEGER,
    defaultValue: 0,
  },

  rating: {
    type:         DataTypes.DECIMAL(3, 2),
    defaultValue: 0.00,
  },

  reviews_count: {
    type:         DataTypes.INTEGER,
    defaultValue: 0,
  },

}, {
  tableName:   'services',
  timestamps:  true,
  underscored: true,
});

module.exports = Service;
