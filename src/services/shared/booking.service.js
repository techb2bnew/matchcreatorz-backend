'use strict';
const { Job, User } = require('../../models');
const wallet = require('../wallet/wallet.service');
const notify = require('../../helpers/notification.helper');
const { platformAdminId } = require('./milestone.service');

/**
 * The single place money moves for a whole (non-milestone) Booking's
 * completion. Called from Buyer's acceptWork (wallet mode, and escrow mode's
 * hold-capture second click) and escrow.service.js's confirmBookingCharge
 * webhook (escrow mode's 'direct' single charge) — one implementation, no
 * copy-paste. Mirrors settleMilestone in shape.
 *
 * Must be called with an already-open transaction `t`; the caller is
 * responsible for row-locking `booking` first where concurrent settlement is
 * possible (the webhook path locks it; acceptWork already holds the only
 * booking row that matters since the buyer is the one calling it).
 */
const settleBooking = async (booking, { t } = {}) => {
  const amount  = Number(booking.amount);
  const fee     = Number(booking.platform_fee);
  const earning = wallet.round2(amount - fee);
  const adminId = await platformAdminId();

  // `wasHeld` covers escrow-mode bookings whose money was already collected
  // by Stripe (a captured hold, or a direct charge) — don't double-charge those.
  const wasHeld = booking.payment_status === 'held';

  if (!wasHeld) {
    await wallet.debit(booking.buyer_id, amount, {
      type: 'booking_payment', booking_id: booking.id,
      note: `Payment for booking #${booking.id} — ${booking.title}`,
    }, t);
  }

  await booking.update({ status: 'completed', payment_status: 'released' }, { transaction: t });
  await wallet.credit(booking.seller_id, earning, {
    type: 'earning', booking_id: booking.id,
    note: `Earning from booking #${booking.id} — ${booking.title}`,
  }, t);
  if (adminId && fee > 0) {
    await wallet.credit(adminId, fee, {
      type: 'platform_fee', booking_id: booking.id,
      note: `Platform fee from booking #${booking.id}`,
    }, t);
  }
  if (booking.job_id) {
    await Job.update({ status: 'COMPLETED' }, { where: { id: booking.job_id }, transaction: t });
  }

  const seller = await User.findByPk(booking.seller_id, {
    attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'], transaction: t,
  });
  if (seller) notify.workAccepted(seller, booking);

  return booking;
};

module.exports = { settleBooking };
