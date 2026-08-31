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

const { sendPush, sendWebPush, sendMulticastPush } = require('./firebase.helper');
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
  if (
    type === 'connects_added' || type.includes('payment') || type.includes('payout') ||
    ['withdrawal_paid', 'withdrawal_rejected', 'withdrawal_failed'].includes(type)
  ) return 'payAlert';
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

const buyerApproved = (buyer) => notifyUser(buyer, {
  type: 'buyer_approved', title: 'Account Approved! 🎉',
  body: 'Congratulations! Your buyer account has been approved. Start posting jobs now.',
  data: { type: 'buyer_approved' },
  email: () => email.sendBuyerApproved(buyer.email, buyer.name),
});

const buyerRejected = (buyer) => notifyUser(buyer, {
  type: 'buyer_rejected', title: 'Account Update',
  body: 'Your buyer account application has been reviewed. Please check your email for details.',
  data: { type: 'buyer_rejected' },
  email: () => email.sendBuyerRejected(buyer.email, buyer.name),
});

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

// Hourly work entries — one dated submission at a time within an hourly booking.
const workEntrySubmitted = (buyer, booking, entry) => notifyUser(buyer, {
  type: 'work_submitted', title: 'Hours Logged for Review',
  body: `The seller logged ${entry.hours}h on ${entry.work_date} for "${booking.title}". Please review.`,
  data: { type: 'work_submitted', booking_id: String(booking.id), work_entry_id: String(entry.id) },
});

// `recipient` is whoever needs to respond next — the counter came from the
// *other* party. `byRole` customizes the wording (mirrors notify.bidCountered).
const workEntryCountered = (recipient, booking, entry, byRole) => notifyUser(recipient, {
  type: 'bid_countered', title: `${byRole === 'buyer' ? 'Buyer' : 'Seller'} Countered the Hours 🔁`,
  body: `${byRole === 'buyer' ? 'The buyer' : 'The seller'} offered ${entry.counter_hours}h instead of ${entry.hours}h on "${booking.title}".`,
  data: { type: 'bid_countered', booking_id: String(booking.id), work_entry_id: String(entry.id) },
});

// Fired once a work entry is actually settled — from the Buyer's approve, the
// Seller's accept-counter, or an Admin's dispute resolution alike.
const workEntryPaid = (seller, booking, entry) => notifyUser(seller, {
  type: 'work_accepted', title: 'Payment Received 🎉',
  body: `You were paid for ${entry.hours}h on "${booking.title}".`,
  data: { type: 'work_accepted', booking_id: String(booking.id), work_entry_id: String(entry.id) },
});

// Milestones — same bidirectional-counter negotiation as work entries, on a
// submitted stage amount instead of logged hours.
const milestoneCountered = (recipient, booking, milestone, byRole) => notifyUser(recipient, {
  type: 'bid_countered', title: `${byRole === 'buyer' ? 'Buyer' : 'Seller'} Countered the Amount 🔁`,
  body: `${byRole === 'buyer' ? 'The buyer' : 'The seller'} offered $${milestone.counter_amount} instead of $${milestone.amount} for "${milestone.title}".`,
  data: { type: 'bid_countered', booking_id: String(booking.id), milestone_id: String(milestone.id) },
});

// Whole-booking escrow hold is a manual-capture PaymentIntent — Stripe
// auto-cancels it ~7 days after creation if never captured. One-time reminder.
const escrowExpiringSoon = (buyer, booking) => notifyUser(buyer, {
  type: 'booking_payment', title: 'Escrow Hold Expiring Soon ⏳',
  body: `Your escrow payment for "${booking.title}" will expire soon unless the work is accepted. Please review and accept if it's ready.`,
  data: { type: 'escrow_expiring', booking_id: String(booking.id) },
});

