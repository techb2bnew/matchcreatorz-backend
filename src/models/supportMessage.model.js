'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// A single message inside a support ticket. Mirrors the chat Message model but
// is intentionally kept separate so the support queue/assignment flow never
// touches the peer-to-peer chat tables.
const SupportMessage = sequelize.define('SupportMessage', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  ticket_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'support_tickets', key: 'id' },
    onDelete:  'CASCADE',
  },

  sender_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete:  'CASCADE',
  },

  // 'USER' (buyer/seller) or 'ADMIN' — lets the UI style bubbles without a join
  sender_role: { type: DataTypes.STRING, allowNull: true },

  body:       { type: DataTypes.TEXT,  allowNull: true },   // may be '' for attachment-only
  attachment: { type: DataTypes.JSONB, allowNull: true },   // { url, name, type, size }

  is_read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  read_at: { type: DataTypes.DATE,    allowNull: true },

}, {
  tableName:  'support_messages',
  timestamps: true,
  paranoid:   false,
  indexes: [
    { fields: ['ticket_id', 'created_at'] },
    { fields: ['sender_id'] },
  ],
});

module.exports = SupportMessage;
