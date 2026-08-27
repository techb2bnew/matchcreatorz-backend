'use strict';
/**
 * stripe.helper.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin wrapper around the Stripe SDK for the wallet feature:
 *   • Buyer top-ups  → Stripe Checkout (hosted redirect)
 *   • Seller payouts → Stripe Connect (Express accounts + transfers/payouts)
 *   • Webhooks       → signature verification
 *
 * All functions throw a friendly error if Stripe is not configured, so the rest
 * of the app keeps working even before the keys are set.
 */
const env = require('../config/env');

let stripe = null;
if (env.STRIPE_SECRET_KEY) {
  // eslint-disable-next-line global-require
  stripe = require('stripe')(env.STRIPE_SECRET_KEY);
}

const isEnabled = () => !!stripe;
const client = () => {
  if (!stripe) throw Object.assign(new Error('Stripe is not configured (missing STRIPE_SECRET_KEY)'), { statusCode: 500 });
  return stripe;
};

const toCents = (amount) => Math.round(Number(amount) * 100);
const fromCents = (cents) => Math.round(Number(cents)) / 100;

// ── Buyer top-up: hosted Checkout session ─────────────────────────────────────
const createTopupCheckout = async ({ amount, userId, email, successUrl, cancelUrl }) => {
  const session = await client().checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: email || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: env.WALLET_CURRENCY,
        unit_amount: toCents(amount),
        product_data: { name: 'Wallet Top-up', description: `Add funds to MatchCreatorz wallet` },
      },
    }],
    metadata: { kind: 'wallet_topup', user_id: String(userId), amount: String(amount) },
    success_url: successUrl,
    cancel_url:  cancelUrl,
  });
  return { id: session.id, url: session.url };
};

// Retrieve a session (used to confirm on return, as a webhook fallback)
const getCheckoutSession = (sessionId) => client().checkout.sessions.retrieve(sessionId);

// Same, but expands the PaymentIntent — needed to check paymentIntent.status
// (e.g. 'requires_capture') since a manual-capture session's own
// session.payment_status does NOT read 'paid' at hold-time.
const getCheckoutSessionWithIntent = (sessionId) =>
  client().checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });

// ── Escrow: whole-booking hold (manual capture) ───────────────────────────────
const createEscrowHoldCheckout = async ({ amount, booking, successUrl, cancelUrl }) => {
  const session = await client().checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    payment_intent_data: { capture_method: 'manual' },
    customer_email: booking.buyerEmail || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: env.WALLET_CURRENCY,
        unit_amount: toCents(amount),
        product_data: { name: `Escrow hold — ${booking.title}`, description: 'MatchCreatorz escrow payment (held until work is approved)' },
      },
    }],
    metadata: { kind: 'escrow_hold', booking_id: String(booking.id) },
    success_url: successUrl,
    cancel_url:  cancelUrl,
  });
  return { id: session.id, url: session.url };
};

// ── Escrow: per-milestone charge (normal auto-capture — this IS the charge) ───
const createMilestoneChargeCheckout = async ({ amount, booking, milestone, successUrl, cancelUrl }) => {
  const session = await client().checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: booking.buyerEmail || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: env.WALLET_CURRENCY,
        unit_amount: toCents(amount),
        product_data: { name: `Milestone payment — ${milestone.title}`, description: `MatchCreatorz escrow milestone charge (${booking.title})` },
      },
    }],
    metadata: { kind: 'escrow_milestone_charge', booking_id: String(booking.id), milestone_id: String(milestone.id) },
    success_url: successUrl,
    cancel_url:  cancelUrl,
  });
  return { id: session.id, url: session.url };
};

const capturePaymentIntent = (paymentIntentId) => client().paymentIntents.capture(paymentIntentId);
const cancelPaymentIntent  = (paymentIntentId) => client().paymentIntents.cancel(paymentIntentId);

// ── Seller: buy Connects (hosted Checkout session) ────────────────────────────
const createConnectsCheckout = async ({ plan, sellerId, email, successUrl, cancelUrl }) => {
  const session = await client().checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: email || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: env.WALLET_CURRENCY,
        unit_amount: toCents(plan.price),
        product_data: { name: `${plan.name} — ${plan.connects} Connects`, description: 'MatchCreatorz Connects purchase' },
      },
    }],
    metadata: {
      kind: 'connects_purchase',
      seller_id: String(sellerId),
      plan_id:   plan.id,
      plan_name: plan.name,
      connects:  String(plan.connects),
    },
    success_url: successUrl,
    cancel_url:  cancelUrl,
  });
  return { id: session.id, url: session.url };
};

// ── Stripe Connect (seller payouts) ───────────────────────────────────────────
const createConnectAccount = async ({ email, country = 'US' }) => {
  const account = await client().accounts.create({
    type: 'express',
    email: email || undefined,
    country,
    capabilities: { transfers: { requested: true } },
  });
  return account;
};

const createAccountLink = async ({ accountId, refreshUrl, returnUrl }) => {
  const link = await client().accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
  return link;
};

const retrieveAccount = (accountId) => client().accounts.retrieve(accountId);

// Move money from the platform balance to a seller's connected account, then pay
// it out to their bank. In test mode this works with test connected accounts.
const transferToConnected = async ({ amount, accountId, metadata = {} }) => {
  const transfer = await client().transfers.create({
    amount: toCents(amount),
    currency: env.WALLET_CURRENCY,
    destination: accountId,
    metadata,
  });
  return transfer;
};

// ── Webhooks ──────────────────────────────────────────────────────────────────
const constructEvent = (rawBody, signature) => {
  if (!env.STRIPE_WEBHOOK_SECRET) throw Object.assign(new Error('Webhook secret not configured'), { statusCode: 500 });
  return client().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
};

module.exports = {
  isEnabled,
  toCents,
  fromCents,
  createTopupCheckout,
  getCheckoutSession,
  getCheckoutSessionWithIntent,
  createConnectsCheckout,
  createConnectAccount,
  createAccountLink,
  retrieveAccount,
  transferToConnected,
  constructEvent,
  createEscrowHoldCheckout,
  createMilestoneChargeCheckout,
  capturePaymentIntent,
  cancelPaymentIntent,
  publishableKey: env.STRIPE_PUBLISHABLE_KEY,
};
