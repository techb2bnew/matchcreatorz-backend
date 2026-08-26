'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

const Category = sequelize.define('Category', {

  id: {
    type:          DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey:    true,
  },

  name: {
    type:      DataTypes.STRING(100),
    allowNull: false,
    unique:    true,
  },

  icon: {
    type:      DataTypes.TEXT,   // TEXT avoids any VARCHAR length constraint
    allowNull: true,
  },

  description: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  services_count: {
    type:         DataTypes.INTEGER,
    defaultValue: 0,
  },

  sellers_count: {
    type:         DataTypes.INTEGER,
    defaultValue: 0,
  },

  // Self-referencing — a subcategory is just a Category row with a parent.
  // Null = top-level category. See models/index.js for the hasMany/belongsTo
  // self-association (as: 'subcategories' / as: 'parent').
  parent_id: {
    type:       DataTypes.INTEGER,
    allowNull:  true,
    references: { model: 'categories', key: 'id' },
    onDelete:   'CASCADE',
  },

}, {
  tableName:   'categories',
  timestamps:  true,
  underscored: true,   // created_at / updated_at
});

module.exports = Category;
