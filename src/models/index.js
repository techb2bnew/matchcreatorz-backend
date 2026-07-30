'use strict';
const sequelize     = require('../config/db');
const User          = require('./user.model');
const SellerProfile = require('./sellerProfile.model');
const BuyerProfile  = require('./buyerProfile.model');
const Category      = require('./category.model');
const Service       = require('./service.model');
const Job           = require('./job.model');
const Bid           = require('./bid.model');
const Booking       = require('./booking.model');
const BookingMilestone = require('./bookingMilestone.model');
const Review        = require('./review.model');
const Notification  = require('./notification.model');
const Favourite     = require('./favourite.model');
const ConnectTransaction = require('./connectTransaction.model');
const Offer         = require('./offer.model');
const AppSetting    = require('./appSetting.model');
const Conversation  = require('./conversation.model');
const Message       = require('./message.model');
const SupportTicket  = require('./supportTicket.model');
const SupportMessage = require('./supportMessage.model');
const Wallet             = require('./wallet.model');
const WalletTransaction  = require('./walletTransaction.model');
const Withdrawal         = require('./withdrawal.model');
const Feedback           = require('./feedback.model');
const Banner             = require('./banner.model');
const Page               = require('./page.model');

// ── Associations ──────────────────────────────────────────

// User ↔ SellerProfile (1:1)
User.hasOne(SellerProfile, { foreignKey: 'user_id', as: 'sellerProfile' });
SellerProfile.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// User ↔ BuyerProfile (1:1)
User.hasOne(BuyerProfile, { foreignKey: 'user_id', as: 'buyerProfile' });
BuyerProfile.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// User ↔ Services (1:many)
User.hasMany(Service, { foreignKey: 'seller_id', as: 'services' });
Service.belongsTo(User, { foreignKey: 'seller_id', as: 'seller' });

// Category ↔ Services (1:many)
Category.hasMany(Service, { foreignKey: 'category_id', as: 'services' });
Service.belongsTo(Category, { foreignKey: 'category_id', as: 'category' });

// User ↔ Jobs (1:many)
User.hasMany(Job, { foreignKey: 'buyer_id', as: 'jobs' });
Job.belongsTo(User, { foreignKey: 'buyer_id', as: 'buyer' });

// Job ↔ Bids (1:many)
Job.hasMany(Bid, { foreignKey: 'job_id', as: 'bids' });
Bid.belongsTo(Job, { foreignKey: 'job_id', as: 'job' });

// User(Seller) ↔ Bids (1:many)
User.hasMany(Bid, { foreignKey: 'seller_id', as: 'bids' });
Bid.belongsTo(User, { foreignKey: 'seller_id', as: 'seller' });

// Booking associations
User.hasMany(Booking, { foreignKey: 'buyer_id',  as: 'buyerBookings'  });
Booking.belongsTo(User, { foreignKey: 'buyer_id',  as: 'buyer'  });

User.hasMany(Booking, { foreignKey: 'seller_id', as: 'sellerBookings' });
Booking.belongsTo(User, { foreignKey: 'seller_id', as: 'seller' });

Service.hasMany(Booking, { foreignKey: 'service_id', as: 'bookings' });
Booking.belongsTo(Service, { foreignKey: 'service_id', as: 'service' });

Job.hasMany(Booking, { foreignKey: 'job_id', as: 'bookings' });
Booking.belongsTo(Job, { foreignKey: 'job_id', as: 'job' });

// Booking ↔ Milestones (1:many)
Booking.hasMany(BookingMilestone, { foreignKey: 'booking_id', as: 'milestones', onDelete: 'CASCADE' });
BookingMilestone.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });

// Review associations
User.hasMany(Review, { foreignKey: 'buyer_id',  as: 'givenReviews'    });
Review.belongsTo(User, { foreignKey: 'buyer_id',  as: 'buyer'  });

User.hasMany(Review, { foreignKey: 'seller_id', as: 'receivedReviews' });
Review.belongsTo(User, { foreignKey: 'seller_id', as: 'seller' });

