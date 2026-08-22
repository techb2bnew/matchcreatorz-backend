'use strict';
const { DataTypes, Op } = require('sequelize');
const sequelize          = require('../config/db');

// Immutable ledger of every wallet movement. `amount` is positive for credits
// and negative for debits; `balance_after` snapshots the running balance.
const WalletTransaction = sequelize.define('WalletTransaction', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  user_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete:  'CASCADE',
  },

  amount:        { type: DataTypes.DECIMAL(12, 2), allowNull: false }, // + credit / - debit
  balance_after: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  currency:      { type: DataTypes.STRING(3),      allowNull: false, defaultValue: 'usd' },

  type: {
    type: DataTypes.ENUM(
      'topup',              // buyer added funds (Stripe)
      'booking_payment',    // buyer paid a booking (escrow held) — debit
      'booking_refund',     // booking cancelled/refunded — credit
      'earning',            // seller earned from a completed booking — credit
      'platform_fee',       // platform commission — recorded on admin wallet
      'withdrawal',         // seller withdrawal — debit
      'withdrawal_reversal',// rejected/failed withdrawal returned — credit
      'adjustment',         // manual admin adjustment
      'milestone_release'   // informational only (amount 0) — buyer-side receipt of an
                             // escrow release, so their ledger shows where the held
                             // money went, milestone by milestone
    ),
    allowNull: false,
  },

  status: {
    type:         DataTypes.ENUM('pending', 'completed', 'failed'),
    allowNull:    false,
    defaultValue: 'completed',
  },

  note:            { type: DataTypes.STRING(255), allowNull: true },
  booking_id:      { type: DataTypes.INTEGER,     allowNull: true },
  withdrawal_id:   { type: DataTypes.INTEGER,     allowNull: true },
  stripe_ref:      { type: DataTypes.STRING,      allowNull: true }, // session/transfer/payout id

  // Set only for the entries this row settles a BookingWorkEntry payment for.
  // Paired with the partial unique index below, this is the DB-level guard
  // against double-crediting the same work entry (double-click, retry, race)
  // — see services/shared/workEntry.service.js:settleWorkEntry.
  work_entry_id:   { type: DataTypes.INTEGER,     allowNull: true },

  // Same idempotency guard as work_entry_id, for BookingMilestone settlements
  // — see services/shared/milestone.service.js:settleMilestone.
  milestone_id:    { type: DataTypes.INTEGER,     allowNull: true },

}, {
  tableName:  'wallet_transactions',
  timestamps: true,
  underscored: true,
  paranoid:   false,
  indexes: [
    { fields: ['user_id', 'created_at'] },
    { fields: ['type'] },
    { fields: ['booking_id'] },
    // Partial (WHERE work_entry_id IS NOT NULL) so it doesn't apply to the
    // large volume of existing rows with a null work_entry_id — one entry
    // approval creates at most one row of each `type` (booking_payment,
    // earning, platform_fee), so (work_entry_id, type) is the idempotency key.
    {
      unique: true,
      fields: ['work_entry_id', 'type'],
      where:  { work_entry_id: { [Op.ne]: null } },
    },
    {
      unique: true,
      fields: ['milestone_id', 'type'],
      where:  { milestone_id: { [Op.ne]: null } },
    },
  ],
});

module.exports = WalletTransaction;
