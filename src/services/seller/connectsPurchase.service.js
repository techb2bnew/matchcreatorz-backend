'use strict';
const { ConnectTransaction, User } = require('../../models');
const { applyConnects } = require('../../helpers/connects.helper');
const stripe = require('../../helpers/stripe.helper');
const notify = require('../../helpers/notification.helper');
const env    = require('../../config/env');

// Server-side source of truth for purchasable plans — price/connects are never
// trusted from the client, only a plan id is.
const PLANS = [
  { id: 'starter',  name: 'Starter',  price: 9.99,  connects: 30,  discount: 0  },
  { id: 'pro',      name: 'Pro',      price: 19.99, connects: 80,  discount: 15 },
  { id: 'business', name: 'Business', price: 39.99, connects: 200, discount: 20 },
];

const getPlan = (planId) => PLANS.find((p) => p.id === planId);

// Seller starts a purchase → hosted Stripe Checkout. Connects are credited when
// the `checkout.session.completed` webhook fires (or via the return fallback).
const createPurchase = async (seller, planId, { successUrl, cancelUrl } = {}) => {
  if (!stripe.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const plan = getPlan(planId);
  if (!plan) throw Object.assign(new Error('Invalid plan'), { statusCode: 400 });

  const session = await stripe.createConnectsCheckout({
    plan, sellerId: seller.id, email: seller.email,
    successUrl: successUrl || `${env.CLIENT_URL}/seller/connects?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl:  cancelUrl  || `${env.CLIENT_URL}/seller/connects?purchase=cancel`,
  });
  return { url: session.url, session_id: session.id };
};

// Idempotent credit for a completed checkout session (webhook OR return fallback).
const creditFromSession = async (session) => {
  if (!session || session.payment_status !== 'paid' || session.metadata?.kind !== 'connects_purchase')
    return { credited: false };

  const already = await ConnectTransaction.findOne({ where: { stripe_ref: session.id, type: 'purchase' } });
  if (already) return { credited: false, reason: 'already_processed' };

  const sellerId = Number(session.metadata?.seller_id);
  const connects = Number(session.metadata?.connects);
  const planName = session.metadata?.plan_name || 'Connects';
  if (!sellerId || !connects) return { credited: false, reason: 'missing_metadata' };

  const { balance } = await applyConnects(sellerId, connects, 'purchase', {
    note: `Purchased ${connects} connects (${planName} plan)`,
    stripe_ref: session.id,
  });

  const seller = await User.findByPk(sellerId, {
    attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'],
  });
  if (seller) notify.connectsAdded(seller, connects, `${planName} plan purchase`);

  return { credited: true, sellerId, connects, balance };
};

// Confirm a session by id (used by the success-return fallback if webhook is slow).
const confirmPurchase = async (sessionId) => {
  if (!stripe.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const session = await stripe.getCheckoutSession(sessionId);
  return creditFromSession(session);
};

module.exports = { PLANS, getPlan, createPurchase, creditFromSession, confirmPurchase };