// Either party can split a booking into milestones — notify whichever one
// didn't set them up.
const milestonesSetup = (recipient, booking, byRole) => notifyUser(recipient, {
  type: 'booking_created', title: 'Booking Split into Milestones',
  body: `${byRole === 'buyer' ? 'The buyer' : 'The seller'} split "${booking.title}" into milestones. Review the stages.`,
  data: { type: 'booking_created', booking_id: String(booking.id) },
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

// Admin approved a withdrawal → real Stripe transfer sent to the seller's connected account
const withdrawalPaid = (seller, withdrawal) => notifyUser(seller, {
  type: 'withdrawal_paid', title: 'Withdrawal Approved 💸',
  body: `Your withdrawal of $${withdrawal.amount} has been approved and sent to your bank account via Stripe.`,
  data: { type: 'withdrawal_paid', withdrawal_id: String(withdrawal.id) },
});

// Admin rejected a withdrawal → funds returned to the seller's wallet
const withdrawalRejected = (seller, withdrawal, note) => notifyUser(seller, {
  type: 'withdrawal_rejected', title: 'Withdrawal Rejected',
  body: `Your withdrawal request of $${withdrawal.amount} was rejected${note ? `: ${note}` : ''}. The amount has been returned to your wallet.`,
  data: { type: 'withdrawal_rejected', withdrawal_id: String(withdrawal.id) },
});

// Stripe transfer itself failed after admin approval — funds stay in the wallet
const withdrawalFailed = (seller, withdrawal, reason) => notifyUser(seller, {
  type: 'withdrawal_failed', title: 'Withdrawal Failed ⚠️',
  body: `We couldn't process your withdrawal of $${withdrawal.amount}${reason ? `: ${reason}` : ''}. The amount is still in your wallet.`,
  data: { type: 'withdrawal_failed', withdrawal_id: String(withdrawal.id) },
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

// Support ticket message → always delivered (support is important; not gated by
// the chat toggle). Push + in-app inbox only, no email.
const supportMessage = async (recipientId, senderName, message, ticketId) => {
  const user = await ff(User.findByPk(recipientId, {
    attributes: ['id', 'name', 'web_fcm_token', 'mobile_fcm_token', 'preferences'],
  }));
  if (!user) return;
  return notifyUser(user, {
    type:  'support_message',
    title: `Support: ${senderName || 'New message'}`,
    body:  String(message.body || '').slice(0, 140),
    data:  { type: 'support_message', ticket_id: String(ticketId) },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// → ADMIN  (broadcast to every admin user; used for anything the ops team
//   needs to act on: support queue, withdrawal requests, disputes, new sellers)
// ─────────────────────────────────────────────────────────────────────────────

const notifyAdmins = async ({ type, title, body, data = {} }) => {
  const admins = await ff(User.findAll({
    where: { role: 'ADMIN' },
    attributes: ['id', 'name', 'web_fcm_token', 'mobile_fcm_token', 'preferences'],
  }));
  if (!Array.isArray(admins) || !admins.length) return;
  await Promise.all(admins.map((a) => notifyUser(a, { type, title, body, data })));
};

// Support ticket with no assigned admin yet → notify EVERY admin (push + inbox),
// so a new request / an unassigned reply reaches the whole support team.
const supportToAdmins = (senderName, message, ticketId, isNew = false) => notifyAdmins({
  type:  'support_message',
  title: isNew ? `New support ticket from ${senderName || 'a user'}` : `Support reply from ${senderName || 'a user'}`,
  body:  String(message.body || (message.attachment ? '📎 Attachment' : '')).slice(0, 140),
  data:  { type: 'support_message', ticket_id: String(ticketId) },
});

// Seller requested a withdrawal → admin needs to approve/reject it
const withdrawalRequested = (sellerName, withdrawal) => notifyAdmins({
  type:  'withdrawal_requested',
  title: 'New Withdrawal Request',
  body:  `${sellerName || 'A seller'} requested a withdrawal of $${withdrawal.amount}`,
  data:  { type: 'withdrawal_requested', withdrawal_id: String(withdrawal.id) },
});

// Buyer raised a dispute on a booking → admin resolves it
const disputeRaisedAdmin = (buyerName, booking) => notifyAdmins({
  type:  'dispute_raised',
  title: 'Dispute Raised ⚠️',
  body:  `${buyerName || 'A buyer'} raised a dispute on booking "${booking.title}"`,
  data:  { type: 'dispute_raised', booking_id: String(booking.id) },
});

// New seller signed up → awaiting admin approval
const sellerRegistered = (seller) => notifyAdmins({
  type:  'seller_registered',
  title: 'New Seller Signup',
  body:  `${seller.name} registered as a seller and is awaiting approval.`,
  data:  { type: 'seller_registered', seller_id: String(seller.id) },
});

// New buyer signed up → awaiting admin approval
const buyerRegistered = (buyer) => notifyAdmins({
  type:  'buyer_registered',
  title: 'New Buyer Signup',
  body:  `${buyer.name} registered as a buyer and is awaiting approval.`,
  data:  { type: 'buyer_registered', buyer_id: String(buyer.id) },
});

// User submitted feedback from Settings → Send Feedback
const feedbackReceived = (userName, feedback) => notifyAdmins({
  type:  'feedback_received',
  title: 'New Feedback Received',
  body:  `${userName || 'A user'} sent feedback${feedback.subject ? `: "${feedback.subject}"` : ''}`,
  data:  { type: 'feedback_received', feedback_id: String(feedback.id) },
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN → BROADCAST  (announcement fanned out to a whole audience)
// Always delivered (no preference gate) — same tier as account-status events.
// Bulk-inserts the in-app inbox row in one query, then fans out push: web
// tokens one at a time (no multicast API for Web Push), mobile tokens via
// FCM's multicast endpoint in chunks of 500 (its per-request cap).
// ─────────────────────────────────────────────────────────────────────────────

const MULTICAST_CHUNK = 500;

const broadcastAnnouncement = async (users, { title, body, data = {} } = {}) => {
  if (!Array.isArray(users) || !users.length) return;

  await ff(Notification.bulkCreate(
    users.map((u) => ({ user_id: u.id, title, body, type: 'broadcast', data }))
  ));

  const webTokens    = users.map((u) => u.web_fcm_token).filter(Boolean);
  const mobileTokens = users.map((u) => u.mobile_fcm_token).filter(Boolean);

  await ff(Promise.all(webTokens.map((t) => sendWebPush(t, title, body, data))));

  for (let i = 0; i < mobileTokens.length; i += MULTICAST_CHUNK) {
    await ff(sendMulticastPush(mobileTokens.slice(i, i + MULTICAST_CHUNK), title, body, data));
  }
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
  buyerApproved,
  buyerRejected,
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
  workEntrySubmitted,
  workEntryCountered,
  workEntryPaid,
  milestoneCountered,
  milestonesSetup,
  escrowExpiringSoon,
  bookingCancelledBySeller,
  bookingCancelledByBuyer,
  // reviews
  reviewReceived,
  // connects
  connectsAdded,
  // withdrawals (seller-facing)
  withdrawalPaid,
  withdrawalRejected,
  withdrawalFailed,
  // offers
  offerReceived,
  // chat
  chatMessage,
  // support
  supportMessage,
  supportToAdmins,
  // admin
  notifyAdmins,
  withdrawalRequested,
  disputeRaisedAdmin,
  sellerRegistered,
  buyerRegistered,
  feedbackReceived,
  // broadcast
  broadcastAnnouncement,
};
