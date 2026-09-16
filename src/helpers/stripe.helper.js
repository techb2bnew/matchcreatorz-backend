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

// ── Buyer top-up: embedded Checkout session (renders inline in our own page,
// via @stripe/react-stripe-js, instead of redirecting to a Stripe-hosted
// page) — completion still redirects the browser to returnUrl, same as
// hosted mode's success_url, so existing confirm/webhook handling is
// unaffected. ─────────────────────────────────────────────────────────────
const createTopupCheckout = async ({ amount, userId, email, returnUrl }) => {
  const session = await client().checkout.sessions.create({
    ui_mode: 'embedded_page',
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
    return_url: returnUrl,
  });
  return { id: session.id, clientSecret: session.client_secret };
};

// Retrieve a session (used to confirm on return, as a webhook fallback)
const getCheckoutSession = (sessionId) => client().checkout.sessions.retrieve(sessionId);

// Same, but expands the PaymentIntent — needed to check paymentIntent.status
// (e.g. 'requires_capture') since a manual-capture session's own
// session.payment_status does NOT read 'paid' at hold-time.
const getCheckoutSessionWithIntent = (sessionId) =>
  client().checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });

// ── Escrow: generic Checkout session — every escrow-mode payment (whole
// booking, one milestone, one hourly work entry) is shaped the same way:
// hold = manual capture (nothing charged until captured later), otherwise a
// normal auto-capture charge (this IS the payment, done the moment it's paid).
// One place calling Stripe for all of them, instead of a near-duplicate
// function per entity. Embedded (see createTopupCheckout's comment above). ──
const createEscrowCheckout = async ({ amount, title, description, metadata, hold, email, returnUrl }) => {
  const session = await client().checkout.sessions.create({
    ui_mode: 'embedded_page',
    mode: 'payment',
    payment_method_types: ['card'],
    // Session metadata alone never reaches the Payment/Charge Stripe's own
    // dashboard actually shows — copying it onto payment_intent_data.metadata
    // too puts the same fee breakdown directly on that payment's own page.
    payment_intent_data: { ...(hold ? { capture_method: 'manual' } : {}), metadata },
    customer_email: email || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: env.WALLET_CURRENCY,
        unit_amount: toCents(amount),
        product_data: { name: title, description },
      },
    }],
    metadata,
    return_url: returnUrl,
  });
  return { id: session.id, clientSecret: session.client_secret };
};

// Both expand the charge's balance transaction — the only place Stripe's own
// processing fee for this payment is actually available — so callers can
// pull the real fee via extractStripeFee() without a second round trip.
const capturePaymentIntent = (paymentIntentId) =>
  client().paymentIntents.capture(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
const cancelPaymentIntent  = (paymentIntentId) => client().paymentIntents.cancel(paymentIntentId);

// For an already-captured PaymentIntent (a 'direct' escrow charge, or a
// wallet top-up) — confirmed via webhook, so we never captured it ourselves
// and need a fresh fetch to see the fee.
const getPaymentIntentWithFee = (paymentIntentId) =>
  client().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });

// Stripe's own processing fee for a charge, in dollars — null if the balance
// transaction isn't available yet (rare for card payments, but Stripe never
// guarantees it's ready the instant a charge succeeds) rather than block
// settlement on it.
const extractStripeFee = (paymentIntent) => {
  const charge = paymentIntent && paymentIntent.latest_charge;
  const bt = charge && typeof charge === 'object' ? charge.balance_transaction : null;
  if (!bt || typeof bt !== 'object' || typeof bt.fee !== 'number') return null;
  return fromCents(bt.fee);
};

// ── Seller: buy Connects (embedded Checkout session) ──────────────────────────
const createConnectsCheckout = async ({ plan, sellerId, email, returnUrl }) => {
  const session = await client().checkout.sessions.create({
    ui_mode: 'embedded_page',
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
    return_url: returnUrl,
  });
  return { id: session.id, clientSecret: session.client_secret };
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
  createEscrowCheckout,
  capturePaymentIntent,
  cancelPaymentIntent,
  getPaymentIntentWithFee,
  extractStripeFee,
  publishableKey: env.STRIPE_PUBLISHABLE_KEY,
};
