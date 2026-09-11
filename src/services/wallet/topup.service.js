'use strict';
const { WalletTransaction, User } = require('../../models');
const wallet = require('./wallet.service');
const stripe = require('../../helpers/stripe.helper');
const env    = require('../../config/env');

// Buyer starts a top-up → embedded Stripe Checkout (renders inline in our own
// page instead of redirecting to a Stripe-hosted one). Funds are credited
// when the `checkout.session.completed` webhook fires (or via the
// success-return fallback) — completion still redirects the browser to
// returnUrl, same as hosted mode's success_url, so that handling is unchanged.
const createTopup = async (user, amount, { returnUrl } = {}) => {
  if (!stripe.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const amt = wallet.round2(amount);
  if (!amt || amt <= 0) throw Object.assign(new Error('Enter a valid amount'), { statusCode: 400 });

  await wallet.ensureWallet(user.id);
  const session = await stripe.createTopupCheckout({
    amount: amt,
    userId: user.id,
    email:  user.email,
    returnUrl: returnUrl || `${env.CLIENT_URL}/buyer/wallet?topup=success&session_id={CHECKOUT_SESSION_ID}`,
  });
  return { client_secret: session.clientSecret, session_id: session.id, publishable_key: stripe.publishableKey };
};

// Idempotent credit for a completed checkout session (webhook OR return fallback).
const creditFromSession = async (session) => {
  if (!session || session.payment_status !== 'paid') return { credited: false };
  const already = await WalletTransaction.findOne({ where: { stripe_ref: session.id, type: 'topup' } });
  if (already) return { credited: false, reason: 'already_processed' };

  const userId = Number(session.metadata?.user_id);
  const amount = Number(session.metadata?.amount) || stripe.fromCents(session.amount_total);
  if (!userId || !amount) return { credited: false, reason: 'missing_metadata' };

  // Real Stripe processing fee for this charge, for the fee breakdown shown
  // on the transaction — best-effort, doesn't block crediting if unavailable.
  let stripeFee = null;
  try {
    const pi = await stripe.getPaymentIntentWithFee(session.payment_intent);
    stripeFee = stripe.extractStripeFee(pi);
  } catch (err) {
    console.error('topup.creditFromSession: failed to fetch Stripe fee:', err && err.message);
  }

  await wallet.credit(userId, amount, {
    type: 'topup', stripe_ref: session.id, note: 'Wallet top-up (Stripe)',
    gross_amount: amount, stripe_fee: stripeFee,
  });
  return { credited: true, userId, amount };
};

// Confirm a session by id (used by the success-return fallback if webhook is slow).
const confirmTopup = async (sessionId) => {
  if (!stripe.isEnabled()) throw Object.assign(new Error('Payments are not configured'), { statusCode: 500 });
  const session = await stripe.getCheckoutSession(sessionId);
  return creditFromSession(session);
};

module.exports = { createTopup, creditFromSession, confirmTopup };
