'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// One-to-one conversation between two users.
// user_one_id / user_two_id are stored NORMALISED (smaller id first) so a given
// pair of users always maps to exactly one conversation row.
const Conversation = sequelize.define('Conversation', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  user_one_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete:  'CASCADE',
  },

  user_two_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete:  'CASCADE',
  },

  // Last message preview + sorting
  last_message:    { type: DataTypes.TEXT,    allowNull: true },
  last_message_at: { type: DataTypes.DATE,    allowNull: true },
  last_sender_id:  { type: DataTypes.INTEGER, allowNull: true },

  // Unread counters, one per participant slot
  unread_one: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  unread_two: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

  // Soft-archive per participant (optional): hide conversation without deleting
  archived_one: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  archived_two: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

}, {
  tableName: 'conversations',
  timestamps: true,
  paranoid:  false,
  indexes: [
    { unique: true, fields: ['user_one_id', 'user_two_id'] },
    { fields: ['last_message_at'] },
  ],
});

module.exports = Conversation;
