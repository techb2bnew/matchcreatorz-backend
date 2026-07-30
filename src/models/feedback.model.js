'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// Free-form feedback submitted from Settings → Send Feedback. Saved to the DB
// and also emailed to the platform admin.
const Feedback = sequelize.define('Feedback', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  user_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete:  'CASCADE',
  },

  role:    { type: DataTypes.STRING(20), allowNull: false },
  subject: { type: DataTypes.STRING(200), allowNull: true },
  message: { type: DataTypes.TEXT, allowNull: false },

}, {
  tableName:  'feedback',
  timestamps: true,
  underscored: true,
  paranoid:   false,
  indexes: [{ fields: ['user_id'] }],
});

module.exports = Feedback;
