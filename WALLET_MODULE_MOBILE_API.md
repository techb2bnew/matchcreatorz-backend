# Wallet & Payments — Mobile (React Native) Integration

The wallet powers all money in MatchCreatorz:

- **Buyer** tops up a wallet via **Stripe Checkout**, and pays for bookings from
  that balance (held in **escrow** until the work is accepted).
- **Seller** earns on completed bookings (amount − platform fee) and **withdraws**
  via **Stripe Connect** (admin approves → payout to their bank).
- **Admin** sees platform revenue and approves/rejects withdrawals.

- **Base URL:** `{BASE_URL}` (e.g. `https://adminbackend.matchcreatorz.com`)
- **Auth:** the login JWT — `Authorization: Bearer <token>` on every endpoint.
- **Full schemas:** Swagger → **"Wallet"** tag at `{BASE_URL}/api-docs`.
- Amounts are decimals in the wallet currency (default `usd`).

---

## 1. Money flow (important to understand)

```
Buyer top-up (Stripe) ──▶ Buyer wallet balance
Create booking        ──▶ amount DEBITED from buyer, held in escrow (payment_status = held)
Buyer accepts work    ──▶ seller CREDITED (amount − fee)  +  platform keeps fee   (released)
Booking cancelled     ──▶ amount REFUNDED to buyer                                 (refunded)
Seller withdraw        ──▶ request (pending) ──▶ admin approves ──▶ Stripe payout   (paid)
```

- Platform fee is **{PLATFORM_FEE_PERCENT}%** (see `GET /wallet/config`).
- A booking can only be created if the buyer has enough balance — otherwise the
  API returns **402** and the app should prompt a top-up.

---

## 2. Common endpoints (all roles)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/wallet` | My wallet summary `{ balance, pending_withdraw, total_in, total_out, currency, connected }` |
| GET | `/api/v1/wallet/config` | `{ publishable_key, stripe_enabled, fee_percent, min_withdraw, currency }` |
| GET | `/api/v1/wallet/transactions?page=1&limit=20&type=` | Ledger (newest first) |

Transaction `type` values: `topup`, `booking_payment`, `booking_refund`, `earning`,
`platform_fee`, `withdrawal`, `withdrawal_reversal`, `adjustment`.
`amount` is **positive = credit**, **negative = debit**; `balance_after` is the running balance.

---

## 3. Buyer — top up (Stripe Checkout)

```
POST /api/v1/wallet/topup
{ "amount": 100, "success_url": "myapp://wallet?topup=success", "cancel_url": "myapp://wallet?topup=cancel" }
→ { "url": "https://checkout.stripe.com/...", "session_id": "cs_test_..." }
```

Mobile flow:
1. Call `topup` with the amount (and optional deep-link URLs for return).
2. Open `url` in an in-app browser / Custom Tab / `Linking.openURL`.
3. After payment, Stripe redirects to `success_url`. On return, call:
   ```
   GET /api/v1/wallet/topup/confirm?session_id=<session_id>
   ```
   (Fallback confirm; the balance is also credited automatically by the Stripe
   webhook, so just refresh `GET /wallet` after returning.)
4. Refresh wallet + transactions.

> Don't try to collect card details in the app — Stripe Checkout is hosted and
> handles PCI. You only open the returned URL.

---

## 4. Seller — earnings & withdrawal (Stripe Connect)

Earnings are credited automatically when a buyer accepts the work (`earning`
transaction). To cash out, the seller must first connect a payout account.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/wallet/connect/onboard` | → `{ url }` — open it to complete Stripe onboarding |
| GET  | `/api/v1/wallet/connect/status` | Refresh + returns wallet summary incl. `connected: true/false` |
| POST | `/api/v1/wallet/withdraw` `{ "amount": 200 }` | Request a withdrawal (pending admin approval) |
| GET  | `/api/v1/wallet/withdrawals?page=1&limit=20` | My withdrawal requests + statuses |

Withdrawal statuses: `pending` → `paid` (approved) / `rejected` (funds returned) / `failed`.

Mobile flow:
1. `GET /wallet/connect/status` → if `connected` is false, show "Connect payout account".
2. `POST /wallet/connect/onboard` → open `url` (Stripe onboarding). On return, call
   `connect/status` again to refresh.
3. When connected and `balance >= min_withdraw`, allow `POST /wallet/withdraw`.
4. Show the withdrawal list with live status badges.

Errors to handle: 400 "Connect your payout account before withdrawing",
400 "Minimum withdrawal is X", 400 "Insufficient balance".

---

## 5. Booking payments (escrow)

You don't call a separate "pay" endpoint — booking creation itself debits the
wallet. When creating a booking (`POST /api/v1/buyer/...` booking endpoint):

- If balance is enough → booking is created with `payment_status: "held"`.
- If not → **402** with a message; prompt the buyer to top up, then retry.

Each booking now returns a `payment_status`: `unpaid | held | released | refunded`.
Refunds (cancel/dispute) land back in the buyer wallet automatically as a
`booking_refund` transaction.

---

## 6. Admin (if the app has an admin view)

| Method | Path | Purpose |
|---|---|---|
| GET   | `/api/v1/wallet/admin/overview` | Platform revenue, escrow held, pending/paid withdrawals |
| GET   | `/api/v1/wallet/admin/withdrawals?status=pending` | Queue of withdrawal requests |
| PATCH | `/api/v1/wallet/admin/withdrawals/:id/approve` | Approve → Stripe payout |
| PATCH | `/api/v1/wallet/admin/withdrawals/:id/reject` `{ note }` | Reject → refund seller |
| POST  | `/api/v1/wallet/admin/adjust` `{ user_id, amount, note }` | Manual credit/debit |

---

## Quick checklist (mobile)
- [ ] Show balance from `GET /wallet`; ledger from `/wallet/transactions`.
- [ ] Top up → `POST /wallet/topup` → open `url` → on return `GET /wallet`.
- [ ] Booking create may return **402** → prompt top-up.
- [ ] Seller: `connect/status` → onboard if not connected → `withdraw`.
- [ ] Poll `GET /wallet` / withdrawals after returning from any Stripe redirect.
