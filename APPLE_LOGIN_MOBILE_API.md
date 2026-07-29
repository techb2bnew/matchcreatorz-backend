# Apple Login — Mobile App Integration

One backend endpoint handles Apple sign-in **and** sign-up (mirrors the Google login endpoint).

```
POST  {BASE_URL}/api/v1/auth/apple
Content-Type: application/json
```
No `Authorization` header needed (this is the login step itself).

---

## Step 0 — Native Sign in with Apple (on the device)

Use native **Sign in with Apple** (`AuthenticationServices` on iOS / the Apple provider in
Flutter / React Native). It returns an **identity token** (a JWT) — that's what you send us.

> **IMPORTANT (must do):** Your app's Bundle ID must have the **"Sign In with Apple"**
> capability enabled in the Apple Developer portal. The identity token's audience (`aud`)
> is your app's Bundle ID, and our backend verifies the token's `aud` against the
> `APPLE_CLIENT_ID` value configured on the server — these must match exactly, or you'll
> get `Invalid or expired Apple token`. If the app ships multiple bundle ids (e.g. a
> separate dev/staging build) the server can accept several — ask backend to add yours to
> the comma-separated `APPLE_CLIENT_ID` list.

Apple gives you **two things** on a first-ever authorization:
1. The **identity token** (always present) — send this every time.
2. A **`user`** object with the person's name/email (**only on the very first authorization,
   ever** — Apple never sends it again on subsequent logins). If your SDK gives you this,
   forward it untouched in the `user` field so the account gets a real name instead of
   falling back to the email handle.

---

## Step 1 — Send the Apple identity token

**Request body:**
```json
{
  "identity_token": "<APPLE_IDENTITY_TOKEN_FROM_NATIVE_SIGNIN>",
  "user": {
    "email": "person@example.com",
    "name": { "firstName": "Jane", "lastName": "Doe" }
  }
}
```
- `user` is **optional** — omit it entirely if your SDK didn't return one (i.e. not the
  first-ever authorization for this Apple ID).
- `id_token` is also accepted as an alias for `identity_token`, in case your SDK/plugin
  names the field that way.

**Case A — existing user → logged in (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "<JWT>",
    "role": "BUYER",
    "user": { "id": 12, "name": "Jane Doe", "email": "person@example.com", "phone": null, "role": "BUYER", "is_verified": true }
  }
}
```
→ Save `data.token`, send it as `Authorization: Bearer <token>` on all future calls.

**Case B — new user → ask role (200):**
```json
{
  "success": true,
  "message": "Apple verified",
  "data": {
    "isNew": true,
    "profile": { "email": "new@x.com", "name": "New User" }
  }
}
```
→ No `token` yet. Show a "Buyer or Seller?" screen, then do **Step 2**.

---

## Step 2 — Only for new users: send the chosen role

Send the **same** `identity_token` again plus `role` (and the same `user` object, if you had one):

**Request body:**
```json
{
  "identity_token": "<SAME_APPLE_IDENTITY_TOKEN>",
  "user": { "email": "new@x.com", "name": { "firstName": "New", "lastName": "User" } },
  "role": "BUYER"
}
```

**BUYER → account created + logged in (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "<JWT>",
    "role": "BUYER",
    "user": { "id": 33, "name": "New User", "email": "new@x.com", "phone": null, "role": "BUYER", "is_verified": true }
  }
}
```

**SELLER → account created, pending admin approval (200, no token):**
```json
{
  "success": true,
  "message": "Apple verified",
  "data": {
    "pendingApproval": true,
    "message": "Seller account created. It is pending admin approval before you can sign in."
  }
}
```
→ Show the pending-approval message; seller can log in after admin approves.

---

## Errors

| Status | Body `message` | Meaning |
|---|---|---|
| 400 | `Apple identity token is required` | `identity_token` missing |
| 400 | `Apple account has no email` | Neither the token nor `user.email` had an email (rare — Apple's private-relay email should still be present) |
| 400 | `role must be BUYER or SELLER` | bad `role` value |
| 401 | `Invalid or expired Apple token` | signature/issuer check failed, or token expired |
| 401 | `Apple token was issued for a different client` | token's `aud` doesn't match the server's `APPLE_CLIENT_ID` — check the Bundle ID / capability setup in Step 0 |
| 403 | `Account is banned` / `... pending admin approval` | blocked or unapproved seller |
| 500 | `Apple login is not configured on the server` | backend `APPLE_CLIENT_ID` not set |

---

## After login — register push token (recommended)

Once you have the JWT, register the device for push notifications:

```
PUT {BASE_URL}/api/v1/{role}/fcm-token      // role = buyer | seller
Authorization: Bearer <token>
Content-Type: application/json

{ "platform": "mobile", "token": "<FIREBASE_FCM_DEVICE_TOKEN>" }
```

On logout, clear it:
```
DELETE {BASE_URL}/api/v1/{role}/fcm-token
Authorization: Bearer <token>
{ "platform": "mobile" }
```

---

## Quick summary for the app

1. Native Sign in with Apple → get **identity token** (and the **`user`** object, but only
   on the first-ever authorization).
2. `POST /api/v1/auth/apple` with `{ identity_token, user? }`.
3. If `data.token` → logged in. If `data.isNew` → ask role → call again with
   `{ identity_token, user?, role }`.
4. If `data.pendingApproval` (seller) → show pending message.
5. Save the JWT; register mobile FCM token.
