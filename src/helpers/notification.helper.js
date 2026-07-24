'use strict';
/**
 * notification.helper.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified helper — wraps FCM (firebase.helper) + email (email.helper) + in-app inbox.
 * Every function is fire-and-forget: errors are logged, never thrown.
 *
 * Delivery now RESPECTS each user's saved preferences (Settings page):
 *   - notifications.email   → gate ALL emails
 *   - notifications.<cat>   → gate push + email for that category
 *   - in-app inbox is ALWAYS saved so nothing is lost
 * Account-critical events (approval / block / password etc.) have no category
 * and are always delivered.
 */

const { sendPush, sendWebPush } = require('./firebase.helper');
const email                     = require('./email.helper');
const { Notification, User }    = require('../models');

// ── Internal fire-and-forget wrapper ─────────────────────────────────────────
const ff = (promise) => Promise.resolve(promise).catch(err =>
  console.error('Notification error:', err && err.message)
);

// ── Save notification to DB inbox ─────────────────────────────────────────────
const saveNotification = (userId, title, body, type, data = {}) =>
  ff(Notification.create({ user_id: userId, title, body, type, data }));

// Map a notification `type` → the Settings toggle category it belongs to.
// Returns null for events that must always be delivered (account status, etc.).
const categoryOf = (type) => {
  if (!type) return null;
  // Bids + bookings + work lifecycle → "Booking Updates" (both roles have this toggle)
  if (
    type.startsWith('booking') ||
    type.startsWith('bid') ||
    ['work_submitted', 'work_accepted', 'dispute_raised'].includes(type)
  ) return 'bookingAlert';
  if (type === 'connects_added' || type.includes('payment') || type.includes('payout')) return 'payAlert';
  if (type === 'offer_received') return 'offerAlert';
  if (type === 'chat_message') return 'chatAlert';
  return null; // review_received, account status, etc. → always on
};

// Resolve the recipient's notification preferences (fetch if not already loaded).
const resolvePrefs = async (user) => {
  if (user && user.preferences && typeof user.preferences === 'object') {
    return user.preferences.notifications || {};
  }
  if (user && user.id) {
    const u = await ff(User.findByPk(user.id, { attributes: ['preferences'] }));
    return (u && u.preferences && u.preferences.notifications) || {};
  }
  return {};
};

/**
 * Central, preference-aware delivery.
 * @param {object} user   recipient (needs id; web/mobile tokens optional)
 * @param {object} opts   { type, title, body, data, email: () => Promise }
 */
