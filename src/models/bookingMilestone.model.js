'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// Optional per-booking milestones — a seller can split a booking's total
// amount into stages, submit proof-of-work per stage, and get paid out
// (from the already-held escrow) as each stage is individually accepted.
const BookingMilestone = sequelize.define('BookingMilestone', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  booking_id: {
    type:       DataTypes.INTEGER,
    allowNull:  false,
    references: { model: 'bookings', key: 'id' },
    onDelete:   'CASCADE',
  },

  title: { type: DataTypes.STRING(200), allowNull: false },

  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },

  // Display order — the sequence the seller defined the stages in.
  position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

  // How many days this stage is expected to take (optional, seller-set).
  duration_days: { type: DataTypes.INTEGER, allowNull: true },

  status: {
    type:         DataTypes.ENUM('pending', 'submitted', 'countered', 'approved', 'rejected'),
    allowNull:    false,
    defaultValue: 'pending',
  },

  // Bidirectional negotiation on the submitted amount — mirrors
  // BookingWorkEntry's counter_hours/counter_by/counter_note pattern.
  // Whichever party did NOT set the last counter can approve at
  // `counter_amount` or overwrite it with a counter of their own.
  counter_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  counter_by:     { type: DataTypes.ENUM('buyer', 'seller'), allowNull: true },
  counter_note:   { type: DataTypes.TEXT, allowNull: true },

  // Charged from the buyer's wallet only once this stage is submitted
  // (deferred payment — see seller/booking.service.js submitMilestone).
  payment_status: {
    type:         DataTypes.ENUM('unpaid', 'held', 'released'),
    allowNull:    false,
    defaultValue: 'unpaid',
  },

  // Proof-of-work for this stage — array of { url, name, type, size }.
  attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

  // Stripe PaymentIntent for THIS milestone's own charge (escrow mode only —
  // inherits payment_mode from the parent Booking). Created lazily at the
  // moment this milestone is accepted/paid, mirroring the wallet-mode timing.
  escrow_payment_intent_id: { type: DataTypes.STRING, allowNull: true },

  notes:           { type: DataTypes.TEXT, allowNull: true }, // seller's submission note
  dispute_reason:  { type: DataTypes.TEXT, allowNull: true }, // buyer's rejection reason

  submitted_at: { type: DataTypes.DATE, allowNull: true },
  approved_at:  { type: DataTypes.DATE, allowNull: true },

}, {
  tableName:  'booking_milestones',
  timestamps: true,
  underscored: true,
  paranoid:   false,
  indexes: [{ fields: ['booking_id'] }],
});

module.exports = BookingMilestone;
