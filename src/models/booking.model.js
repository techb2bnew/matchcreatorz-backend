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
  job_type: {
    type:         DataTypes.STRING(20),
    allowNull:    false,
    defaultValue: 'fixed',
  },

  // Agreed $/hr rate for hourly bookings — set once at booking creation
  // (buyer/job.controller.js:acceptBid, seller/job.controller.js:acceptCounterBySeller)
  // and never trusted from a request afterwards. Each BookingWorkEntry
  // snapshots this at submit time.
  hourly_rate: {
    type:      DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },

  // Optional cap on hours a seller may log per calendar week on this contract.
  // Null = no limit. Enforced server-side in submitWorkEntry — see that
  // function for the concurrency-safe (row-locked) check.
  weekly_hour_limit: {
    type:      DataTypes.DECIMAL(6, 2),
    allowNull: true,
  },

  // For hourly bookings, `amount`/`hours_worked` are maintained AGGREGATES of
  // that booking's *approved* BookingWorkEntry rows (recomputed transactionally
  // by services/shared/workEntry.service.js:settleWorkEntry on every approval)
  // — not a single submitted value. This keeps every existing summary view
  // (formatBookingAmount, admin bookings/wallet pages) working unmodified,
  // now showing "paid so far" rather than "pending review total."
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

  // Snapshotted once at Booking.create() from the Admin escrow toggle at that
  // moment — never changed afterward, so flipping the toggle mid-flight never
  // affects an existing booking. 'wallet' = today's deferred wallet-debit flow
  // (unchanged). 'escrow' = real Stripe hold/charge (see services/shared/escrow.service.js).
  payment_mode: {
    type:         DataTypes.ENUM('wallet', 'escrow'),
    allowNull:    false,
    defaultValue: 'wallet',
  },

  // Stripe PaymentIntent backing the whole-booking manual-capture hold
  // (escrow mode, non-milestone bookings only).
  escrow_payment_intent_id: {
    type:      DataTypes.STRING,
    allowNull: true,
  },

  escrow_captured_at: {
    type:      DataTypes.DATE,
    allowNull: true,
  },

  // Set once the 5-day "hold expiring soon" reminder has fired, so the
  // periodic sweep in server.js never re-notifies for the same booking.
  escrow_reminder_sent_at: {
    type:      DataTypes.DATE,
    allowNull: true,
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
