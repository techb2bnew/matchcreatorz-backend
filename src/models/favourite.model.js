'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// Buyer's saved / favourited services
const Favourite = sequelize.define('Favourite', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  user_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete:  'CASCADE',
  },

  service_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'services', key: 'id' },
    onDelete:  'CASCADE',
  },

}, {
  tableName:  'favourites',
  timestamps: true,
  underscored: true,
  paranoid:   false,
  indexes: [
    { unique: true, fields: ['user_id', 'service_id'] },
  ],
});

module.exports = Favourite;
