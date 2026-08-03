'use strict';
const { Op } = require('sequelize');
const { User, Broadcast } = require('../../models');
const notify = require('../../helpers/notification.helper');

const AUDIENCE_ROLES = { ALL: ['SELLER', 'BUYER'], SELLER: ['SELLER'], BUYER: ['BUYER'] };

exports.sendBroadcast = async (adminId, { title, body, audience = 'ALL' } = {}) => {
  const cleanTitle = String(title || '').trim();
  const cleanBody  = String(body || '').trim();
  if (!cleanTitle) throw Object.assign(new Error('Title is required'), { status: 400 });
  if (!cleanBody)  throw Object.assign(new Error('Message is required'), { status: 400 });

  const roles = AUDIENCE_ROLES[audience];
  if (!roles) throw Object.assign(new Error('audience must be ALL, SELLER or BUYER'), { status: 400 });

  const targets = await User.findAll({
    where: { role: { [Op.in]: roles }, status: 'active' },
    attributes: ['id', 'web_fcm_token', 'mobile_fcm_token'],
  });

  const broadcast = await Broadcast.create({
    admin_id: adminId,
    title:    cleanTitle,
    body:     cleanBody,
    audience,
    recipient_count: targets.length,
  });

  await notify.broadcastAnnouncement(targets, {
    title: cleanTitle,
    body:  cleanBody,
    data:  { type: 'broadcast', broadcast_id: String(broadcast.id) },
  });

  return broadcast;
};

exports.listBroadcasts = async ({ page = 1, limit = 20 } = {}) => {
  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Broadcast.findAndCountAll({
    include: [{ model: User, as: 'admin', attributes: ['id', 'name'] }],
    order:   [['created_at', 'DESC']],
    limit:   Number(limit),
    offset,
  });
  return { data: rows, total: count, page: Number(page), limit: Number(limit) };
};
