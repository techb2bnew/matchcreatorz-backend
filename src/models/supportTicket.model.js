'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// A support conversation opened by a Buyer or Seller.
// The user can send the first message immediately (ticket is created OPEN);
// any admin sees it in the queue and can Accept/Assign it to themselves and
// move it through OPEN → IN_PROGRESS → RESOLVED → CLOSED.
const SupportTicket = sequelize.define('SupportTicket', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  // Buyer / Seller who opened the ticket
  user_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete:  'CASCADE',
  },

  subject: { type: DataTypes.STRING, allowNull: true },

  status: {
    type:         DataTypes.ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'),
    allowNull:    false,
    defaultValue: 'OPEN',
  },

  // Admin who picked up the ticket (null while unassigned / in the open queue)
  assigned_admin_id: {
    type:      DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete:  'SET NULL',
  },

  // Last message preview + sorting
  last_message:    { type: DataTypes.TEXT,    allowNull: true },
  last_message_at: { type: DataTypes.DATE,    allowNull: true },
  last_sender_id:  { type: DataTypes.INTEGER, allowNull: true },

  // Unread counters, one per side
  unread_user:  { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  unread_admin: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

}, {
  tableName:  'support_tickets',
  timestamps: true,
  paranoid:   false,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['status'] },
    { fields: ['assigned_admin_id'] },
    { fields: ['last_message_at'] },
  ],
});

module.exports = SupportTicket;
