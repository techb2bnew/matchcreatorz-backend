'use strict';
const { Op } = require('sequelize');
const { SupportTicket, SupportMessage, User } = require('../../models');
const notify  = require('../../helpers/notification.helper');
const emitter = require('../../socket/emitter');

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const USER_ATTRS = ['id', 'name', 'email', 'role', 'avatar'];

const isAdmin = (me) => me.role === 'ADMIN';

// Flatten a ticket for the API. `me` decides which unread counter is "mine".
const shapeTicket = (t, me) => ({
  id:                t.id,
  subject:           t.subject,
  status:            t.status,
  assigned_admin_id: t.assigned_admin_id,
  assignee:          t.assignee ? { id: t.assignee.id, name: t.assignee.name, avatar: t.assignee.avatar } : null,
  requester:         t.requester ? { id: t.requester.id, name: t.requester.name, role: t.requester.role, avatar: t.requester.avatar } : null,
  last_message:      t.last_message,
  last_message_at:   t.last_message_at || t.createdAt,
  last_sender_id:    t.last_sender_id,
  unread_count:      isAdmin(me) ? t.unread_admin : t.unread_user,
  created_at:        t.createdAt,
  updated_at:        t.updatedAt,
});

const withParticipants = {
  include: [
    { model: User, as: 'requester', attributes: USER_ATTRS },
    { model: User, as: 'assignee',  attributes: USER_ATTRS },
  ],
};

const loadTicket = async (id) => {
  const t = await SupportTicket.findByPk(id, withParticipants);
  if (!t) throw { statusCode: 404, message: 'Support ticket not found' };
  return t;
};

// A user may only touch their own ticket; an admin may touch any ticket.
const assertAccess = (t, me) => {
  if (isAdmin(me)) return;
  if (t.user_id !== Number(me.id))
    throw { statusCode: 403, message: 'You are not a participant of this ticket' };
};

// ── Open a ticket (buyer / seller only) ───────────────────────────────────────
const openTicket = async (me, { subject, body, attachment } = {}) => {
  if (isAdmin(me))
    throw { statusCode: 400, message: 'Admins cannot open a support ticket' };

  const text = String(body || '').trim();
  if (!text && !attachment)
    throw { statusCode: 400, message: 'A first message is required to open a ticket' };

  const ticket = await SupportTicket.create({
    user_id:      me.id,
    subject:      (subject && String(subject).trim()) || text.slice(0, 80) || 'Support request',
    status:       'OPEN',
    last_message: (text || '📎 Attachment').slice(0, 300),
    last_sender_id: me.id,
    last_message_at: new Date(),
    unread_admin: 1,
  });

  const message = await SupportMessage.create({
    ticket_id:   ticket.id,
    sender_id:   me.id,
    sender_role: 'USER',
    body:        text,
    attachment:  attachment || null,
  });

  const full = await loadTicket(ticket.id);
  const msg  = await SupportMessage.findByPk(message.id, {
    include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] }],
  });

  // Unassigned → fan out to the whole admins room (queue lights up) + push to
  // every admin so a brand-new ticket reaches the support team instantly.
  emitter.emitSupportMessage({ message: msg, ticket: full, senderId: me.id, recipientId: null });
  notify.supportToAdmins(msg.sender?.name, msg, full.id, true).catch(() => {});

  return shapeTicket(full, me);
};

// ── List: user → my tickets; admin → the queue (filterable) ───────────────────
const listTickets = async (me, { page = 1, limit = 20, status, scope } = {}) => {
  const offset = (Number(page) - 1) * Number(limit);
  const where = {};

  if (isAdmin(me)) {
    if (status && STATUSES.includes(status)) where.status = status;
    if (scope === 'mine')       where.assigned_admin_id = me.id;
    else if (scope === 'unassigned') where.assigned_admin_id = { [Op.is]: null };
    // scope 'all' (or unset) → no assignment filter
  } else {
    where.user_id = me.id;
  }

  const { count, rows } = await SupportTicket.findAndCountAll({
    where,
    ...withParticipants,
    order:  [['last_message_at', 'DESC NULLS LAST'], ['updated_at', 'DESC']],
    limit:  Number(limit),
    offset,
  });

  return {
    data:  rows.map((t) => shapeTicket(t, me)),
    total: count,
    page:  Number(page),
    limit: Number(limit),
  };
};

const getTicket = async (me, id) => {
  const t = await loadTicket(id);
  assertAccess(t, me);
  return shapeTicket(t, me);
};

// ── Message history (newest-first; client reverses for display) ───────────────
const getMessages = async (me, id, { page = 1, limit = 30 } = {}) => {
  const t = await loadTicket(id);
  assertAccess(t, me);

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await SupportMessage.findAndCountAll({
    where:   { ticket_id: id },
    include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] }],
    order:   [['created_at', 'DESC']],
    limit:   Number(limit),
    offset,
  });

  return { data: rows, total: count, page: Number(page), limit: Number(limit) };
};

