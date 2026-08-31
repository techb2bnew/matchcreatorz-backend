# Escrow Payments — Mobile (React Native) Integration

Escrow is an **optional payment mode** that sits on top of the existing wallet
flow described in `WALLET_MODULE_MOBILE_API.md`. Read that doc first — this
one only covers what changes when a booking is in escrow mode.

- **Base URL:** `{BASE_URL}` (e.g. `https://adminbackend.matchcreatorz.com`)
- **Auth:** the login JWT — `Authorization: Bearer <token>` on every endpoint.
- Admin controls a single ON/OFF toggle (`GET /api/v1/admin/settings` →
  `escrow_settings.enabled`). The app **does not** need to check this toggle
  itself — every booking already tells you its own mode (see below).

---

## 1. What actually changes

Normally (wallet mode): buyer's pre-funded wallet balance is debited the
moment they click Accept — no card, no redirect, instant.

In escrow mode: the buyer's **card is charged directly via Stripe**, not the
wallet. The buyer's wallet balance is **never touched** for an escrow
booking. This means a couple of screens now need an extra "go pay" step
instead of an instant success state.

Every `Booking` object now carries:

```json
{
  "payment_mode": "wallet" | "escrow",
  "payment_status": "unpaid" | "held" | "released" | "refunded",
  "escrow_payment_intent_id": "pi_..." | null,
  "escrow_captured_at": "2026-08-26T11:03:30.000Z" | null
}
```

- `payment_mode` is fixed forever once the booking is created — it never
  changes mid-flow, so the app can safely check it once and branch.
- **Hourly bookings are always `wallet`** — escrow only ever applies to
  fixed-price and milestone bookings, since hourly totals aren't known
  upfront.
- If `payment_mode` is `wallet`, ignore everything below — behave exactly as
  documented in `WALLET_MODULE_MOBILE_API.md`.

Two different escrow shapes, depending on booking type:

| Booking type | When the card is charged | How many charges |
|---|---|---|
| **Fixed-price** (no milestones) | Once, right after the booking is created (a **hold** — card authorized, not charged yet). Actually captured (charged for real) when the buyer clicks Accept & Pay on the finished work. | 1 |
| **Milestone** | Each milestone is its **own separate charge**, made the moment the buyer clicks Accept & Pay on *that specific* milestone. | 1 per milestone |

---

## 2. Fixed-price flow (whole booking, no milestones)

```
Buyer accepts bid / creates booking
        │
        ▼
POST /api/v1/buyer/bookings/{id}/escrow/checkout
        │  → { "checkout_url": "https://checkout.stripe.com/...", "session_id": "cs_..." }
        ▼
Open checkout_url (in-app browser / Custom Tab / SFSafariViewController)
        │  buyer enters card, Stripe authorizes (holds) the amount
        ▼
Stripe redirects back to your deep link (success_url you passed, or the
default myapp:// scheme if you didn't override it)
        │
        ▼
GET /api/v1/buyer/bookings/{id}/escrow/confirm?session_id=cs_...
        │  (fallback only — a webhook usually confirms it first; this just
        │   covers the case where the app returns before the webhook lands)
        ▼
Refresh the booking — payment_status is now "held"
```

**Endpoint:**
```
POST /api/v1/buyer/bookings/:id/escrow/checkout
→ { "checkout_url": "https://checkout.stripe.com/...", "session_id": "cs_test_..." }
```
- 400 if the booking isn't escrow mode, or if it's already paid — call this
  again any time the buyer needs to (retry) as long as `payment_status` is
  still `"unpaid"`.

**Confirm (fallback):**
```
GET /api/v1/buyer/bookings/:id/escrow/confirm?session_id=cs_test_...
→ { "confirmed": true }
```

**Where to trigger the checkout from:**
- Right after `PATCH /api/v1/buyer/jobs/:id/bids/:bidId/accept` (buyer accepts
  a bid) — check the returned `booking.payment_mode`; if `"escrow"`, call the
  checkout endpoint immediately and open the URL instead of just showing
  "Booking created".
