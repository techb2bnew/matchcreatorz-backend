'use strict';
const { Op } = require('sequelize');
const { Conversation, Message, User, Bid, Job, Offer, Booking } = require('../../models');
const notify = require('../../helpers/notification.helper');

// Business rule (Option B): a Buyer and Seller may chat only if they already have
// a relationship — a bid on the buyer's job, an offer, or a booking between them.
// Admin ↔ anyone is always allowed (checked before this).
const hasRelationship = async (buyerId, sellerId) => {
  const [booking, offer, bid] = await Promise.all([
    Booking.count({ where: { buyer_id: buyerId, seller_id: sellerId }, paranoid: false }).catch(() => 0),
    Offer.count({ where: { buyer_id: buyerId, seller_id: sellerId }, paranoid: false }).catch(() => 0),
    Bid.count({
      where:   { seller_id: sellerId },
      include: [{ model: Job, as: 'job', attributes: [], where: { buyer_id: buyerId }, required: true }],
      paranoid: false,
    }).catch(() => 0),
  ]);
  return (booking + offer + bid) > 0;
};

// ── Permissions ──────────────────────────────────────────────────────────────
// Business rule:
//   ADMIN  can chat with anyone (BUYER / SELLER)
//   BUYER  can chat with SELLER or ADMIN
//   SELLER can chat with BUYER  or ADMIN
//   Same non-admin role (buyer↔buyer, seller↔seller) is NOT allowed.
const canChat = (roleA, roleB) => {
  if (!roleA || !roleB) return false;
  if (roleA === 'ADMIN' || roleB === 'ADMIN') return true;
  return (roleA === 'BUYER' && roleB === 'SELLER') ||
         (roleA === 'SELLER' && roleB === 'BUYER');
};

// Normalised participant slots (smaller id = slot "one")
const slots = (a, b) => (Number(a) < Number(b)
  ? { one: Number(a), two: Number(b) }
  : { one: Number(b), two: Number(a) });

// Which slot is this user in a conversation?
const slotOf = (conv, userId) => (conv.user_one_id === Number(userId) ? 'one' : 'two');
const otherIdOf = (conv, userId) => (conv.user_one_id === Number(userId) ? conv.user_two_id : conv.user_one_id);

const USER_ATTRS = ['id', 'name', 'email', 'role', 'avatar'];

// ── Find or create a 1:1 conversation ────────────────────────────────────────
const openConversation = async (me, recipientId) => {
  if (Number(recipientId) === Number(me.id))
    throw { statusCode: 400, message: 'You cannot start a conversation with yourself' };

  const recipient = await User.findByPk(recipientId, { attributes: ['id', 'name', 'email', 'role', 'status'] });
  if (!recipient) throw { statusCode: 404, message: 'Recipient not found' };
  if (recipient.status === 'banned' || recipient.status === 'inactive')
    throw { statusCode: 400, message: 'This user is not available for chat' };

  if (!canChat(me.role, recipient.role))
    throw { statusCode: 403, message: 'You are not allowed to chat with this user' };

  // Option B gating: buyer↔seller must already have a bid / offer / booking.
  // (Admin conversations skip this check.)
  if (me.role !== 'ADMIN' && recipient.role !== 'ADMIN') {
    const buyerId  = me.role === 'BUYER' ? me.id : recipient.id;
    const sellerId = me.role === 'SELLER' ? me.id : recipient.id;
    const related  = await hasRelationship(buyerId, sellerId);
    if (!related)
      throw { statusCode: 403, message: 'You can chat only after a bid, offer or booking exists between you' };
  }

  const { one, two } = slots(me.id, recipient.id);
  const [conv] = await Conversation.findOrCreate({
    where:    { user_one_id: one, user_two_id: two },
    defaults: { user_one_id: one, user_two_id: two },
  });

  return getConversationById(me, conv.id);
};

// ── Single conversation (with participants), membership-checked ───────────────
const getConversationById = async (me, conversationId) => {
  const conv = await Conversation.findByPk(conversationId, {
    include: [
      { model: User, as: 'userOne', attributes: USER_ATTRS },
      { model: User, as: 'userTwo', attributes: USER_ATTRS },
    ],
  });
  if (!conv) throw { statusCode: 404, message: 'Conversation not found' };
  if (conv.user_one_id !== Number(me.id) && conv.user_two_id !== Number(me.id))
    throw { statusCode: 403, message: 'You are not a participant of this conversation' };

  return shapeConversation(conv, me.id);
};

// Flatten a conversation for the current user's perspective
const shapeConversation = (conv, meId) => {
  const slot  = slotOf(conv, meId);
  const other = slot === 'one' ? conv.userTwo : conv.userOne;
  return {
    id:              conv.id,
    other_user:      other ? { id: other.id, name: other.name, role: other.role, avatar: other.avatar } : null,
    last_message:    conv.last_message,
    last_message_at: conv.last_message_at || conv.updatedAt,
    last_sender_id:  conv.last_sender_id,
    unread_count:    slot === 'one' ? conv.unread_one : conv.unread_two,
    updated_at:      conv.updatedAt,
  };
};

