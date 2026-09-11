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
const settleBooking = async (booking, { t, stripeFee } = {}) => {
  const amount  = Number(booking.amount);
  const fee     = Number(booking.platform_fee);
  const adminId = await platformAdminId();

  // `wasHeld` covers escrow-mode bookings whose money was already collected
  // by Stripe (a captured hold, or a direct charge) — don't double-charge those.
  const wasHeld = booking.payment_status === 'held';
  // Stripe's processing fee comes out of the seller's payout; the platform
  // keeps its full commission. That makes the settlement reconcile exactly:
  //   amount = earning + platform_fee + stripe_fee
  // Only ever non-zero for a payment Stripe actually charged — a wallet-mode
  // booking moves money internally, so there is no processing fee to absorb.
  const sFee    = wasHeld && stripeFee != null ? wallet.round2(stripeFee) : 0;
  const earning = wallet.round2(amount - fee - sFee);
  // Fee breakdown attached to every transaction this settlement creates, so
  // expanding any one of them (buyer, seller, or admin's) shows the full
  // picture — gross amount, our cut, and Stripe's own processing fee (only
  // ever known for a payment actually charged via Stripe).
  const feeMeta = { gross_amount: amount, platform_fee: fee, stripe_fee: wasHeld ? stripeFee : null };

  if (!wasHeld) {
    await wallet.debit(booking.buyer_id, amount, {
      type: 'booking_payment', booking_id: booking.id,
      note: `Payment for booking #${booking.id} — ${booking.title}`,
      ...feeMeta,
    }, t);
  } else {
    // The buyer's card was charged directly via Stripe — nothing to debit
    // from their wallet, but without a row here their transaction history
    // would show no trace of this payment at all.
    await wallet.credit(booking.buyer_id, 0, {
      type: 'escrow_payment', booking_id: booking.id,
      note: `Paid via Stripe for booking #${booking.id} — ${booking.title}`,
      ...feeMeta,
    }, t);
  }

  await booking.update({ status: 'completed', payment_status: 'released' }, { transaction: t });
  await wallet.credit(booking.seller_id, earning, {
    type: 'earning', booking_id: booking.id,
    note: `Earning from booking #${booking.id} — ${booking.title}`,
    ...feeMeta,
  }, t);
  if (adminId && fee > 0) {
    await wallet.credit(adminId, fee, {
      type: 'platform_fee', booking_id: booking.id,
      note: `Platform fee from booking #${booking.id}`,
      ...feeMeta,
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
