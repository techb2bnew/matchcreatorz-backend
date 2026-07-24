# Real-Time Chat — Mobile (React Native) Integration

The chat backend (REST + Socket.IO) is shared by **all** clients — Buyer/Seller
**Web** and Buyer/Seller **Mobile**, plus Admin Web. A message sent from any
device instantly reaches every other device of both participants, because
delivery is keyed to each user's personal socket room (`user:<id>`).

- **Base URL:** `{BASE_URL}` (e.g. `https://adminbackend.matchcreatorz.com`)
- **Auth:** the same JWT you get from login (`data.token`). Send it as
  `Authorization: Bearer <token>` on REST, and in the socket handshake `auth.token`.

---

## 1. REST APIs (history, list, fallback)

All require `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/v1/chat/conversations?page=1&limit=20` | My conversation list (other_user, last_message, unread_count) |
| POST | `/api/v1/chat/conversations` `{ "recipient_id": 5 }` | Open/create a 1:1 conversation |
| GET  | `/api/v1/chat/conversations/:id` | One conversation |
| GET  | `/api/v1/chat/conversations/:id/messages?page=1&limit=30` | History (newest-first; reverse for display) |
| POST | `/api/v1/chat/conversations/:id/messages` `{ "body": "hi" }` | Send (REST fallback if socket down) |
| PATCH| `/api/v1/chat/conversations/:id/read` | Mark all as read |
| GET  | `/api/v1/chat/unread-count` | `{ count }` total unread |
| DELETE | `/api/v1/chat/conversations/:id` | Archive (hide for me) |

Full request/response/errors are in **Swagger → "Chat"** tag at `{BASE_URL}/api-docs`.

**Permissions (enforced server-side):** Buyer↔Seller and Admin↔anyone. Same
non-admin role (buyer↔buyer / seller↔seller) is rejected (403).

---

## 2. Socket.IO connection

Use `socket.io-client` (v4). Connect **after login**, disconnect on logout.

```js
import { io } from 'socket.io-client';

const socket = io(BASE_URL, {
  transports: ['websocket'],      // RN: prefer websocket
  auth: { token: JWT_TOKEN },     // <-- required (JWT verified in handshake)
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});
```

If the token is missing/invalid the server rejects the connection
(`connect_error` with message `Auth token missing` / `Invalid or expired token`).

---

## 3. Events

### Emit (client → server)
| Event | Payload | Notes |
|---|---|---|
| `sendMessage` | `{ conversationId, body, attachment? }` | Supports ack callback: `socket.emit('sendMessage', p, (res)=>{})` → `{ ok, message }` or `{ ok:false, error }` |
| `messageRead` | `{ conversationId }` | Mark the other party's messages read |
| `typing` | `{ conversationId, recipientId }` | Show typing to the recipient |
| `stopTyping` | `{ conversationId, recipientId }` | |
| `joinConversation` | `conversationId` | Optional (personal room already delivers) |
| `leaveConversation` | `conversationId` | Optional |
| `isOnline` | `userId`, ackCb | ack → `{ userId, online }` |

### Listen (server → client)
| Event | Payload | Use |
|---|---|---|
| `receiveMessage` | `{ conversationId, message }` | New message (you receive your OWN sent messages too → **dedupe by `message.id`**) |
| `conversationUpdated` | `{ conversationId, last_message, last_message_at, last_sender_id }` | Update list preview / re-sort |
| `messageRead` | `{ conversationId, readerId }` | Other user read your messages → show "Seen" |
| `conversationRead` | `{ conversationId }` | Your other devices → reset unread badge |
| `typing` / `stopTyping` | `{ conversationId, userId }` | Typing indicator |
| `presence` | `{ userId, online }` | Online/offline of any user (filter to your contacts) |

### Message object shape
```json
{
  "id": 42, "conversation_id": 7, "sender_id": 3,
  "body": "Hello", "is_read": false,
  "created_at": "2026-07-23T10:00:00.000Z",
  "sender": { "id": 3, "name": "Shubham", "avatar": null }
}
```

---

## 4. Typical mobile flow

1. **Login** → get JWT → `connectSocket(jwt)`.
2. Load list: `GET /chat/conversations`. Show unread badges from `unread_count`.
3. Open a chat: `GET /chat/conversations/:id/messages` (reverse for display),
   then `socket.emit('joinConversation', id)` and `PATCH /chat/:id/read` +
   `socket.emit('messageRead', { conversationId: id })`.
4. Send: `socket.emit('sendMessage', { conversationId, body })`. Append the
   message when `receiveMessage` arrives (dedupe by id) — don't double-add.
5. Listen for `receiveMessage` app-wide (even off the chat screen) to update
   badges / show a local push.

---

## 5. React Native lifecycle (important)

- **Connect** once after login; keep a **single** socket instance (singleton) —
  never create duplicates on re-render.
- **Logout** → `socket.disconnect()` and null the instance.
- **AppState**:
  - `background` → you may keep the socket briefly; OS may suspend it.
  - `active` (foreground) → if `!socket.connected`, call `socket.connect()`.
- **NetInfo** (connectivity): on reconnect, socket.io auto-reconnects; on regain,
  optionally refetch the conversation list + open thread to catch missed messages.
- **Missed messages while disconnected:** socket delivers only live events, so on
  (re)connect/foreground, refetch history/unread via REST to reconcile.
- Avoid duplicate listeners: register `socket.on(...)` once (e.g., in a provider),
  remove with `socket.off(...)` on unmount.

---

## 6. Offline push (optional, already wired for FCM)

If the recipient is offline, the app still shows the message when it next fetches.
For instant background alerts, use the existing FCM token flow
(`PUT /api/v1/{role}/fcm-token`, `platform: "mobile"`) — chat can trigger a push
via the same notification system (respecting the user's "Chat Messages" setting).

---

## Quick checklist
- [ ] Login → JWT saved.
- [ ] Socket connected with `auth.token = JWT`.
- [ ] Single socket instance; reconnect on foreground; disconnect on logout.
- [ ] `receiveMessage` deduped by `message.id`.
- [ ] On open chat: mark read (REST + `messageRead`).
- [ ] Unread badge from `/chat/unread-count` + live `receiveMessage`.
