'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

const Message = sequelize.define('Message', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  conversation_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'conversations', key: 'id' },
    onDelete:  'CASCADE',
  },

  sender_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete:  'CASCADE',
  },

  body: {
    type:      DataTypes.TEXT,
    allowNull: false,
  },

  // Optional attachment (S3 url + name), for future file messages
  attachment: {
    type:         DataTypes.JSONB,
    allowNull:    true,
    defaultValue: null,
  },

  is_read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  read_at: { type: DataTypes.DATE,    allowNull: true },

}, {
  tableName: 'messages',
  timestamps: true,
  paranoid:  false,
  indexes: [
    { fields: ['conversation_id', 'created_at'] },
    { fields: ['sender_id'] },
  ],
});

module.exports = Message;