- Same for `PATCH /api/v1/seller/jobs/:id/bid/accept` (seller accepts the
  buyer's counter) — but that request is made by the *seller*, so there's no
  buyer session to redirect. In that case the booking just sits `unpaid`
  until the buyer opens it — show a **"Complete payment"** banner on the
  booking detail screen whenever `payment_mode: "escrow"` and
  `payment_status: "unpaid"`, wired to the same checkout endpoint.
- Same for `POST /api/v1/buyer/bookings` (direct service booking).

**Accepting the finished work — capture:**
```
PATCH /api/v1/buyer/bookings/:id/accept    (same endpoint as always)
```
- If the hold was placed and confirmed, this now **captures** the real
  charge and pays the seller — behaves like a normal Accept from the app's
  point of view, just takes slightly longer (a live Stripe call happens
  server-side).
- If the buyer never completed the hold (still `unpaid`), this returns
  **400 "Please complete the escrow payment for this booking first"** —
  on that error, call the checkout endpoint and open the URL, exactly like
  the initial flow.

---

## 3. Milestone flow — each stage is its own charge

Milestones negotiate exactly like today (submit → accept / counter / accept
counter) — nothing changes there. The only difference is **what happens the
instant the milestone gets accepted**.

```
Buyer taps "Accept & Pay" on a milestone
        │
        ▼
PATCH /api/v1/buyer/bookings/{id}/milestones/{milestoneId}/accept
        │
        ├─ wallet mode  → settles instantly, same response as today
        │
        └─ escrow mode  → { "escrow": true,
        │                    "checkout_url": "https://checkout.stripe.com/...",
        │                    "session_id": "cs_..." }
        ▼
Open checkout_url → buyer pays → Stripe redirects back
        ▼
GET /api/v1/buyer/bookings/{id}/escrow/confirm?session_id=cs_...   (fallback)
        ▼
Refresh the booking — that milestone is now "approved" / "released"
```

**Important:** check the response shape on every `.../milestones/:id/accept`
call. If it comes back with `"escrow": true`, do **not** treat it as settled
— open `checkout_url` instead. If there's no `escrow` key, it settled
normally (wallet mode, or the last legacy path).

**Seller accepting the buyer's counter-offer** (`PATCH
/api/v1/seller/bookings/:id/milestones/:milestoneId/accept-counter`): in
escrow mode this does **not** charge anyone (the seller has no card to
charge) — it just moves the milestone back to "submitted" at the agreed
amount. The buyer will see it as a normal pending milestone and pays via the
flow above.

Each milestone has its own `escrow_payment_intent_id` — a booking can have
several, one per paid stage.

---

## 4. Cancel / refund

```
PATCH /api/v1/buyer/bookings/:id/cancel
PATCH /api/v1/seller/bookings/:id/cancel
```
No request changes on the mobile side. Behind the scenes:
- If the hold was never captured → Stripe releases the authorization, **no
  charge ever reaches the buyer's card**. `payment_status` becomes
  `"refunded"` even though nothing was actually charged (kept for UI
  consistency with the wallet flow's refund label).
- Milestones already paid stay paid — cancelling only affects money that
  hasn't moved yet.

---

## 5. UI states to handle

| Booking state | What to show |
|---|---|
| `payment_mode: "escrow"`, `payment_status: "unpaid"` | "Complete payment" banner/button → opens checkout |
| `payment_mode: "escrow"`, `payment_status: "held"` | "Escrow protected" badge — payment is secured, awaiting delivery |
| `payment_mode: "escrow"`, `payment_status: "released"` | Normal completed state |
| `payment_mode: "escrow"`, `payment_status: "refunded"` | Normal cancelled state |
| Milestone with no `escrow` key in the accept response | Settled instantly — refresh and show as paid |
| Milestone accept response has `"escrow": true` | Redirect to `checkout_url`, don't mark as paid yet |

Test card in Stripe test mode: `4242 4242 4242 4242`, any future expiry, any
CVC/ZIP.

---

## Quick checklist (mobile)

- [ ] Read `booking.payment_mode` on every booking — `"wallet"` means
      nothing changes, ignore this whole doc.
- [ ] After bid-accept / booking-create, if `payment_mode: "escrow"`, call
      `POST .../escrow/checkout` and open the URL immediately.
- [ ] Show a "Complete payment" banner whenever `payment_mode: "escrow"` and
      `payment_status: "unpaid"` (covers the seller-initiated booking case).
- [ ] On `PATCH .../accept` returning 400 about escrow payment, redirect to
      checkout instead of showing a generic error.
- [ ] On milestone accept, check for `{ "escrow": true, "checkout_url" }` in
      the response before treating it as settled.
- [ ] On return from Stripe Checkout, call `GET .../escrow/confirm` as a
      fallback, then refresh the booking either way.
- [ ] Never show a "pay from wallet" option for an escrow-mode booking — the
      wallet balance is not involved.
