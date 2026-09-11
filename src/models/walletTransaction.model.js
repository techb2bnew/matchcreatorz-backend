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
      'milestone_release',  // unused (kept for backward compatibility) — superseded by 'escrow_payment' below
      'escrow_hold',        // informational only (amount 0) — buyer-side receipt that a
                             // Stripe hold was PLACED (card authorized, nothing captured
                             // yet) for a 'hold'-type escrow payment. Gives the buyer
                             // immediate visibility the moment they pay Stripe, without
                             // waiting for the later Accept/Release click that actually
                             // captures + settles it (see 'escrow_payment' below).
      'escrow_payment'      // informational only (amount 0) — buyer-side receipt of a
                             // booking/milestone/work-entry paid directly via Stripe
                             // (escrow mode), which never touches the wallet balance.
                             // Without this row the buyer's transaction history would
                             // show no trace of a real payment they actually made.
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

  // Fee transparency — populated wherever known, for the "show fees on every
  // transaction" breakdown in both the buyer and seller wallet UIs.
  // `gross_amount` is what the buyer actually paid for this specific
  // settlement (before any fee is taken out); `platform_fee` is our own cut
  // (see config/fee.js); `stripe_fee` is Stripe's own processing fee, fetched
  // from the charge's balance transaction — only ever set for a payment that
  // was actually charged via Stripe (escrow mode direct/hold, or a wallet
  // top-up), never for money that came out of an existing wallet balance.
  gross_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
  platform_fee: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
  stripe_fee:   { type: DataTypes.DECIMAL(12, 2), allowNull: true },

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
    // approval creates at most one row of each `type` per user (booking_payment,
    // earning, platform_fee are each single-user anyway; 'escrow_hold' is
    // credited to BOTH buyer and seller, hence user_id is part of the key) —
    // so (work_entry_id, type, user_id) is the idempotency key.
    {
      unique: true,
      fields: ['work_entry_id', 'type', 'user_id'],
      where:  { work_entry_id: { [Op.ne]: null } },
    },
    {
      unique: true,
      fields: ['milestone_id', 'type', 'user_id'],
      where:  { milestone_id: { [Op.ne]: null } },
    },
  ],
});

module.exports = WalletTransaction;
