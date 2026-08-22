'use strict';
const { BookingWorkEntry, User } = require('../../models');
const wallet          = require('../wallet/wallet.service');
const { computeFee }  = require('../../config/fee');
const notify          = require('../../helpers/notification.helper');

// The platform's fee is parked in the primary admin's wallet — mirrors the
// same cached lookup in services/buyer/booking.service.js.
let _platformAdminId;
const platformAdminId = async () => {
  if (_platformAdminId !== undefined) return _platformAdminId;
  const admin = await User.findOne({ where: { role: 'ADMIN' }, order: [['id', 'ASC']], attributes: ['id'] });
  _platformAdminId = admin ? admin.id : null;
  return _platformAdminId;
};

/**
 * The single place money moves for an hourly BookingWorkEntry. Called from
 * three places: Buyer's approveWorkEntry, Seller's acceptWorkEntryCounter,
 * and Admin's resolveDispute(entry_id) — one implementation, no copy-paste.
 *
 * `hours` is whatever hours are being SETTLED (the seller's original figure,
 * an agreed counter, or an admin override) — never re-derived from a request.
 * `entry.rate` was snapshotted from the contract at submit time, so the rate
 * itself is never re-trusted from anywhere either.
 *
 * Must be called with an already-open transaction `t` in which the caller has
 * already row-locked both `booking` and `entry` — that lock is what prevents
 * two concurrent settle attempts from racing past the status check below.
 * The unique (work_entry_id, type) index on wallet_transactions is the
 * DB-level backstop in case that discipline is ever violated elsewhere.
 */
const settleWorkEntry = async (booking, entry, { hours, t }) => {
  const rate     = Number(entry.rate);
  const amount   = wallet.round2(hours * rate);
  const fee      = computeFee(amount);
  const earning  = wallet.round2(amount - fee);
  const adminId  = await platformAdminId();

  await wallet.debit(booking.buyer_id, amount, {
    type: 'booking_payment', booking_id: booking.id, work_entry_id: entry.id,
    note: `Payment — ${hours} hrs on booking #${booking.id} (${entry.work_date})`,
  }, t);

  await wallet.credit(booking.seller_id, earning, {
    type: 'earning', booking_id: booking.id, work_entry_id: entry.id,
    note: `Earning — ${hours} hrs @ $${rate}/hr, ${entry.work_date} (booking #${booking.id})`,
  }, t);

  if (adminId && fee > 0) {
    await wallet.credit(adminId, fee, {
      type: 'platform_fee', booking_id: booking.id, work_entry_id: entry.id,
      note: `Platform fee — work entry on booking #${booking.id}`,
    }, t);
  }

  await entry.update({
    status: 'approved',
    payment_status: 'released',
    hours, amount, platform_fee: fee,
    approved_at: new Date(),
  }, { transaction: t });

  // Recompute Booking's maintained aggregates from every approved entry —
  // see the comment on Booking.amount/hours_worked in booking.model.js.
  const approved = await BookingWorkEntry.findAll({
    where: { booking_id: booking.id, status: 'approved' },
    transaction: t,
  });
  const totalHours  = approved.reduce((s, e) => s + Number(e.hours), 0);
  const totalAmount = approved.reduce((s, e) => s + Number(e.amount), 0);
  await booking.update({
    hours_worked: wallet.round2(totalHours),
    amount:       wallet.round2(totalAmount),
  }, { transaction: t });

  // Fire-and-forget, after the transaction's caller commits — see each
  // caller's `.then()`. Kept here (rather than duplicated in three call
  // sites) so every settlement path notifies the seller identically.
  const seller = await User.findByPk(booking.seller_id, {
    attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'], transaction: t,
  });
  if (seller) notify.workEntryPaid(seller, booking, entry);

  return entry;
};

module.exports = { settleWorkEntry, platformAdminId };
