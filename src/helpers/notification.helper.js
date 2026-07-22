'use strict';
/**
 * notification.helper.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified helper — wraps FCM (firebase.helper) + email (email.helper).
 * Every function is fire-and-forget: errors are logged, never thrown.
 *
 * Usage:
 *   const notify = require('./notification.helper');
 *   notify.bidPlaced(buyer, job, seller);          // FCM + email to buyer
 *   notify.bookingAccepted(booking, seller, buyer); // FCM + email to seller
 */

const { sendPush, sendMulticastPush, sendWebPush } = require('./firebase.helper');
const email                                        = require('./email.helper');
const { Notification }                             = require('../models');

// ── Internal fire-and-forget wrapper ─────────────────────────────────────────
const ff = (promise) => Promise.resolve(promise).catch(err =>
  console.error('Notification error:', err.message)
);

// ── Save notification to DB ───────────────────────────────────────────────────
const saveNotification = (userId, title, body, type, data = {}) =>
  ff(Notification.create({ user_id: userId, title, body, type, data }));

// ── Send push to a user ───────────────────────────────────────────────────────
// web_fcm_token  = PushSubscription JSON  → native web push via VAPID
// mobile_fcm_token = FCM registration token → Firebase Admin SDK
const push = (user, title, body, data = {}) => {
  // Always save to DB notification inbox
  saveNotification(user.id, title, body, data?.type || null, data);

  const promises = [];
  if (user?.web_fcm_token)    promises.push(ff(sendWebPush(user.web_fcm_token, title, body, data)));
  if (user?.mobile_fcm_token) promises.push(ff(sendPush(user.mobile_fcm_token, title, body, data)));
  return promises.length ? Promise.all(promises) : Promise.resolve(null);
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

/** Called after successful registration */
const welcome = (user) => ff(
  email.sendWelcome(user.email, user.name)
);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN → SELLER  (approval / rejection / block)
// ─────────────────────────────────────────────────────────────────────────────

const sellerApproved = (seller) => {
  ff(email.sendSellerApproved(seller.email, seller.name));
  push(seller, 'Account Approved! 🎉', 'Congratulations! Your seller account has been approved. Start earning now.', { type: 'seller_approved' });
};

const sellerRejected = (seller) => {
  ff(email.sendSellerRejected(seller.email, seller.name));
  push(seller, 'Account Update', 'Your seller account application has been reviewed. Please check your email for details.', { type: 'seller_rejected' });
};

const sellerBlocked = (seller) => {
  ff(email.sendAccountBlocked(seller.email, seller.name, 'seller'));
  push(seller, 'Account Suspended', 'Your account has been suspended. Contact support for assistance.', { type: 'account_blocked' });
};

const sellerUnblocked = (seller) => {
  ff(email.sendAccountUnblocked(seller.email, seller.name, 'seller'));
  push(seller, 'Account Restored', 'Your account has been reinstated. Welcome back!', { type: 'account_unblocked' });
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN → BUYER
// ─────────────────────────────────────────────────────────────────────────────

const buyerBlocked = (buyer) => {
  ff(email.sendAccountBlocked(buyer.email, buyer.name, 'buyer'));
  push(buyer, 'Account Suspended', 'Your account has been suspended. Contact support for assistance.', { type: 'account_blocked' });
};

const buyerUnblocked = (buyer) => {
  ff(email.sendAccountUnblocked(buyer.email, buyer.name, 'buyer'));
  push(buyer, 'Account Restored', 'Your account has been reinstated. Welcome back!', { type: 'account_unblocked' });
};

// ─────────────────────────────────────────────────────────────────────────────
// JOBS & BIDS
// ─────────────────────────────────────────────────────────────────────────────

/** Seller places bid → notify buyer */
const bidPlaced = (buyer, job, seller) => {
  ff(email.sendNewBidNotification(buyer.email, buyer.name, job.title, seller.name));
  push(buyer,
    'New Bid Received',
    `${seller.name} placed a bid on your job "${job.title}"`,
    { type: 'bid_placed', job_id: String(job.id) }
  );
};

/** Buyer accepts bid → notify seller */
const bidAccepted = (seller, job) => {
  ff(email.sendBidAccepted(seller.email, seller.name, job.title));
  push(seller,
    'Bid Accepted! 🎉',
    `Your bid on "${job.title}" was accepted. Check your bookings.`,
    { type: 'bid_accepted', job_id: String(job.id) }
  );
};

/** Seller withdraws bid → notify buyer */
const bidWithdrawn = (buyer, job, sellerName) => {
  ff(email.sendBidWithdrawn(buyer.email, buyer.name, job.title, sellerName));
  push(buyer,
    'Bid Withdrawn',
    `${sellerName} withdrew their bid on "${job.title}"`,
    { type: 'bid_withdrawn', job_id: String(job.id) }
  );
};

/** Buyer rejects bid → notify seller */
const bidRejected = (seller, job) => {
  ff(email.sendBidRejected(seller.email, seller.name, job.title));
  push(seller,
    'Bid Not Selected',
    `Your bid on "${job.title}" was not selected this time.`,
    { type: 'bid_rejected', job_id: String(job.id) }
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS
// ─────────────────────────────────────────────────────────────────────────────

/** Buyer creates booking → notify seller */
const bookingCreated = (seller, booking) => {
  ff(email.sendBookingReceived(seller.email, seller.name, booking.title));
  push(seller,
    'New Booking Request',
    `You received a new booking for "${booking.title}"`,
    { type: 'booking_created', booking_id: String(booking.id) }
  );
};

/** Seller accepts order (pending→ongoing) → notify buyer */
const bookingAccepted = (buyer, booking) => {
  ff(email.sendBookingConfirmed(buyer.email, buyer.name, booking.title, booking.createdAt));
  push(buyer,
    'Booking Accepted ✅',
    `Your booking "${booking.title}" has been accepted and is now in progress.`,
    { type: 'booking_accepted', booking_id: String(booking.id) }
  );
};

/** Seller submits work (ongoing→amidst_completion) → notify buyer */
const workSubmitted = (buyer, booking) => {
  ff(email.sendWorkSubmitted(buyer.email, buyer.name, booking.title));
  push(buyer,
    'Work Submitted for Review',
    `The seller has submitted work for "${booking.title}". Please review and accept or raise a dispute.`,
    { type: 'work_submitted', booking_id: String(booking.id) }
  );
};

/** Buyer accepts work (amidst_completion→completed) → notify seller */
const workAccepted = (seller, booking) => {
  ff(email.sendWorkAccepted(seller.email, seller.name, booking.title));
  push(seller,
    'Work Accepted! 🎉',
    `The buyer accepted your work for "${booking.title}". The booking is now complete.`,
    { type: 'work_accepted', booking_id: String(booking.id) }
  );
};

/** Buyer rejects work / raises dispute → notify seller */
const disputeRaised = (seller, booking) => {
  ff(email.sendDisputeRaised(seller.email, seller.name, booking.title));
  push(seller,
    'Dispute Raised ⚠️',
    `The buyer raised a dispute on "${booking.title}". Our team will review.`,
    { type: 'dispute_raised', booking_id: String(booking.id) }
  );
};

/** Booking cancelled by buyer → notify seller */
const bookingCancelledBySeller = (buyer, booking) => {
  ff(email.sendBookingCancelled(buyer.email, buyer.name, booking.title, 'seller'));
  push(buyer,
    'Booking Cancelled',
    `Your booking "${booking.title}" was cancelled by the seller.`,
    { type: 'booking_cancelled', booking_id: String(booking.id) }
  );
};

/** Booking cancelled by seller → notify buyer */
const bookingCancelledByBuyer = (seller, booking) => {
  ff(email.sendBookingCancelled(seller.email, seller.name, booking.title, 'buyer'));
  push(seller,
    'Booking Cancelled',
    `The booking "${booking.title}" was cancelled by the buyer.`,
    { type: 'booking_cancelled', booking_id: String(booking.id) }
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWS
// ─────────────────────────────────────────────────────────────────────────────

/** Buyer leaves a review → notify seller */
const reviewReceived = (seller, buyerName, rating, serviceName) => {
  ff(email.sendReviewReceived(seller.email, seller.name, buyerName, rating, serviceName));
  push(seller,
    'New Review Received ⭐',
    `${buyerName} gave you a ${rating}-star review. Keep up the great work!`,
    { type: 'review_received', rating: String(rating) }
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTS
// ─────────────────────────────────────────────────────────────────────────────

/** Admin adds connects to seller */
const connectsAdded = (seller, amount, note) => {
  ff(email.sendConnectsAdded(seller.email, seller.name, amount, note));
  push(seller,
    `${amount} Connects Added! 🔗`,
    `${amount} connects have been credited to your account.`,
    { type: 'connects_added', amount: String(amount) }
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// OFFERS (seller → buyer)
// ─────────────────────────────────────────────────────────────────────────────

const offerReceived = (buyer, sellerName, offer) => {
  push(buyer,
    'New Offer Received 📩',
    `${sellerName} sent you an offer: "${offer.title}" for $${offer.amount}`,
    { type: 'offer_received', offer_id: String(offer.id) }
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// BID COUNTER / NEGOTIATION
// ─────────────────────────────────────────────────────────────────────────────

const bidCountered = (recipient, job, byRole, amount) => {
  const who = byRole === 'buyer' ? 'Buyer' : 'Seller';
  push(recipient,
    'Counter Offer 🔁',
    `${who} countered on "${job.title}" — new amount $${amount}`,
    { type: 'bid_countered', job_id: String(job.id), by: byRole, amount: String(amount) }
  );
};

module.exports = {
  // auth
  welcome,
  // admin → seller
  sellerApproved,
  sellerRejected,
  sellerBlocked,
  sellerUnblocked,
  // admin → buyer
  buyerBlocked,
  buyerUnblocked,
  // bids
  bidPlaced,
  bidWithdrawn,
  bidAccepted,
  bidRejected,
  // bookings
  bookingCreated,
  bookingAccepted,
  workSubmitted,
  workAccepted,
  disputeRaised,
  bookingCancelledBySeller,
  bookingCancelledByBuyer,
  // reviews
  reviewReceived,
  // connects
  connectsAdded,
  offerReceived,
  bidCountered,
};
