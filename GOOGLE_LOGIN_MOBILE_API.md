# Google Login — Mobile App Integration

One backend endpoint handles Google sign-in **and** sign-up.

```
POST  {BASE_URL}/api/v1/auth/google
Content-Type: application/json
```
No `Authorization` header needed (this is the login step itself).

---

## Step 0 — Native Google Sign-In (on the device)

Use native Google Sign-In (Android / iOS / Flutter / React Native). It returns an
**ID token** (a JWT). That ID token is what you send us as `credential`.

> **IMPORTANT (must do):** Configure Google Sign-In on mobile with
> **`serverClientId` = the WEB OAuth Client ID** (the same
> `GOOGLE_CLIENT_ID` our backend uses). This makes the ID-token's audience match
> what the server verifies against. If you use only the Android/iOS client id,
> token verification on the server will fail (`Invalid or expired Google token`).

You only need the **ID token** — not the access token.

---

## Step 1 — Send the Google ID token

**Request body:**
```json
{
  "credential": "<GOOGLE_ID_TOKEN_FROM_NATIVE_SIGNIN>"
}
```

**Case A — existing user → logged in (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "<JWT>",
    "role": "BUYER",
    "user": { "id": 12, "name": "Gagan", "email": "gagan@x.com", "phone": null, "role": "BUYER", "is_verified": true }
  }
}
```
→ Save `data.token`, send it as `Authorization: Bearer <token>` on all future calls.

**Case B — new user → ask role (200):**
```json
{
  "success": true,
  "message": "Google verified",
  "data": {
    "isNew": true,
    "profile": { "email": "new@x.com", "name": "New User", "avatar": "https://..." }
  }
}
```
→ No `token` yet. Show a "Buyer or Seller?" screen, then do **Step 2**.

---

## Step 2 — Only for new users: send the chosen role

Send the **same** `credential` again plus `role`:

**Request body:**
```json
{
  "credential": "<SAME_GOOGLE_ID_TOKEN>",
  "role": "BUYER"          // or "SELLER"
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
  "message": "Google verified",
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
| 400 | `Google credential is required` | `credential` missing |
| 400 | `role must be BUYER or SELLER` | bad `role` value |
| 401 | `Invalid or expired Google token` | token invalid / wrong audience (check `serverClientId`) |
| 403 | `Account is banned` / `... pending admin approval` | blocked or unapproved seller |
| 500 | `Google login is not configured on the server` | backend `GOOGLE_CLIENT_ID` not set |

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

1. Native Google Sign-In (with `serverClientId` = web client id) → get **ID token**.
2. `POST /api/v1/auth/google` with `{ credential }`.
3. If `data.token` → logged in. If `data.isNew` → ask role → call again with `{ credential, role }`.
4. If `data.pendingApproval` (seller) → show pending message.
5. Save the JWT; register mobile FCM token.
