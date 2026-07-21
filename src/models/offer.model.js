'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// Custom offer sent by a seller to a buyer. On accept it spawns a Booking.
const Offer = sequelize.define('Offer', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  seller_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete:  'CASCADE',
  },

  buyer_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete:  'CASCADE',
  },

  service_id: {
    type:      DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'services', key: 'id' },
    onDelete:  'SET NULL',
  },

  title:         { type: DataTypes.STRING(200), allowNull: false },
  description:   { type: DataTypes.TEXT,        allowNull: true  },
  amount:        { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  delivery_days: { type: DataTypes.INTEGER,     allowNull: true  },

  status: {
    type:         DataTypes.ENUM('pending', 'accepted', 'declined', 'expired'),
    allowNull:    false,
    defaultValue: 'pending',
  },

  // set when accepted → the booking it created
  booking_id: {
    type:      DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'bookings', key: 'id' },
    onDelete:  'SET NULL',
  },

  expires_at: { type: DataTypes.DATE, allowNull: true },

}, {
  tableName:  'offers',
  timestamps: true,
  underscored: true,
  paranoid:   true,
});

module.exports = Offer;