Service.hasMany(Review, { foreignKey: 'service_id', as: 'reviews' });
Review.belongsTo(Service, { foreignKey: 'service_id', as: 'service' });

Booking.hasOne(Review, { foreignKey: 'booking_id', as: 'review' });
Review.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });

// User ↔ Notifications (1:many)
User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Favourites (buyer ↔ service, many:many via Favourite)
User.hasMany(Favourite, { foreignKey: 'user_id', as: 'favourites' });
Favourite.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
Service.hasMany(Favourite, { foreignKey: 'service_id', as: 'favouritedBy' });
Favourite.belongsTo(Service, { foreignKey: 'service_id', as: 'service' });

// Connect transactions (seller ledger)
User.hasMany(ConnectTransaction, { foreignKey: 'seller_id', as: 'connectTransactions' });
ConnectTransaction.belongsTo(User, { foreignKey: 'seller_id', as: 'seller' });

// Offers (seller → buyer)
User.hasMany(Offer, { foreignKey: 'seller_id', as: 'sentOffers' });
User.hasMany(Offer, { foreignKey: 'buyer_id',  as: 'receivedOffers' });
Offer.belongsTo(User, { foreignKey: 'seller_id', as: 'seller' });
Offer.belongsTo(User, { foreignKey: 'buyer_id',  as: 'buyer' });
Offer.belongsTo(Service, { foreignKey: 'service_id', as: 'service' });
Offer.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });

// Chat: Conversation ↔ Users (two participants) + Messages
Conversation.belongsTo(User, { foreignKey: 'user_one_id', as: 'userOne' });
Conversation.belongsTo(User, { foreignKey: 'user_two_id', as: 'userTwo' });
Conversation.belongsTo(User, { foreignKey: 'last_sender_id', as: 'lastSender' });

Conversation.hasMany(Message, { foreignKey: 'conversation_id', as: 'messages', onDelete: 'CASCADE' });
Message.belongsTo(Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
Message.belongsTo(User, { foreignKey: 'sender_id', as: 'sender' });

// Support tickets: requester (buyer/seller) + assigned admin + messages
User.hasMany(SupportTicket, { foreignKey: 'user_id', as: 'supportTickets' });
SupportTicket.belongsTo(User, { foreignKey: 'user_id', as: 'requester' });
SupportTicket.belongsTo(User, { foreignKey: 'assigned_admin_id', as: 'assignee' });
SupportTicket.belongsTo(User, { foreignKey: 'last_sender_id', as: 'lastSender' });

SupportTicket.hasMany(SupportMessage, { foreignKey: 'ticket_id', as: 'messages', onDelete: 'CASCADE' });
SupportMessage.belongsTo(SupportTicket, { foreignKey: 'ticket_id', as: 'ticket' });
SupportMessage.belongsTo(User, { foreignKey: 'sender_id', as: 'sender' });

// Wallet: one per user + ledger of transactions
User.hasOne(Wallet, { foreignKey: 'user_id', as: 'wallet' });
Wallet.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasMany(WalletTransaction, { foreignKey: 'user_id', as: 'walletTransactions' });
WalletTransaction.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
WalletTransaction.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });

// Withdrawals (seller cash-out)
User.hasMany(Withdrawal, { foreignKey: 'seller_id', as: 'withdrawals' });
Withdrawal.belongsTo(User, { foreignKey: 'seller_id', as: 'seller' });

// Feedback (Settings → Send Feedback)
User.hasMany(Feedback, { foreignKey: 'user_id', as: 'feedback' });
Feedback.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// ─────────────────────────────────────────────────────────

const db = {
  sequelize,
  User,
  SellerProfile,
  BuyerProfile,
  Category,
  Service,
  Job,
  Bid,
  Booking,
  BookingMilestone,
  Review,
  Notification,
  Favourite,
  ConnectTransaction,
  Offer,
  AppSetting,
  Conversation,
  Message,
  SupportTicket,
  SupportMessage,
  Wallet,
  WalletTransaction,
  Withdrawal,
  Feedback,
  Banner,
  Page,
};

module.exports = db;
