'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// Ledger of connects earned / spent by a seller.
// `amount` is positive for credits (admin add / purchase) and
// negative for debits (bid deduction). `balance_after` snapshots
// the running balance so history is self-explanatory.
const ConnectTransaction = sequelize.define('ConnectTransaction', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  seller_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete:  'CASCADE',
  },

  amount:        { type: DataTypes.INTEGER, allowNull: false },              // +credit / -debit
  balance_after: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

  type: {
    type:         DataTypes.ENUM('admin_credit', 'bid_deduct', 'purchase', 'refund'),
    allowNull:    false,
    defaultValue: 'admin_credit',
  },

  note:       { type: DataTypes.STRING(255), allowNull: true },
  ref_id:     { type: DataTypes.INTEGER,     allowNull: true }, // e.g. related job/bid id
  stripe_ref: { type: DataTypes.STRING,      allowNull: true }, // Stripe checkout session id (purchase idempotency)

}, {
  tableName:  'connect_transactions',
  timestamps: true,
  underscored: true,
  paranoid:   false,
});

module.exports = ConnectTransaction;
