'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

const Job = sequelize.define('Job', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  buyer_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },

  title: {
    type:      DataTypes.STRING(200),
    allowNull: false,
  },

  description: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  category: {
    type:      DataTypes.STRING(100),
    allowNull: false,
    defaultValue: 'General',
  },

  job_type: {
    type:         DataTypes.ENUM('fixed', 'hourly'),
    allowNull:    false,
    defaultValue: 'fixed',
  },

  budget_min: {
    type:      DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },

  budget_max: {
    type:      DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },

  deadline: {
    type:      DataTypes.DATEONLY,
    allowNull: true,
  },

  skills: {
    type:      DataTypes.JSON,
    allowNull: true,
    defaultValue: [],
  },

  // Attached documents: array of { url, name }
  attachments: {
    type:         DataTypes.JSONB,
    allowNull:    true,
    defaultValue: [],
  },

  experience_level: {
    type:         DataTypes.ENUM('any', 'beginner', 'intermediate', 'expert'),
    allowNull:    false,
    defaultValue: 'any',
  },

  status: {
    type:         DataTypes.ENUM('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED'),
    allowNull:    false,
    defaultValue: 'OPEN',
  },

  bids_count: {
    type:         DataTypes.INTEGER,
    allowNull:    false,
    defaultValue: 0,
  },

}, {
  tableName:  'jobs',
  timestamps: true,
  paranoid:   true,
});

module.exports = Job;
