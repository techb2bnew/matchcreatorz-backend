'use strict';
const { DataTypes } = require('sequelize');
const sequelize     = require('../config/db');

// A seller's request to cash out wallet balance. Admin approves → Stripe Connect
// transfer/payout to the seller's connected account. Amount is reserved in
// wallet.pending_withdraw while the request is pending.
const Withdrawal = sequelize.define('Withdrawal', {

  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  seller_id: {
    type:      DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete:  'CASCADE',
  },

  amount:   { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  currency: { type: DataTypes.STRING(3),      allowNull: false, defaultValue: 'usd' },

  status: {
    type:         DataTypes.ENUM('pending', 'approved', 'paid', 'rejected', 'failed'),
    allowNull:    false,
    defaultValue: 'pending',
  },

  method:         { type: DataTypes.STRING(30),  allowNull: false, defaultValue: 'stripe_connect' },
  stripe_transfer_id: { type: DataTypes.STRING,  allowNull: true },
  admin_id:       { type: DataTypes.INTEGER,     allowNull: true },  // who actioned it
  admin_note:     { type: DataTypes.STRING(255), allowNull: true },
  processed_at:   { type: DataTypes.DATE,        allowNull: true },

}, {
  tableName:  'withdrawals',
  timestamps: true,
  underscored: true,
  paranoid:   false,
  indexes: [
    { fields: ['seller_id'] },
    { fields: ['status'] },
  ],
});

module.exports = Withdrawal;