// ── List my conversations (paginated, newest activity first) ──────────────────
const listConversations = async (me, { page = 1, limit = 20 }) => {
  const offset = (Number(page) - 1) * Number(limit);
  const archivedCol = null; // (archived filter handled per-slot below)

  const { count, rows } = await Conversation.findAndCountAll({
    where: {
      [Op.or]: [{ user_one_id: me.id }, { user_two_id: me.id }],
    },
    include: [
      { model: User, as: 'userOne', attributes: USER_ATTRS },
      { model: User, as: 'userTwo', attributes: USER_ATTRS },
    ],
    order:  [['last_message_at', 'DESC NULLS LAST'], ['updated_at', 'DESC']],
    limit:  Number(limit),
    offset,
  });
  void archivedCol;

  return {
    data:  rows.map((c) => shapeConversation(c, me.id)),
    total: count,
    page:  Number(page),
    limit: Number(limit),
  };
};

// ── Message history (paginated, newest first; client reverses for display) ────
const getMessages = async (me, conversationId, { page = 1, limit = 30 }) => {
  const conv = await Conversation.findByPk(conversationId);
  if (!conv) throw { statusCode: 404, message: 'Conversation not found' };
  if (conv.user_one_id !== Number(me.id) && conv.user_two_id !== Number(me.id))
    throw { statusCode: 403, message: 'You are not a participant of this conversation' };

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Message.findAndCountAll({
    where:   { conversation_id: conversationId },
    include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] }],
    order:   [['created_at', 'DESC']],
    limit:   Number(limit),
    offset,
  });

  return {
    data:  rows,          // newest-first; frontend can reverse
    total: count,
    page:  Number(page),
    limit: Number(limit),
  };
};

// ── Create a message (used by REST fallback and the socket layer) ─────────────
// Returns { message, conversation, recipientId } so the caller can emit sockets.
const createMessage = async (me, conversationId, body, attachment = null) => {
  const text = String(body || '').trim();
  if (!text && !attachment)
    throw { statusCode: 400, message: 'Message body or attachment is required' };

  const conv = await Conversation.findByPk(conversationId);
  if (!conv) throw { statusCode: 404, message: 'Conversation not found' };
  if (conv.user_one_id !== Number(me.id) && conv.user_two_id !== Number(me.id))
    throw { statusCode: 403, message: 'You are not a participant of this conversation' };

  const message = await Message.create({
    conversation_id: conv.id,
    sender_id:       me.id,
    body:            text,                // may be '' for attachment-only
    attachment:      attachment || null,
  });

  // Bump the OTHER participant's unread counter + update preview
  const meSlot = slotOf(conv, me.id);
  const bump   = meSlot === 'one' ? { unread_two: conv.unread_two + 1 } : { unread_one: conv.unread_one + 1 };
  await conv.update({
    last_message:    (text || '📎 Attachment').slice(0, 300),
    last_message_at: message.createdAt || new Date(),
    last_sender_id:  me.id,
    ...bump,
    // un-archive for the recipient so a new message resurfaces the thread
    ...(meSlot === 'one' ? { archived_two: false } : { archived_one: false }),
  });

  const full = await Message.findByPk(message.id, {
    include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] }],
  });

  const recipientId = otherIdOf(conv, me.id);

  // Push + in-app inbox notification (respects recipient's "Chat Messages" toggle; no email).
  // Fire-and-forget so a notification failure never blocks message delivery.
  notify.chatMessage(recipientId, full.sender?.name, full).catch(() => {});

  return { message: full, conversation: conv, recipientId };
};

// ── Mark all messages in a conversation as read (by the current user) ─────────
const markRead = async (me, conversationId) => {
  const conv = await Conversation.findByPk(conversationId);
  if (!conv) throw { statusCode: 404, message: 'Conversation not found' };
  if (conv.user_one_id !== Number(me.id) && conv.user_two_id !== Number(me.id))
    throw { statusCode: 403, message: 'You are not a participant of this conversation' };

  // Mark the OTHER party's messages as read
  await Message.update(
    { is_read: true, read_at: new Date() },
    { where: { conversation_id: conv.id, sender_id: { [Op.ne]: me.id }, is_read: false } }
  );

  // Reset my unread counter
  const meSlot = slotOf(conv, me.id);
  await conv.update(meSlot === 'one' ? { unread_one: 0 } : { unread_two: 0 });

  return { conversation: conv, readerId: Number(me.id), otherId: otherIdOf(conv, me.id) };
};

// ── Total unread across all conversations ─────────────────────────────────────
const getUnreadCount = async (me) => {
  const rows = await Conversation.findAll({
    where: { [Op.or]: [{ user_one_id: me.id }, { user_two_id: me.id }] },
    attributes: ['user_one_id', 'user_two_id', 'unread_one', 'unread_two'],
    raw: true,
  });
  let total = 0;
  for (const c of rows) {
    total += (c.user_one_id === Number(me.id) ? c.unread_one : c.unread_two) || 0;
  }
  return total;
};

// ── Archive a conversation for the current user (soft, per-participant) ────────
const archiveConversation = async (me, conversationId) => {
  const conv = await Conversation.findByPk(conversationId);
  if (!conv) throw { statusCode: 404, message: 'Conversation not found' };
  if (conv.user_one_id !== Number(me.id) && conv.user_two_id !== Number(me.id))
    throw { statusCode: 403, message: 'You are not a participant of this conversation' };
  const meSlot = slotOf(conv, me.id);
  await conv.update(meSlot === 'one' ? { archived_one: true } : { archived_two: true });
  return { archived: true };
};

module.exports = {
  canChat,
  openConversation,
  getConversationById,
  listConversations,
  getMessages,
  createMessage,
  markRead,
  getUnreadCount,
  archiveConversation,
  // helpers reused by the socket layer
  _slotOf: slotOf,
  _otherIdOf: otherIdOf,
};
