'use strict';
const { Op } = require('sequelize');
const { BookingMilestone, User, Job } = require('../../models');
const wallet          = require('../wallet/wallet.service');
const { computeFee }  = require('../../config/fee');
const notify          = require('../../helpers/notification.helper');

// The platform's fee is parked in the primary admin's wallet — mirrors the
// same cached lookup in services/shared/workEntry.service.js.
let _platformAdminId;
const platformAdminId = async () => {
  if (_platformAdminId !== undefined) return _platformAdminId;
  const admin = await User.findOne({ where: { role: 'ADMIN' }, order: [['id', 'ASC']], attributes: ['id'] });
  _platformAdminId = admin ? admin.id : null;
  return _platformAdminId;
};

/**
 * The single place money moves for a BookingMilestone. Called from Buyer's
 * acceptMilestone and Seller's acceptMilestoneCounterBySeller — one
 * implementation, no copy-paste.
 *
 * `amount` is whatever amount is being SETTLED (the seller's original stage
 * amount, or an agreed counter) — never re-derived from a request.
 *
 * Must be called with an already-open transaction `t` in which the caller has
 * already row-locked both `booking` and `milestone` — that lock is what
 * prevents two concurrent settle attempts from racing past the status check.
 * The unique (milestone_id, type) index on wallet_transactions is the
 * DB-level backstop in case that discipline is ever violated elsewhere.
 */
const settleMilestone = async (booking, milestone, { amount, t }) => {
  const fee     = computeFee(amount);
  const earning = wallet.round2(amount - fee);
  const adminId = await platformAdminId();

  // `wasHeld` covers legacy milestones from before deferred payment existed,
  // where the money was already collected up front — don't re-charge those.
  const wasHeld = milestone.payment_status === 'held';

  if (!wasHeld) {
    await wallet.debit(booking.buyer_id, amount, {
      type: 'booking_payment', booking_id: booking.id, milestone_id: milestone.id,
      note: `Payment for milestone "${milestone.title}" — booking #${booking.id}`,
    }, t);
  }

  await wallet.credit(booking.seller_id, earning, {
    type: 'earning', booking_id: booking.id, milestone_id: milestone.id,
    note: `Earning from milestone "${milestone.title}" — booking #${booking.id}`,
  }, t);

  if (adminId && fee > 0) {
    await wallet.credit(adminId, fee, {
      type: 'platform_fee', booking_id: booking.id, milestone_id: milestone.id,
      note: `Platform fee from milestone "${milestone.title}" — booking #${booking.id}`,
    }, t);
  }

  await milestone.update({
    status: 'approved',
    payment_status: 'released',
    amount, platform_fee: fee,
    approved_at: new Date(),
  }, { transaction: t });

  // Last milestone approved → the whole booking is done.
  const remaining = await BookingMilestone.count({
    where: { booking_id: booking.id, status: { [Op.ne]: 'approved' } },
    transaction: t,
  });
  if (remaining === 0) {
    await booking.update({ status: 'completed', payment_status: 'released' }, { transaction: t });
    if (booking.job_id) {
      await Job.update({ status: 'COMPLETED' }, { where: { id: booking.job_id }, transaction: t });
    }
  }

  const seller = await User.findByPk(booking.seller_id, {
    attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'], transaction: t,
  });
  if (seller) notify.workAccepted(seller, booking);

  return milestone;
};

module.exports = { settleMilestone, platformAdminId };