// ── Add a message ─────────────────────────────────────────────────────────────
// An admin replying to an unassigned ticket auto-claims it (accept-by-reply).
const addMessage = async (me, id, body, attachment = null) => {
  const text = String(body || '').trim();
  if (!text && !attachment)
    throw { statusCode: 400, message: 'Message body or attachment is required' };

  const t = await loadTicket(id);
  assertAccess(t, me);
  if (t.status === 'CLOSED')
    throw { statusCode: 400, message: 'This ticket is closed. Open a new ticket to continue.' };

  const asAdmin = isAdmin(me);
  const patch = {
    last_message:    (text || '📎 Attachment').slice(0, 300),
    last_message_at: new Date(),
    last_sender_id:  me.id,
  };

  if (asAdmin) {
    // admin reply bumps the user's unread; auto-claim + move to IN_PROGRESS
    patch.unread_user = t.unread_user + 1;
    if (!t.assigned_admin_id) patch.assigned_admin_id = me.id;
    if (t.status === 'OPEN')  patch.status = 'IN_PROGRESS';
  } else {
    // user reply bumps the (assigned) admin's unread; reopen a resolved ticket
    patch.unread_admin = t.unread_admin + 1;
    if (t.status === 'RESOLVED') patch.status = 'OPEN';
  }

  await t.update(patch);

  const message = await SupportMessage.create({
    ticket_id:   t.id,
    sender_id:   me.id,
    sender_role: asAdmin ? 'ADMIN' : 'USER',
    body:        text,
    attachment:  attachment || null,
  });

  const fresh = await loadTicket(t.id);
  const msg   = await SupportMessage.findByPk(message.id, {
    include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] }],
  });

  // Recipient: admin→requester, user→assigned admin (may be null while unassigned)
  const recipientId = asAdmin ? fresh.user_id : fresh.assigned_admin_id;

  emitter.emitSupportMessage({ message: msg, ticket: fresh, senderId: me.id, recipientId });

  // Push + inbox (fire-and-forget).
  //  • recipient known (assigned admin ↔ user) → notify that one person
  //  • user replied but still unassigned → push to every admin (like a new ticket)
  if (recipientId) {
    notify.supportMessage(recipientId, msg.sender?.name, msg, fresh.id).catch(() => {});
  } else if (!asAdmin) {
    notify.supportToAdmins(msg.sender?.name, msg, fresh.id, false).catch(() => {});
  }

  return { message: msg, ticket: shapeTicket(fresh, me) };
};

// ── Admin: explicitly Accept / assign a ticket to self ────────────────────────
const assignTicket = async (me, id, adminId = null) => {
  if (!isAdmin(me)) throw { statusCode: 403, message: 'Only admins can assign tickets' };
  const t = await loadTicket(id);
  const target = adminId ? Number(adminId) : Number(me.id);
  await t.update({
    assigned_admin_id: target,
    status: t.status === 'OPEN' ? 'IN_PROGRESS' : t.status,
  });
  const fresh = await loadTicket(id);
  emitter.emitSupportTicketUpdate(fresh);
  return shapeTicket(fresh, me);
};

// ── Admin: change status ──────────────────────────────────────────────────────
const updateStatus = async (me, id, status) => {
  if (!isAdmin(me)) throw { statusCode: 403, message: 'Only admins can change ticket status' };
  if (!STATUSES.includes(status))
    throw { statusCode: 400, message: `status must be one of: ${STATUSES.join(', ')}` };
  const t = await loadTicket(id);
  const patch = { status };
  // Taking it out of the open queue implicitly assigns it to the acting admin
  if (status === 'IN_PROGRESS' && !t.assigned_admin_id) patch.assigned_admin_id = me.id;
  await t.update(patch);
  const fresh = await loadTicket(id);
  emitter.emitSupportTicketUpdate(fresh);
  return shapeTicket(fresh, me);
};

// ── Mark the other side's messages as read ────────────────────────────────────
const markRead = async (me, id) => {
  const t = await loadTicket(id);
  assertAccess(t, me);
  const asAdmin = isAdmin(me);
  const wantRole = asAdmin ? 'USER' : 'ADMIN';

  await SupportMessage.update(
    { is_read: true, read_at: new Date() },
    { where: { ticket_id: t.id, sender_role: wantRole, is_read: false } }
  );
  await t.update(asAdmin ? { unread_admin: 0 } : { unread_user: 0 });
  return { read: true };
};

// ── Unread badge ──────────────────────────────────────────────────────────────
const getUnreadCount = async (me) => {
  if (isAdmin(me)) {
    const rows = await SupportTicket.findAll({
      where: { assigned_admin_id: me.id },
      attributes: ['unread_admin'], raw: true,
    });
    return rows.reduce((s, r) => s + (r.unread_admin || 0), 0);
  }
  const rows = await SupportTicket.findAll({
    where: { user_id: me.id },
    attributes: ['unread_user'], raw: true,
  });
  return rows.reduce((s, r) => s + (r.unread_user || 0), 0);
};

module.exports = {
  STATUSES,
  openTicket,
  listTickets,
  getTicket,
  getMessages,
  addMessage,
  assignTicket,
  updateStatus,
  markRead,
  getUnreadCount,
};
