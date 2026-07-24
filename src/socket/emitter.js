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

module.exports = { setIO, getIO, userRoom, emitNewMessage, emitRead, emitTyping, emitPresence };
