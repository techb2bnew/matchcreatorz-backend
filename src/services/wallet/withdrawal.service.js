'use strict';
const { sequelize, Wallet, Withdrawal, User } = require('../../models');
const wallet  = require('./wallet.service');
const stripe  = require('../../helpers/stripe.helper');
const notify  = require('../../helpers/notification.helper');
const env     = require('../../config/env');

const round2 = wallet.round2;
const num    = (v) => Number(v || 0);

// ── Stripe Connect onboarding (seller) ────────────────────────────────────────
const startOnboarding = async (seller, { returnUrl, refreshUrl }) => {
  if (!stripe.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const w = await wallet.ensureWallet(seller.id);

  let accountId = w.stripe_account_id;
  if (!accountId) {
    const account = await stripe.createConnectAccount({ email: seller.email });
    accountId = account.id;
    await w.update({ stripe_account_id: accountId, stripe_account_status: 'pending' });
  }

  const link = await stripe.createAccountLink({
    accountId,
    returnUrl:  returnUrl  || `${env.CLIENT_URL}/seller/wallet?connect=done`,
    refreshUrl: refreshUrl || `${env.CLIENT_URL}/seller/wallet?connect=retry`,
  });
  return { url: link.url, account_id: accountId };
};

// Refresh the connected-account status from Stripe (called on return / status check)
const syncConnectStatus = async (userId) => {
  const w = await wallet.ensureWallet(userId);
  if (!w.stripe_account_id || !stripe.isEnabled()) return wallet.shapeWallet(w);
  try {
    const acct = await stripe.retrieveAccount(w.stripe_account_id);
    const active = acct.payouts_enabled && acct.charges_enabled;
    await w.update({ stripe_account_status: active ? 'active' : (acct.requirements?.disabled_reason ? 'restricted' : 'pending') });
  } catch { /* leave status as-is */ }
  return wallet.shapeWallet(await wallet.ensureWallet(userId));
};

// ── Seller: request a withdrawal ──────────────────────────────────────────────
const requestWithdrawal = async (seller, amount) => {
  const amt = round2(amount);
  if (!amt || amt <= 0) throw Object.assign(new Error('Enter a valid amount'), { statusCode: 400 });
  if (amt < env.MIN_WITHDRAW)
    throw Object.assign(new Error(`Minimum withdrawal is ${env.MIN_WITHDRAW}`), { statusCode: 400 });

  const w = await wallet.ensureWallet(seller.id);
  if (w.stripe_account_status !== 'active')
    throw Object.assign(new Error('Connect your payout account before withdrawing'), { statusCode: 400 });
  if (num(w.balance) < amt)
    throw Object.assign(new Error('Insufficient balance'), { statusCode: 400 });

  // Move money out of spendable balance into the pending bucket + create request.
  const withdrawal = await sequelize.transaction(async (t) => {
    await wallet.debit(seller.id, amt, {
      type: 'withdrawal', note: 'Withdrawal request', status: 'pending',
    }, t);
    await wallet.reservePending(seller.id, amt, t);
    return Withdrawal.create({
      seller_id: seller.id, amount: amt, currency: w.currency, status: 'pending',
    }, { transaction: t });
  });

  const sellerUser = await User.findByPk(seller.id, { attributes: ['name'] });
  notify.withdrawalRequested(sellerUser && sellerUser.name, withdrawal);

  return withdrawal;
};

// ── Admin: approve → Stripe transfer/payout ───────────────────────────────────
const approveWithdrawal = async (adminId, id) => {
  const wd = await Withdrawal.findByPk(id);
  if (!wd) throw Object.assign(new Error('Withdrawal not found'), { statusCode: 404 });
  if (wd.status !== 'pending') throw Object.assign(new Error('Withdrawal is not pending'), { statusCode: 400 });

  const w = await wallet.ensureWallet(wd.seller_id);
  let transferId = null;
  try {
    if (stripe.isEnabled() && w.stripe_account_id) {
      const transfer = await stripe.transferToConnected({
        amount: num(wd.amount), accountId: w.stripe_account_id,
        metadata: { withdrawal_id: String(wd.id), seller_id: String(wd.seller_id) },
      });
      transferId = transfer.id;
    }
  } catch (e) {
    await wd.update({ status: 'failed', admin_id: adminId, admin_note: e.message, processed_at: new Date() });
    throw Object.assign(new Error(`Stripe transfer failed: ${e.message}`), { statusCode: 402 });
  }

  await sequelize.transaction(async (t) => {
    await wallet.releasePending(wd.seller_id, num(wd.amount), t);   // pending → gone (paid out)
    await wd.update({
      status: 'paid', admin_id: adminId, stripe_transfer_id: transferId, processed_at: new Date(),
    }, { transaction: t });
  });

  return wd;
};

// ── Admin: reject → return funds to the seller's spendable balance ────────────
const rejectWithdrawal = async (adminId, id, note) => {
  const wd = await Withdrawal.findByPk(id);
  if (!wd) throw Object.assign(new Error('Withdrawal not found'), { statusCode: 404 });
  if (wd.status !== 'pending') throw Object.assign(new Error('Withdrawal is not pending'), { statusCode: 400 });

  await sequelize.transaction(async (t) => {
    await wallet.releasePending(wd.seller_id, num(wd.amount), t);
    await wallet.credit(wd.seller_id, num(wd.amount), {
      type: 'withdrawal_reversal', withdrawal_id: wd.id, note: note || 'Withdrawal rejected',
    }, t);
    await wd.update({ status: 'rejected', admin_id: adminId, admin_note: note || null, processed_at: new Date() }, { transaction: t });
  });

  return wd;
};

// ── Lists ─────────────────────────────────────────────────────────────────────
const listMyWithdrawals = async (sellerId, { page = 1, limit = 20 } = {}) => {
  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Withdrawal.findAndCountAll({
    where: { seller_id: sellerId }, order: [['created_at', 'DESC']], limit: Number(limit), offset,
  });
  return { data: rows, total: count, page: Number(page), limit: Number(limit) };
};

const listAllWithdrawals = async ({ page = 1, limit = 20, status } = {}) => {
  const where = {};
  if (status) where.status = status;
  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Withdrawal.findAndCountAll({
    where,
    include: [{ model: User, as: 'seller', attributes: ['id', 'name', 'email'] }],
    order: [['created_at', 'DESC']], limit: Number(limit), offset,
  });
  return { data: rows, total: count, page: Number(page), limit: Number(limit) };
};

module.exports = {
  startOnboarding,
  syncConnectStatus,
  requestWithdrawal,
  approveWithdrawal,
  rejectWithdrawal,
  listMyWithdrawals,
  listAllWithdrawals,
};
