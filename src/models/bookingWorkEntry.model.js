'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// One row per day of hourly work a seller logs against an hourly Booking.
// Unlike the old single `Booking.hours_worked` value (overwritten on every
// resubmission), this is a real, append-only history — see
// services/seller/booking.service.js:submitWorkEntry.
const BookingWorkEntry = sequelize.define('BookingWorkEntry', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  booking_id: {
    type:       DataTypes.INTEGER,
    allowNull:  false,
    references: { model: 'bookings', key: 'id' },
    onDelete:   'CASCADE',
  },

  work_date:   { type: DataTypes.DATEONLY, allowNull: false },
  description: { type: DataTypes.TEXT,     allowNull: true },
  hours:       { type: DataTypes.DECIMAL(6, 2), allowNull: false },

  // Snapshot of Booking.hourly_rate at submit time — the rate is never
  // re-derived from a request, so a later contract-rate change can't alter
  // the value of an already-submitted entry.
  rate:          { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  amount:        { type: DataTypes.DECIMAL(10, 2), allowNull: false }, // round2(hours*rate) at submit time
  platform_fee:  { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },

  status: {
    type:         DataTypes.ENUM('pending', 'countered', 'approved', 'disputed', 'rejected'),
    allowNull:    false,
    defaultValue: 'pending',
  },

  // Mirrors BookingMilestone's payment_status — settled only once, via
  // services/shared/workEntry.service.js:settleWorkEntry.
  payment_status: {
    type:         DataTypes.ENUM('unpaid', 'released'),
    allowNull:    false,
    defaultValue: 'unpaid',
  },

  // Counter-offer — buyer proposes fewer hours than the seller logged.
  counter_hours: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
  counter_by:    { type: DataTypes.ENUM('buyer', 'seller'), allowNull: true },
  counter_note:  { type: DataTypes.TEXT, allowNull: true },

  dispute_reason: { type: DataTypes.TEXT, allowNull: true },

  // Proof-of-work for this entry — array of { url, name, type, size }.
  attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

  submitted_at: { type: DataTypes.DATE, allowNull: true },
  approved_at:  { type: DataTypes.DATE, allowNull: true },

}, {
  tableName:   'booking_work_entries',
  timestamps:  true,
  underscored: true,
  paranoid:    false,
  indexes: [
    { fields: ['booking_id'] },
    { fields: ['booking_id', 'work_date'] },
  ],
});

module.exports = BookingWorkEntry;
