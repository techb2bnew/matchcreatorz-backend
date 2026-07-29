'use strict';
/**
 * Holds the Socket.IO instance + real-time emit helpers.
 * Kept dependency-free (no service/controller requires) to avoid circular imports.
 * Both the socket handlers and the REST controllers use these so a message sent
 * via REST or via socket fans out to every device of both participants.
 */

let io = null;
const setIO = (instance) => { io = instance; };
const getIO = () => io;

const userRoom = (id) => `user:${id}`;

// New message → deliver to BOTH participants' personal rooms (all their devices).
// Clients dedupe by message id.
const emitNewMessage = ({ message, conversation, senderId, recipientId }) => {
  if (!io) return;
  const payload = { conversationId: conversation.id, message };
  io.to(userRoom(senderId)).emit('receiveMessage', payload);
  io.to(userRoom(recipientId)).emit('receiveMessage', payload);

  // Conversation-list refresh hint (last message / unread badges)
  const listHint = {
    conversationId:  conversation.id,
    last_message:    conversation.last_message,
    last_message_at: conversation.last_message_at,
    last_sender_id:  conversation.last_sender_id,
  };
  io.to(userRoom(senderId)).emit('conversationUpdated', listHint);
  io.to(userRoom(recipientId)).emit('conversationUpdated', listHint);
};

// Read receipt → tell the OTHER user (whose messages were read) to update ticks,
// and tell the reader's other devices to reset the unread badge.
const emitRead = ({ conversationId, readerId, otherId }) => {
  if (!io) return;
  io.to(userRoom(otherId)).emit('messageRead', { conversationId, readerId });
  io.to(userRoom(readerId)).emit('conversationRead', { conversationId });
};

// Typing indicators (ephemeral, not persisted)
const emitTyping = ({ conversationId, fromUserId, toUserId, typing }) => {
  if (!io) return;
  io.to(userRoom(toUserId)).emit(typing ? 'typing' : 'stopTyping', { conversationId, userId: fromUserId });
};

// Online / offline presence (broadcast; clients filter to their contacts)
const emitPresence = (userId, online) => {
  if (!io) return;
  io.emit('presence', { userId: Number(userId), online: !!online });
};

// ── Support tickets ───────────────────────────────────────────────────────────
// All admins live in the 'admins' room so queue changes fan out to every admin.
const ADMIN_ROOM = 'admins';

// New support message → the requester's room, the assigned admin's room (if any),
// and — when still unassigned — the whole admins room so the queue lights up.
const emitSupportMessage = ({ message, ticket, senderId, recipientId }) => {
  if (!io) return;
  const payload = { ticketId: ticket.id, message };
  io.to(userRoom(senderId)).emit('supportMessage', payload);
  if (recipientId) io.to(userRoom(recipientId)).emit('supportMessage', payload);
  if (!ticket.assigned_admin_id) io.to(ADMIN_ROOM).emit('supportMessage', payload);

  emitSupportTicketUpdate(ticket);
};

// Ticket meta changed (new message preview, assignment, status). Fan out to the
// requester, the assigned admin, and the admins room (queue view).
const emitSupportTicketUpdate = (ticket) => {
  if (!io) return;
  const hint = {
    ticketId:          ticket.id,
    status:            ticket.status,
    assigned_admin_id: ticket.assigned_admin_id,
    last_message:      ticket.last_message,
    last_message_at:   ticket.last_message_at,
    last_sender_id:    ticket.last_sender_id,
  };
  io.to(userRoom(ticket.user_id)).emit('supportTicketUpdated', hint);
  if (ticket.assigned_admin_id) io.to(userRoom(ticket.assigned_admin_id)).emit('supportTicketUpdated', hint);
  io.to(ADMIN_ROOM).emit('supportTicketUpdated', hint);
};

module.exports = {
  setIO, getIO, userRoom, ADMIN_ROOM,
  emitNewMessage, emitRead, emitTyping, emitPresence,
  emitSupportMessage, emitSupportTicketUpdate,
};
