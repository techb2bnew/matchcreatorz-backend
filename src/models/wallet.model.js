'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// One wallet per user (all roles). `balance` is the spendable/available balance.
// `pending_withdraw` is money reserved by a withdrawal request that is not yet
// paid (so it can't be spent twice). Stripe ids link the user to Stripe objects.
const Wallet = sequelize.define('Wallet', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  user_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    unique:    true,
    references: { model: 'users', key: 'id' },
    onDelete:  'CASCADE',
  },

  balance:          { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  pending_withdraw: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  currency:         { type: DataTypes.STRING(3),      allowNull: false, defaultValue: 'usd' },

  // Lifetime aggregates (denormalised for quick dashboard cards)
  total_in:  { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 }, // topups + earnings
  total_out: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 }, // spends + withdrawals

  // Stripe linkage
  stripe_customer_id: { type: DataTypes.STRING, allowNull: true },  // buyer (checkout)
  stripe_account_id:  { type: DataTypes.STRING, allowNull: true },  // seller Connect account
  stripe_account_status: {
    type:         DataTypes.ENUM('none', 'pending', 'active', 'restricted'),
    allowNull:    false,
    defaultValue: 'none',
  },

}, {
  tableName:  'wallets',
  timestamps: true,
  underscored: true,
  paranoid:   false,
});

module.exports = Wallet;
