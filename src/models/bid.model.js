'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

const Bid = sequelize.define('Bid', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  job_id: {
    type:       DataTypes.INTEGER,
    allowNull:  false,
    references: { model: 'jobs', key: 'id' },
  },

  seller_id: {
    type:       DataTypes.INTEGER,
    allowNull:  false,
    references: { model: 'users', key: 'id' },
  },

  amount: {
    type:      DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },

  delivery_days: {
    type:      DataTypes.INTEGER,
    allowNull: false,
  },

  proposal: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  // Portfolio / work samples the seller attaches to back up their proposal.
  // Array of { url, name, type, size } — same shape as booking attachments.
  attachments: {
    type:         DataTypes.JSONB,
    allowNull:    false,
    defaultValue: [],
  },

  // Seller's answers to the buyer's Job.questions, snapshotted as
  // { question, answer } pairs — self-contained so this stays accurate even
  // if the buyer later edits or removes a question on the job.
  question_answers: {
    type:         DataTypes.JSONB,
    allowNull:    false,
    defaultValue: [],
  },

  status: {
    type:         DataTypes.ENUM('pending', 'countered', 'accepted', 'rejected'),
    allowNull:    false,
    defaultValue: 'pending',
  },

  // ── Counter-offer / negotiation ──────────────────────────────
  // The latest counter on the table. If counter_amount is set, the
  // "current" terms are these values; otherwise the original amount/delivery.
  counter_amount: {
    type:      DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },

  counter_delivery_days: {
    type:      DataTypes.INTEGER,
    allowNull: true,
  },

  // who made the last counter — the OTHER party must respond
  counter_by: {
    type:      DataTypes.ENUM('buyer', 'seller'),
    allowNull: true,
  },

  counter_note: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

}, {
  tableName:  'bids',
  timestamps: true,
  paranoid:   true,
});

module.exports = Bid;
