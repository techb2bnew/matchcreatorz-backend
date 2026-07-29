'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

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
      'adjustment'          // manual admin adjustment
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

}, {
  tableName:  'wallet_transactions',
  timestamps: true,
  underscored: true,
  paranoid:   false,
  indexes: [
    { fields: ['user_id', 'created_at'] },
    { fields: ['type'] },
    { fields: ['booking_id'] },
  ],
});

module.exports = WalletTransaction;