const notifyUser = async (user, { type, title, body, data = {}, email: emailFn = null } = {}) => {
  try {
    if (!user || !user.id) return;
    const prefs   = await resolvePrefs(user);
    const cat     = categoryOf(type);
    const catOn   = cat ? prefs[cat] !== false : true;   // default ON
    const emailOn = prefs.email !== false;               // default ON

    // Category turned OFF → deliver NOTHING (no inbox, no push, no email)
    if (!catOn) return;

    // 1) In-app inbox
    saveNotification(user.id, title, body, type || null, data);

    // 2) Push (web + mobile)
    if (user.web_fcm_token)    ff(sendWebPush(user.web_fcm_token, title, body, data));
    if (user.mobile_fcm_token) ff(sendPush(user.mobile_fcm_token, title, body, data));

    // 3) Email — also respects the Email master toggle
    if (emailFn && emailOn) ff(emailFn());
  } catch (err) {
    console.error('notifyUser error:', err && err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

/** Registration welcome — always emailed (no toggle) */
const welcome = (user) => ff(email.sendWelcome(user.email, user.name));

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN → SELLER  (account status — always delivered)
// ─────────────────────────────────────────────────────────────────────────────

const sellerApproved = (seller) => notifyUser(seller, {
  type: 'seller_approved', title: 'Account Approved! 🎉',
  body: 'Congratulations! Your seller account has been approved. Start earning now.',
  data: { type: 'seller_approved' },
  email: () => email.sendSellerApproved(seller.email, seller.name),
});

const sellerRejected = (seller) => notifyUser(seller, {
  type: 'seller_rejected', title: 'Account Update',
  body: 'Your seller account application has been reviewed. Please check your email for details.',
  data: { type: 'seller_rejected' },
  email: () => email.sendSellerRejected(seller.email, seller.name),
});

const sellerBlocked = (seller) => notifyUser(seller, {
  type: 'account_blocked', title: 'Account Suspended',
  body: 'Your account has been suspended. Contact support for assistance.',
  data: { type: 'account_blocked' },
  email: () => email.sendAccountBlocked(seller.email, seller.name, 'seller'),
});

const sellerUnblocked = (seller) => notifyUser(seller, {
  type: 'account_unblocked', title: 'Account Restored',
  body: 'Your account has been reinstated. Welcome back!',
  data: { type: 'account_unblocked' },
  email: () => email.sendAccountUnblocked(seller.email, seller.name, 'seller'),
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN → BUYER
// ─────────────────────────────────────────────────────────────────────────────

const buyerBlocked = (buyer) => notifyUser(buyer, {
  type: 'account_blocked', title: 'Account Suspended',
  body: 'Your account has been suspended. Contact support for assistance.',
  data: { type: 'account_blocked' },
  email: () => email.sendAccountBlocked(buyer.email, buyer.name, 'buyer'),
});

const buyerUnblocked = (buyer) => notifyUser(buyer, {
  type: 'account_unblocked', title: 'Account Restored',
  body: 'Your account has been reinstated. Welcome back!',
  data: { type: 'account_unblocked' },
  email: () => email.sendAccountUnblocked(buyer.email, buyer.name, 'buyer'),
});

// ─────────────────────────────────────────────────────────────────────────────
// JOBS & BIDS  (category: jobAlert)
// ─────────────────────────────────────────────────────────────────────────────

const bidPlaced = (buyer, job, seller) => notifyUser(buyer, {
  type: 'bid_placed', title: 'New Bid Received',
  body: `${seller.name} placed a bid on your job "${job.title}"`,
  data: { type: 'bid_placed', job_id: String(job.id) },
  email: () => email.sendNewBidNotification(buyer.email, buyer.name, job.title, seller.name),
});

const bidAccepted = (seller, job) => notifyUser(seller, {
  type: 'bid_accepted', title: 'Bid Accepted! 🎉',
  body: `Your bid on "${job.title}" was accepted. Check your bookings.`,
  data: { type: 'bid_accepted', job_id: String(job.id) },
  email: () => email.sendBidAccepted(seller.email, seller.name, job.title),
});

const bidWithdrawn = (buyer, job, sellerName) => notifyUser(buyer, {
  type: 'bid_withdrawn', title: 'Bid Withdrawn',
  body: `${sellerName} withdrew their bid on "${job.title}"`,
  data: { type: 'bid_withdrawn', job_id: String(job.id) },
  email: () => email.sendBidWithdrawn(buyer.email, buyer.name, job.title, sellerName),
});

const bidRejected = (seller, job) => notifyUser(seller, {
  type: 'bid_rejected', title: 'Bid Not Selected',
  body: `Your bid on "${job.title}" was not selected this time.`,
  data: { type: 'bid_rejected', job_id: String(job.id) },
  email: () => email.sendBidRejected(seller.email, seller.name, job.title),
});

const bidCountered = (recipient, job, byRole, amount) => notifyUser(recipient, {
  type: 'bid_countered', title: 'Counter Offer 🔁',
  body: `${byRole === 'buyer' ? 'Buyer' : 'Seller'} countered on "${job.title}" — new amount $${amount}`,
  data: { type: 'bid_countered', job_id: String(job.id), by: byRole, amount: String(amount) },
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS  (category: bookingAlert)
// ─────────────────────────────────────────────────────────────────────────────

const bookingCreated = (seller, booking) => notifyUser(seller, {
  type: 'booking_created', title: 'New Booking Request',
  body: `You received a new booking for "${booking.title}"`,
  data: { type: 'booking_created', booking_id: String(booking.id) },
  email: () => email.sendBookingReceived(seller.email, seller.name, booking.title),
});

const bookingAccepted = (buyer, booking) => notifyUser(buyer, {
  type: 'booking_accepted', title: 'Booking Accepted ✅',
  body: `Your booking "${booking.title}" has been accepted and is now in progress.`,
  data: { type: 'booking_accepted', booking_id: String(booking.id) },
  email: () => email.sendBookingConfirmed(buyer.email, buyer.name, booking.title, booking.createdAt),
});

const workSubmitted = (buyer, booking) => notifyUser(buyer, {
  type: 'work_submitted', title: 'Work Submitted for Review',
  body: `The seller has submitted work for "${booking.title}". Please review and accept or raise a dispute.`,
  data: { type: 'work_submitted', booking_id: String(booking.id) },
  email: () => email.sendWorkSubmitted(buyer.email, buyer.name, booking.title),
});

const workAccepted = (seller, booking) => notifyUser(seller, {
  type: 'work_accepted', title: 'Work Accepted! 🎉',
  body: `The buyer accepted your work for "${booking.title}". The booking is now complete.`,
  data: { type: 'work_accepted', booking_id: String(booking.id) },
  email: () => email.sendWorkAccepted(seller.email, seller.name, booking.title),
});

const disputeRaised = (seller, booking) => notifyUser(seller, {
  type: 'dispute_raised', title: 'Dispute Raised ⚠️',
  body: `The buyer raised a dispute on "${booking.title}". Our team will review.`,
  data: { type: 'dispute_raised', booking_id: String(booking.id) },
  email: () => email.sendDisputeRaised(seller.email, seller.name, booking.title),
});

const bookingCancelledBySeller = (buyer, booking) => notifyUser(buyer, {
  type: 'booking_cancelled', title: 'Booking Cancelled',
  body: `Your booking "${booking.title}" was cancelled by the seller.`,
  data: { type: 'booking_cancelled', booking_id: String(booking.id) },
  email: () => email.sendBookingCancelled(buyer.email, buyer.name, booking.title, 'seller'),
});

const bookingCancelledByBuyer = (seller, booking) => notifyUser(seller, {
  type: 'booking_cancelled', title: 'Booking Cancelled',
  body: `The booking "${booking.title}" was cancelled by the buyer.`,
  data: { type: 'booking_cancelled', booking_id: String(booking.id) },
  email: () => email.sendBookingCancelled(seller.email, seller.name, booking.title, 'buyer'),
});

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWS  (no dedicated toggle → always)
// ─────────────────────────────────────────────────────────────────────────────

const reviewReceived = (seller, buyerName, rating, serviceName) => notifyUser(seller, {
  type: 'review_received', title: 'New Review Received ⭐',
  body: `${buyerName} gave you a ${rating}-star review. Keep up the great work!`,
  data: { type: 'review_received', rating: String(rating) },
  email: () => email.sendReviewReceived(seller.email, seller.name, buyerName, rating, serviceName),
});

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTS  (category: payAlert)
// ─────────────────────────────────────────────────────────────────────────────

const connectsAdded = (seller, amount, note) => notifyUser(seller, {
  type: 'connects_added', title: `${amount} Connects Added! 🔗`,
  body: `${amount} connects have been credited to your account.`,
  data: { type: 'connects_added', amount: String(amount) },
  email: () => email.sendConnectsAdded(seller.email, seller.name, amount, note),
});

// ─────────────────────────────────────────────────────────────────────────────
// OFFERS  (category: offerAlert)
// ─────────────────────────────────────────────────────────────────────────────

const offerReceived = (buyer, sellerName, offer) => notifyUser(buyer, {
  type: 'offer_received', title: 'New Offer Received 📩',
  body: `${sellerName} sent you an offer: "${offer.title}" for $${offer.amount}`,
  data: { type: 'offer_received', offer_id: String(offer.id) },
});

// ─────────────────────────────────────────────────────────────────────────────
// CHAT  (category: chatAlert — respects the "Chat Messages" setting; no email)
// ─────────────────────────────────────────────────────────────────────────────

const chatMessage = async (recipientId, senderName, message) => {
  const user = await ff(User.findByPk(recipientId, {
    attributes: ['id', 'name', 'web_fcm_token', 'mobile_fcm_token', 'preferences'],
  }));
  if (!user) return;
  return notifyUser(user, {
    type:  'chat_message',
    title: `New message from ${senderName || 'Someone'}`,
    body:  String(message.body || '').slice(0, 140),
    data:  { type: 'chat_message', conversation_id: String(message.conversation_id) },
    // no email for chat pings — push + in-app inbox only
  });
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
  bidCountered,
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
  // offers
  offerReceived,
  // chat
  chatMessage,
};
