'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

const Booking = sequelize.define('Booking', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  buyer_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },

  seller_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },

  // Either service_id OR job_id (whichever triggered the booking)
  service_id: {
    type:      DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'services', key: 'id' },
  },

  job_id: {
    type:      DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'jobs', key: 'id' },
  },

  title: {
    type:      DataTypes.STRING(200),
    allowNull: false,
  },

  amount: {
    type:      DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },

  platform_fee: {
    type:         DataTypes.DECIMAL(10, 2),
    allowNull:    false,
    defaultValue: 0,
  },

  // Denormalized copy of the originating job's type (services are always 'fixed').
  // Drives hourly-billing behavior: for 'hourly' bookings, `amount` holds the
  // agreed $/hr rate until the seller submits work with `hours_worked`, at
  // which point `amount` is overwritten with the computed total (hours * rate).
  job_type: {
    type:         DataTypes.STRING(20),
    allowNull:    false,
    defaultValue: 'fixed',
  },

  // Hours the seller logged at submission time (hourly bookings only).
  // Null until submitted; once set, `amount` is the computed total, not the rate.
  hours_worked: {
    type:      DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },

  status: {
    type:         DataTypes.ENUM('pending', 'ongoing', 'amidst_completion', 'completed', 'cancelled', 'in_dispute'),
    allowNull:    false,
    defaultValue: 'pending',
  },

  // Escrow lifecycle for the wallet:
  //   unpaid   → buyer wallet not yet charged
  //   held     → amount debited from buyer & held in escrow
  //   released → paid out to seller wallet (on completion)
  //   refunded → returned to buyer (on cancel / dispute refund)
  payment_status: {
    type:         DataTypes.ENUM('unpaid', 'held', 'released', 'refunded'),
    allowNull:    false,
    defaultValue: 'unpaid',
  },

  notes: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  cancel_reason: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  dispute_reason: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

  delivery_days: {
    type:      DataTypes.INTEGER,
    allowNull: true,
  },

  // Proof-of-work files the seller attaches when submitting (whole-booking
  // flow, i.e. no milestones). Array of { url, name, type, size }.
  attachments: {
    type:         DataTypes.JSONB,
    allowNull:    false,
    defaultValue: [],
  },

  // Seller's message describing the delivered work (kept separate from
  // `notes`, which is the buyer's note left when the booking was created).
  submission_notes: {
    type:      DataTypes.TEXT,
    allowNull: true,
  },

}, {
  tableName:  'bookings',
  timestamps: true,
  paranoid:   true,
});

module.exports = Booking;
