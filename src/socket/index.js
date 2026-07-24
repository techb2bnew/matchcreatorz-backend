'use strict';
const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const env        = require('../config/env');
const chat       = require('../services/chat/chat.service');
const emitter    = require('./emitter');

// userId -> Set<socketId>  (multi-device presence tracking)
const online = new Map();

const initSocket = (server) => {
  // Allowed web origins. Native mobile (React Native) sends no Origin header → always allowed.
  const allowlist = [env.CLIENT_URL, 'http://localhost:3000', 'http://localhost:3001'].filter(Boolean);
  const originCheck = (origin, cb) => {
    if (!origin) return cb(null, true);                 // mobile / same-origin / server-to-server
    if (allowlist.includes(origin)) return cb(null, true);
    if (/\.ngrok(-free)?\.(app|dev|io)$/.test(origin)) return cb(null, true);
    return cb(null, true); // chat: be permissive on origin (auth is enforced via JWT handshake)
  };

  const io = new Server(server, {
    cors: { origin: originCheck, methods: ['GET', 'POST'], credentials: true },
    pingTimeout: 25000,
    pingInterval: 20000,
  });
  emitter.setIO(io);

  // ── Auth: verify JWT from handshake (auth.token or Authorization header) ────
  io.use((socket, next) => {
    const raw = socket.handshake.auth?.token
      || (socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    if (!raw) return next(new Error('Auth token missing'));
    try {
      socket.user = jwt.verify(raw, env.JWT_SECRET); // { id, email, role }
      return next();
    } catch {
      return next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const uid = Number(socket.user.id);

    // Join personal room → every device of this user gets the same events
    socket.join(emitter.userRoom(uid));

    // Presence: mark online on first socket
    if (!online.has(uid)) { online.set(uid, new Set()); emitter.emitPresence(uid, true); }
    online.get(uid).add(socket.id);

    // Client can ask who is online (e.g., for a conversation partner)
    socket.on('isOnline', (userId, ack) => {
      if (typeof ack === 'function') ack({ userId: Number(userId), online: online.has(Number(userId)) });
    });

    // Room join/leave for a specific conversation (optional; personal rooms already cover delivery)
    socket.on('joinConversation', (conversationId) => { if (conversationId) socket.join(`conv:${conversationId}`); });
    socket.on('leaveConversation', (conversationId) => { if (conversationId) socket.leave(`conv:${conversationId}`); });

    // ── Send a message ────────────────────────────────────────────────────────
    socket.on('sendMessage', async (payload, ack) => {
      try {
        const { conversationId, body, attachment } = payload || {};
        const { message, conversation, recipientId } =
          await chat.createMessage(socket.user, conversationId, body, attachment);
        emitter.emitNewMessage({ message, conversation, senderId: uid, recipientId });
        if (typeof ack === 'function') ack({ ok: true, message });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message || 'Failed to send message' });
      }
    });

    // ── Typing indicators ──────────────────────────────────────────────────────
    socket.on('typing', ({ conversationId, recipientId } = {}) => {
      if (recipientId) emitter.emitTyping({ conversationId, fromUserId: uid, toUserId: recipientId, typing: true });
    });
    socket.on('stopTyping', ({ conversationId, recipientId } = {}) => {
      if (recipientId) emitter.emitTyping({ conversationId, fromUserId: uid, toUserId: recipientId, typing: false });
    });

    // ── Read receipts ──────────────────────────────────────────────────────────
    socket.on('messageRead', async ({ conversationId } = {}) => {
      try {
        const { conversation, readerId, otherId } = await chat.markRead(socket.user, conversationId);
        emitter.emitRead({ conversationId: conversation.id, readerId, otherId });
      } catch { /* ignore */ }
    });

    // ── Disconnect: offline when the user's LAST socket drops ───────────────────
    socket.on('disconnect', () => {
      const set = online.get(uid);
      if (!set) return;
      set.delete(socket.id);
      if (set.size === 0) { online.delete(uid); emitter.emitPresence(uid, false); }
    });
  });

  console.log('✅  Socket.IO (chat) initialised');
  return io;
};

module.exports = { initSocket };
