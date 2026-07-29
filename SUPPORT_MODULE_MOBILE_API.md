# Support Chat — Mobile (React Native) Integration

Support lets a **Buyer or Seller** message the **Admin team**. It is separate from
the peer-to-peer chat: the user can send the first message instantly (a *ticket*
is created), and any admin can pick it up from a shared queue and move it through
its lifecycle. Messages and queue changes are delivered in real time over the
**same Socket.IO connection** you already use for chat.

- **Base URL:** `{BASE_URL}` (e.g. `https://adminbackend.matchcreatorz.com`)
- **Auth:** the same login JWT (`data.token`) — `Authorization: Bearer <token>` on
  REST, and `auth.token` on the socket handshake (already connected for chat).
- **Full request/response/errors:** Swagger → **"Support"** tag at `{BASE_URL}/api-docs`.

> There is **no separate socket** for support. Reuse the one chat socket. You send
> support messages via REST; the server pushes the live events back to you.

---

## 1. Ticket lifecycle

```
OPEN ──(admin Accepts / replies)──▶ IN_PROGRESS ──▶ RESOLVED ──▶ CLOSED
  ▲                                                     │
  └──────────(user replies to a RESOLVED ticket)────────┘
```

| Status | Meaning |
|---|---|
| `OPEN` | User created it; not yet picked up by an admin |
| `IN_PROGRESS` | An admin accepted / replied (auto-assigns to that admin) |
| `RESOLVED` | Admin marked it solved (user can reply to reopen → OPEN) |
| `CLOSED` | Finished; **no more replies allowed** (user must open a new ticket) |

The mobile app only needs the **USER** side (open ticket, list my tickets, chat).
Admins use the web queue. The endpoints below are role-aware automatically.

---

## 2. REST APIs

All require `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| POST  | `/api/v1/support/tickets` | Open a ticket (sends the first message) |
| GET   | `/api/v1/support/tickets?page=1&limit=20` | My tickets (list) |
| GET   | `/api/v1/support/tickets/:id` | One ticket |
| GET   | `/api/v1/support/tickets/:id/messages?page=1&limit=30` | History (newest-first; reverse for display) |
| POST  | `/api/v1/support/tickets/:id/messages` | Send a message |
| PATCH | `/api/v1/support/tickets/:id/read` | Mark the admin's messages as read |
| GET   | `/api/v1/support/unread-count` | `{ count }` total unread |
| POST  | `/api/v1/support/upload` | Upload an attachment (multipart `file`) → `{ url, name, type, size }` |

### Open a ticket
```
POST /api/v1/support/tickets
{ "subject": "Payment not received", "body": "My payout is pending 3 days", "attachment": null }
```
Returns the created ticket (status `OPEN`).

### Send a message
```
POST /api/v1/support/tickets/:id/messages
{ "body": "Any update?", "attachment": { "url": "https://...", "name": "receipt.pdf" } }
```
`body` **or** `attachment` is required (attachment-only allowed).
Response: `{ data: { message, ticket } }`.

### Upload flow (attachment)
1. `POST /support/upload` with multipart field `file` → get `{ url, name, type, size }`.
2. Pass that object as `attachment` in the send-message body.

---

## 3. Socket.IO — live events (reuse the chat socket)

You do **not** emit anything for support; just **listen**. Sends go via REST and
the server fans the events back to you (and to the admins).

### Listen (server → client)
| Event | Payload | Use |
|---|---|---|
| `supportMessage` | `{ ticketId, message }` | New message on one of your tickets → append (dedupe by `message.id`) |
| `supportTicketUpdated` | `{ ticketId, status, assigned_admin_id, last_message, last_message_at, last_sender_id }` | Ticket meta changed (new preview, an admin accepted it, status moved) → update the row / header |

> You receive your **own** sent messages back on `supportMessage` too — **dedupe by
> `message.id`** so you don't show duplicates.

There are no support-specific *emit* events. (`messageRead` is handled by the
`PATCH /support/tickets/:id/read` REST call.)

---

## 4. Object shapes

### Ticket
```json
{
  "id": 12,
  "subject": "Payment not received",
  "status": "IN_PROGRESS",
  "assigned_admin_id": 3,
  "assignee":  { "id": 3, "name": "Admin Ravi", "avatar": null },
  "requester": { "id": 8, "name": "Base 2 Brand", "role": "SELLER", "avatar": null },
  "last_message": "Checking now.",
  "last_message_at": "2026-07-27T10:05:00.000Z",
  "last_sender_id": 3,
  "unread_count": 1,
  "created_at": "2026-07-27T09:40:00.000Z"
}
```

### Message
```json
{
  "id": 88,
  "ticket_id": 12,
  "sender_id": 3,
  "sender_role": "ADMIN",           // "USER" or "ADMIN" — style the bubble side
  "body": "Checking now.",
  "attachment": null,               // or { url, name, type, size }
  "is_read": false,
  "created_at": "2026-07-27T10:05:00.000Z",
  "sender": { "id": 3, "name": "Admin Ravi", "avatar": null }
}
```

Bubble side: a message is **mine** when `message.sender_id === myUserId`
(equivalently, for the user app, `sender_role === 'USER'` = right/me,
`'ADMIN'` = left/support).

---

## 5. Typical mobile flow (USER)

1. **Support screen open** → `GET /support/tickets`. Show list with `subject`,
   `last_message`, `status` badge and `unread_count`.
2. **New ticket** → `POST /support/tickets { subject?, body }`. Prepend the returned
   ticket and open it.
3. **Open a ticket** → `GET /support/tickets/:id/messages` (reverse for display),
   then `PATCH /support/tickets/:id/read` to clear unread.
4. **Send** → `POST /support/tickets/:id/messages { body }`. Append the returned
   `message` immediately (you'll also get it on `supportMessage` — dedupe by id).
5. **Live updates** → listen `supportMessage` (append + if the screen is open, call
   read again) and `supportTicketUpdated` (update the status badge / "handled by …").
6. **Badges** → total from `GET /support/unread-count`; per-ticket from
   `unread_count` in the list; bump on `supportMessage` when the screen is closed.

### Status handling in the UI
- Show a colored badge: OPEN (amber), IN_PROGRESS (blue), RESOLVED (green), CLOSED (grey).
- If `status === 'CLOSED'` → disable the composer and show "This ticket is closed.
  Open a new ticket to continue."
- A user reply to a `RESOLVED` ticket reopens it (server sets it back to `OPEN`).

---

## 6. Push notifications (already wired)

Support pings use the existing FCM token flow (`PUT /api/v1/{role}/fcm-token`,
`platform: "mobile"`). They are **always delivered** (support is important — not
gated by the chat toggle). Payload `data`:
```json
{ "type": "support_message", "ticket_id": "12" }
```
On tap, deep-link to that ticket (`/support` → open ticket `ticket_id`).

---

## Quick checklist
- [ ] Reuse the single chat socket (no new connection).
- [ ] Open ticket → `POST /support/tickets`.
- [ ] List → `GET /support/tickets`; open → messages + `PATCH …/read`.
- [ ] Send → `POST …/messages`; append & dedupe by `message.id`.
- [ ] Listen `supportMessage` + `supportTicketUpdated`.
- [ ] Status badge; disable composer when `CLOSED`.
- [ ] Handle push `type: "support_message"` → open `ticket_id`.
