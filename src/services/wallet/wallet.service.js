'use strict';
const { Op } = require('sequelize');
const { sequelize, Wallet, WalletTransaction } = require('../../models');
const env = require('../../config/env');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num    = (v) => Number(v || 0);

// Ensure the user has a wallet row (created lazily on first access).
const ensureWallet = async (userId, t = null) => {
  const [wallet] = await Wallet.findOrCreate({
    where:    { user_id: userId },
    defaults: { user_id: userId, currency: env.WALLET_CURRENCY },
    ...(t ? { transaction: t } : {}),
  });
  return wallet;
};

const getWallet = async (userId) => ensureWallet(userId);

// ── Atomic credit / debit ─────────────────────────────────────────────────────
// Runs inside a transaction with a row lock so concurrent bookings/top-ups can
// never corrupt the balance. `meta` → { type, note, booking_id, withdrawal_id, stripe_ref, status }
const applyDelta = async (userId, delta, meta = {}, existingTx = null) => {
  const run = async (t) => {
    const wallet = await Wallet.findOne({ where: { user_id: userId }, lock: t.LOCK.UPDATE, transaction: t })
      || await ensureWallet(userId, t);

    const current = num(wallet.balance);
    const next    = round2(current + delta);

    if (delta < 0 && next < 0 && !meta.allowNegative)
      throw Object.assign(new Error('Insufficient wallet balance'), { statusCode: 402 });

    const patch = { balance: next };
    if (delta > 0) patch.total_in  = round2(num(wallet.total_in)  + delta);
    if (delta < 0) patch.total_out = round2(num(wallet.total_out) + Math.abs(delta));
    await wallet.update(patch, { transaction: t });

    const txn = await WalletTransaction.create({
      user_id:       userId,
      amount:        round2(delta),
      balance_after: next,
      currency:      wallet.currency,
      type:          meta.type,
      status:        meta.status || 'completed',
      note:          meta.note || null,
      booking_id:    meta.booking_id || null,
      withdrawal_id: meta.withdrawal_id || null,
      stripe_ref:    meta.stripe_ref || null,
    }, { transaction: t });

    return { wallet, txn };
  };

  return existingTx ? run(existingTx) : sequelize.transaction(run);
};

const credit = (userId, amount, meta = {}, t = null) => applyDelta(userId, Math.abs(round2(amount)), meta, t);
const debit  = (userId, amount, meta = {}, t = null) => applyDelta(userId, -Math.abs(round2(amount)), meta, t);

// Reserve / release the pending-withdraw bucket (kept separate from spendable balance)
const reservePending = async (userId, amount, t = null) => {
  const run = async (tx) => {
    const wallet = await Wallet.findOne({ where: { user_id: userId }, lock: tx.LOCK.UPDATE, transaction: tx });
    await wallet.update({ pending_withdraw: round2(num(wallet.pending_withdraw) + Math.abs(amount)) }, { transaction: tx });
    return wallet;
  };
  return t ? run(t) : sequelize.transaction(run);
};
const releasePending = async (userId, amount, t = null) => {
  const run = async (tx) => {
    const wallet = await Wallet.findOne({ where: { user_id: userId }, lock: tx.LOCK.UPDATE, transaction: tx });
    await wallet.update({ pending_withdraw: Math.max(0, round2(num(wallet.pending_withdraw) - Math.abs(amount))) }, { transaction: tx });
    return wallet;
  };
  return t ? run(t) : sequelize.transaction(run);
};

// Mirrors the frontend's TX_LABEL fallback (matchcreatorz/src/app/(buyer)/buyer/wallet/page.tsx)
// so a search matches what the user actually sees when a transaction has no note.
const TYPE_LABELS = {
  topup: 'Wallet top-up', booking_payment: 'Booking payment', booking_refund: 'Booking refund',
  earning: 'Earning', platform_fee: 'Platform fee', withdrawal: 'Withdrawal',
  withdrawal_reversal: 'Withdrawal reversed', adjustment: 'Adjustment',
  milestone_release: 'Milestone released to seller',
};

// ── Reads ─────────────────────────────────────────────────────────────────────
const listTransactions = async (userId, { page = 1, limit = 20, type, search } = {}) => {
  const where = { user_id: userId };
  if (type) where.type = type;

  if (search && String(search).trim()) {
    const term = String(search).trim();
    const orConditions = [{ note: { [Op.iLike]: `%${term}%` } }];

    // A type whose human-readable label matches the search term (e.g. searching
    // "top-up" should find rows with no note but type='topup').
    const matchingTypes = Object.entries(TYPE_LABELS)
      .filter(([, label]) => label.toLowerCase().includes(term.toLowerCase()))
      .map(([key]) => key);
    if (matchingTypes.length) orConditions.push({ type: { [Op.in]: matchingTypes } });

    // Support matching by the date shown in the UI (e.g. "Aug 3, 2026") by
    // treating a parseable search string as a whole-day range.
    const parsedDate = new Date(term);
    if (!isNaN(parsedDate.getTime())) {
      const dayStart = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
      const dayEnd   = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      orConditions.push({ created_at: { [Op.gte]: dayStart, [Op.lt]: dayEnd } });
    }

    where[Op.or] = orConditions;
  }

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await WalletTransaction.findAndCountAll({
    where, order: [['created_at', 'DESC']], limit: Number(limit), offset,
  });
  return { data: rows, total: count, page: Number(page), limit: Number(limit) };
};

const shapeWallet = (w) => ({
  balance:          round2(num(w.balance)),
  available:        round2(num(w.balance)),          // spendable (pending is already out of balance)
  pending_withdraw: round2(num(w.pending_withdraw)),
  total_in:         round2(num(w.total_in)),
  total_out:        round2(num(w.total_out)),
  currency:         w.currency,
  stripe_account_status: w.stripe_account_status,
  connected:        w.stripe_account_status === 'active',
});

const getSummary = async (userId) => {
  const w = await ensureWallet(userId);
  return shapeWallet(w);
};

module.exports = {
  round2,
  ensureWallet,
  getWallet,
  credit,
  debit,
  reservePending,
  releasePending,
  listTransactions,
  shapeWallet,
  getSummary,
  _applyDelta: applyDelta,
  Op,
};
