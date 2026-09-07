'use strict';
/**
 * escrowCom.helper.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin wrapper around the Escrow.com REST API (https://api.escrow.com/2017-09-01/,
 * sandbox at https://api.escrow-sandbox.com/2017-09-01/) — mirrors stripe.helper.js's
 * shape so services/shared/escrow.service.js can call either behind the same
 * function names.
 *
 * Escrow.com has no official Node SDK — this uses the platform's native fetch
 * (Node 18+) against their plain HTTPS + Basic Auth API.
 *
 * NOTE — needs one round of sandbox verification before go-live (see the plan's
 * "open items"): the exact response shape of a hosted-checkout ("Escrow Pay")
 * transaction create (landing_page/token field names), whether item state
 * transitions (ship/receive/accept) must be called explicitly before a
 * transaction is considered "complete", and the webhook payload shape —
 * Escrow.com's own docs don't fully spell these out and recommend re-fetching
 * the transaction server-side before trusting any webhook body, which is what
 * getTransaction() below is for.
 */
const env = require('../config/env');

const BASE_URL = env.ESCROW_COM_ENV === 'production'
  ? 'https://api.escrow.com/2017-09-01'
  : 'https://api.escrow-sandbox.com/2017-09-01';

const isEnabled = () => !!(env.ESCROW_COM_EMAIL && env.ESCROW_COM_API_KEY);

const authHeader = () =>
  'Basic ' + Buffer.from(`${env.ESCROW_COM_EMAIL}:${env.ESCROW_COM_API_KEY}`).toString('base64');

const request = async (method, path, body) => {
  if (!isEnabled())
    throw Object.assign(new Error('Escrow.com is not configured (missing ESCROW_COM_EMAIL/ESCROW_COM_API_KEY)'), { statusCode: 500 });

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': authHeader(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.description || data.message || `Escrow.com API error (${res.status})`), {
      statusCode: res.status, escrowComResponse: data,
    });
  }
  return data;
};

// ── Create a transaction + hosted pay link ("Escrow Pay") ────────────────────
// One item, one broker_fee item for the platform's cut. `amount` is what the
// buyer pays; `brokerFeeAmount` is deducted from the seller's side (mirrors
// today's computeFee/wallet.credit(seller, amount-fee) model).
const createPayTransaction = async ({
  amount, title, buyerEmail, sellerEmail, brokerFeeAmount, returnUrl, metadata = {},
}) => {
  const body = {
    parties: [
      { role: 'buyer',  customer: buyerEmail },
      { role: 'seller', customer: sellerEmail },
    ],
    currency: env.ESCROW_COM_CURRENCY,
    description: title,
    items: [
      {
        title,
        description: title,
        type: 'general_merchandise',
        inspection_period: 259200, // 3 days, seconds — buyer's post-delivery review window
        quantity: 1,
        schedule: [{
          amount: Number(amount).toFixed(2),
          payer_customer:       buyerEmail,
          beneficiary_customer: sellerEmail,
        }],
      },
      ...(brokerFeeAmount > 0 ? [{
        title: 'Platform fee',
        type: 'broker_fee',
        schedule: [{
          amount: Number(brokerFeeAmount).toFixed(2),
          payer_customer:       sellerEmail,
          beneficiary_customer: env.ESCROW_COM_BROKER_EMAIL,
        }],
      }] : []),
    ],
    return_url:    returnUrl,
    redirect_type: 'manual',
    metadata,
  };

  const data = await request('POST', '/transaction', body);
  return {
    transaction_id: data.id ?? data.transaction_id,
    landing_page:   data.landing_page,
    token:          data.token,
  };
};

const getTransaction = (transactionId) => request('GET', `/transaction/${transactionId}`);

const cancelTransaction = (transactionId) => request('PATCH', `/transaction/${transactionId}`, { status: 'cancelled' });

// ── Advance a funded transaction's item(s) to released ───────────────────────
// PROVISIONAL — Escrow.com's normal lifecycle is ship -> receive -> accept
// before funds disburse to the seller, driven by PATCH calls on each item
// subresource. Our platform is the actual proof-of-work UI (the buyer already
// approved the work in our own app before this transaction was even created),
// so this fires that whole sequence back-to-back rather than waiting on
// separate buyer/seller actions inside Escrow.com's own UI. The exact item
// id(s) to target and whether all three calls are required (vs. e.g. a
// transaction-level "release" shortcut) must be confirmed against a real
// sandbox transaction — each step is independently try/caught so a step that
// turns out to be unnecessary (already-satisfied state) doesn't abort the rest.
const releaseTransaction = async (transactionId) => {
  const txn = await getTransaction(transactionId);
  const items = txn.items || [];
  for (const item of items) {
    for (const step of ['shipped', 'received', 'accepted']) {
      try {
        await request('PATCH', `/transaction/${transactionId}/item/${item.id}`, { status: step });
      } catch (err) {
        console.error(`escrowCom.helper.releaseTransaction: item ${item.id} -> ${step} failed:`, err && err.message);
      }
    }
  }
};

// One-time setup (run manually / from an admin action, not a hot-path call).
const registerWebhook = (url) => request('POST', '/webhook', { url });

module.exports = {
  isEnabled,
  createPayTransaction,
  getTransaction,
  cancelTransaction,
  releaseTransaction,
  registerWebhook,
};
