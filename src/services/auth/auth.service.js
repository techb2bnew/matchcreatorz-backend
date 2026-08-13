'use strict';
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const env      = require('../../config/env');
const { User, SellerProfile, BuyerProfile } = require('../../models/index');
const { sendOtp }    = require('../../helpers/email.helper');
const { sendSmsOtp } = require('../../helpers/sms.helper');
const notify         = require('../../helpers/notification.helper');

const { OAuth2Client } = require('google-auth-library');
const crypto           = require('crypto');
const googleClient     = new OAuth2Client(env.GOOGLE_CLIENT_ID);

// ── Apple Sign-In token verification ──────────────────────────────────
// Apple's identity token is a JWT signed with Apple's rotating keys —
// verify it against Apple's public JWKS rather than a fixed secret.
const jwksClient      = require('jwks-rsa');
const appleJwksClient = jwksClient({
  jwksUri:    'https://appleid.apple.com/auth/keys',
  cache:      true,
  cacheMaxAge: 24 * 60 * 60 * 1000, // 24h
});

const getAppleSigningKey = (kid) => new Promise((resolve, reject) => {
  appleJwksClient.getSigningKey(kid, (err, key) => {
    if (err) return reject(err);
    resolve(key.getPublicKey());
  });
});

const verifyAppleToken = async (idToken) => {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header?.kid) throw new Error('Invalid Apple token header');

  const publicKey = await getAppleSigningKey(decoded.header.kid);

  return new Promise((resolve, reject) => {
    jwt.verify(idToken, publicKey, { algorithms: ['RS256'], issuer: 'https://appleid.apple.com' }, (err, payload) => {
      if (err) return reject(err);
      resolve(payload);
    });
  });
};

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const signToken = (payload) =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });

// ── Register ──────────────────────────────────────────────────────────
const register = async (data) => {
  const {
    name, email, password, phone, role,
    // seller fields
    bio, skills, hourly_rate, address, profile_image,
    resume_url, portfolio_file_urls, portfolio_links,
    // buyer fields
    company_name,
  } = data;

  // 1. Check duplicate email — paranoid:false so a soft-deleted account with
  // this email is also caught here (the "email already registered" branch
  // would otherwise miss it, since deleted rows are excluded by default, and
  // User.create would instead fail with a raw DB unique-constraint error).
  const existing = await User.findOne({ where: { email }, paranoid: false });
  if (existing) {
    if (existing.deletedAt || existing.deleted_at)
      throw { statusCode: 409, message: 'This account has been deleted. Please contact support if you think this is a mistake.' };
    throw { statusCode: 409, message: 'Email already registered' };
  }

  // 2. Hash password
  const hashed = await bcrypt.hash(password, 12);

  // 3. Create user
  const user = await User.create({
    name,
    email,
    password:    hashed,
    phone:       phone || null,
    role,
    status:      'active',
    is_verified: false,
  });

  // 4. Create role-specific profile with fields
  if (role === 'SELLER') {
    await SellerProfile.create({
      user_id:         user.id,
      bio:             bio                  || null,
      skills:          skills               || [],
      hourly_rate:     hourly_rate          || 0,
      address:         address              || null,
      profile_image:   profile_image        || null,
      resume:          resume_url           || null,
      portfolio_files: portfolio_file_urls  || [],
      portfolio_links: portfolio_links      || [],
    });
  } else if (role === 'BUYER') {
    await BuyerProfile.create({
      user_id:         user.id,
      company_name:    company_name  || null,
      address:         address       || null,
      profile_image:   profile_image || null,
      approval_status: 'pending',
    });
  }

  // 5. Generate Email OTP → save → send
  const otp        = generateOtp();
  const otp_expiry = new Date(Date.now() + env.OTP_EXPIRES_MIN * 60 * 1000);

  // Generate Phone OTP if phone provided
  const phone_otp        = phone ? generateOtp() : null;
  const phone_otp_expiry = phone ? new Date(Date.now() + env.OTP_EXPIRES_MIN * 60 * 1000) : null;

  await user.update({ otp, otp_expiry, phone_otp, phone_otp_expiry });

  // Fire-and-forget — don't fail registration if notifications fail
  notify.welcome(user);
  if (role === 'SELLER') notify.sellerRegistered(user);
  if (role === 'BUYER')  notify.buyerRegistered(user);

  sendOtp(user.email, user.name, otp).catch(err =>
    console.error('⚠️  OTP email failed:', err.message)
  );

  if (phone) {
    sendSmsOtp(phone, phone_otp).catch(err =>
      console.error('⚠️  SMS OTP failed:', err.message)
    );
  }

  // 6. Generate token
  const token = signToken({ id: user.id, email: user.email, role: user.role });

  return {
    token,
    user: {
      id:          user.id,
      name:        user.name,
      email:       user.email,
      role:        user.role,
      is_verified: user.is_verified,
    },
  };
};

// ── Login ─────────────────────────────────────────────────────────────
const login = async ({ email, phone, password }) => {
  if (!email && !phone) throw { statusCode: 400, message: 'Email or phone is required' };

  // Find by email OR phone — paranoid:false so deleted users are also found
  const { Op } = require('sequelize');
  const where = email ? { email } : { phone };
  const user = await User.findOne({ where, paranoid: false });
  if (!user) throw { statusCode: 401, message: 'Invalid credentials' };

  // Soft-deleted account
  if (user.deletedAt || user.deleted_at)
    throw { statusCode: 403, message: 'This account has been deleted. Please contact support if you think this is a mistake.' };

  if (user.status === 'banned')   throw { statusCode: 403, message: 'Account is banned' };
  if (user.status === 'inactive') throw { statusCode: 403, message: 'Account is inactive' };

  // For sellers — block login if profile is rejected or pending
  if (user.role === 'SELLER') {
    const profile = await SellerProfile.findOne({ where: { user_id: user.id } });
    if (profile && profile.approval_status === 'rejected') {
      throw { statusCode: 403, message: 'Your seller account has been rejected by admin' };
    }
    if (profile && profile.approval_status === 'pending') {
      throw { statusCode: 403, message: 'Your seller account is pending admin approval' };
    }
  }

  // For buyers — same approval gate as sellers
  if (user.role === 'BUYER') {
    const profile = await BuyerProfile.findOne({ where: { user_id: user.id } });
    if (profile && profile.approval_status === 'rejected') {
      throw { statusCode: 403, message: 'Your buyer account has been rejected by admin' };
    }
    if (profile && profile.approval_status === 'pending') {
      throw { statusCode: 403, message: 'Your buyer account is pending admin approval' };
    }
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw { statusCode: 401, message: 'Invalid credentials' };

  // JWT token payload includes role
  const token = signToken({ id: user.id, email: user.email, role: user.role });

  return {
    token,
    role:  user.role,   // top level — easy access on frontend
    user: {
      id:          user.id,
      name:        user.name,
      email:       user.email,
      phone:       user.phone,
      role:        user.role,
      is_verified: user.is_verified,
    },
  };
};

// ── Verify OTP ───────────────────────────────────────────────────────
const verifyOtp = async ({ email, otp }) => {
  const user = await User.findOne({ where: { email } });
  if (!user) throw { statusCode: 404, message: 'User not found' };

  if (user.is_verified) throw { statusCode: 400, message: 'Email already verified' };

  if (!user.otp || !user.otp_expiry)
    throw { statusCode: 400, message: 'OTP not found. Please request a new one' };

  if (new Date() > new Date(user.otp_expiry))
    throw { statusCode: 400, message: 'OTP expired. Please request a new one' };

  if (user.otp !== String(otp))
    throw { statusCode: 400, message: 'Invalid OTP' };

  // Mark verified, clear OTP
  await user.update({ is_verified: true, otp: null, otp_expiry: null });

  const token = signToken({ id: user.id, email: user.email, role: user.role });

  return {
    token,
    role: user.role,
    user: {
      id:          user.id,
      name:        user.name,
      email:       user.email,
      role:        user.role,
      is_verified: true,
    },
  };
};

// ── Resend OTP ────────────────────────────────────────────────────────
const resendOtp = async ({ email }) => {
  const user = await User.findOne({ where: { email } });
  if (!user) throw { statusCode: 404, message: 'User not found' };
  if (user.is_verified) throw { statusCode: 400, message: 'Email already verified' };

  const otp        = generateOtp();
  const otp_expiry = new Date(Date.now() + env.OTP_EXPIRES_MIN * 60 * 1000);

  await user.update({ otp, otp_expiry });

  sendOtp(user.email, user.name, otp).catch(err =>
    console.error('⚠️  OTP email failed:', err.message)
  );

  return true;
};

// ── Logout ────────────────────────────────────────────────────────────
const logout = async () => {
  // JWT is stateless — token is cleared on client side
  // Future: add token to blacklist here if needed
  return true;
};

// ── Verify Phone OTP ──────────────────────────────────────────────────
const verifyPhoneOtp = async ({ phone, otp }) => {
  const user = await User.findOne({ where: { phone } });
  if (!user) throw { statusCode: 404, message: 'Phone number not found' };
  if (user.is_phone_verified) throw { statusCode: 400, message: 'Phone already verified' };

  if (!user.phone_otp || !user.phone_otp_expiry)
    throw { statusCode: 400, message: 'OTP not found. Please request a new one' };

  if (new Date() > new Date(user.phone_otp_expiry))
    throw { statusCode: 400, message: 'OTP expired. Please request a new one' };

  if (user.phone_otp !== String(otp))
    throw { statusCode: 400, message: 'Invalid OTP' };

  await user.update({ is_phone_verified: true, phone_otp: null, phone_otp_expiry: null });

  return { is_phone_verified: true };
};

// ── Resend Phone OTP ──────────────────────────────────────────────────
const resendPhoneOtp = async ({ phone }) => {
  const user = await User.findOne({ where: { phone } });
  if (!user) throw { statusCode: 404, message: 'Phone number not found' };
  if (user.is_phone_verified) throw { statusCode: 400, message: 'Phone already verified' };

  const otp        = generateOtp();
  const otp_expiry = new Date(Date.now() + env.OTP_EXPIRES_MIN * 60 * 1000);

  await user.update({ phone_otp: otp, phone_otp_expiry: otp_expiry });

  try {
    await sendSmsOtp(phone, otp);
  } catch (err) {
    console.error('⚠️  SMS OTP failed:', err.message);
    throw { statusCode: 502, message: 'Could not send OTP — SMS provider error. Please try again shortly.' };
  }

  return true;
};

// ── Forgot Password (email OR phone) ─────────────────────────────────
const forgotPasswordByPhone = async ({ email, phone }) => {
  const expiry = new Date(Date.now() + env.OTP_EXPIRES_MIN * 60 * 1000);

  if (email) {
    // ── Email flow ──
    const user = await User.findOne({ where: { email } });
    if (!user) throw { statusCode: 404, message: 'No account found with this email' };
    if (user.status === 'banned') throw { statusCode: 403, message: 'Account is banned' };

    const otp = generateOtp();
    await user.update({ otp, otp_expiry: expiry });

    sendOtp(user.email, user.name, otp).catch(err =>
      console.error('⚠️  OTP email failed:', err.message)
    );
    return { via: 'email' };
  }

  // ── Phone (SMS) flow ──
  const user = await User.findOne({ where: { phone } });
  if (!user) throw { statusCode: 404, message: 'No account found with this phone number' };
  if (user.status === 'banned') throw { statusCode: 403, message: 'Account is banned' };

  const otp = generateOtp();
  await user.update({ phone_otp: otp, phone_otp_expiry: expiry });

  try {
    await sendSmsOtp(phone, otp);
  } catch (err) {
    console.error('⚠️  SMS OTP failed:', err.message);
    throw { statusCode: 502, message: 'Could not send OTP — SMS provider error. Please try again shortly.' };
  }
  return { via: 'phone' };
};

// ── Verify Forgot-Password OTP (email OR phone) → reset token ────────
const verifyForgotPhoneOtp = async ({ email, phone, otp }) => {
  const { v4: uuidv4 } = require('uuid');

  if (email) {
    // ── Email OTP verify ──
    const user = await User.findOne({ where: { email } });
    if (!user) throw { statusCode: 404, message: 'No account found with this email' };

    if (!user.otp || !user.otp_expiry)
      throw { statusCode: 400, message: 'OTP not found. Please request a new one' };
    if (new Date() > new Date(user.otp_expiry))
      throw { statusCode: 400, message: 'OTP expired. Please request a new one' };
    if (user.otp !== String(otp))
      throw { statusCode: 400, message: 'Invalid OTP' };

    const reset_token        = uuidv4();
    const reset_token_expiry = new Date(Date.now() + 15 * 60 * 1000);

    await user.update({ otp: null, otp_expiry: null, reset_token, reset_token_expiry });
    return { reset_token };
  }

  // ── Phone OTP verify ──
  const user = await User.findOne({ where: { phone } });
  if (!user) throw { statusCode: 404, message: 'No account found with this phone number' };

  if (!user.phone_otp || !user.phone_otp_expiry)
    throw { statusCode: 400, message: 'OTP not found. Please request a new one' };
  if (new Date() > new Date(user.phone_otp_expiry))
    throw { statusCode: 400, message: 'OTP expired. Please request a new one' };
  if (user.phone_otp !== String(otp))
    throw { statusCode: 400, message: 'Invalid OTP' };

  const reset_token        = uuidv4();
  const reset_token_expiry = new Date(Date.now() + 15 * 60 * 1000);

  await user.update({
    phone_otp: null, phone_otp_expiry: null,
    reset_token, reset_token_expiry,
  });
  return { reset_token };
};

// ── Reset Password ────────────────────────────────────────────────────
const resetPassword = async ({ token, password }) => {
  const user = await User.findOne({ where: { reset_token: token } });
  if (!user) throw { statusCode: 400, message: 'Invalid or expired reset token' };

  if (new Date() > new Date(user.reset_token_expiry))
    throw { statusCode: 400, message: 'Reset token expired. Please start over' };

  const hashed = await bcrypt.hash(password, 12);

  await user.update({
    password:           hashed,
    reset_token:        null,
    reset_token_expiry: null,
  });

  return true;
};

// ── Google sign-in ────────────────────────────────────────────────────
// Flow:
//  1. Frontend gets a Google ID-token (credential) and posts it here.
//  2. We verify it against GOOGLE_CLIENT_ID.
//  3. Existing user → normal login (returns token).
//     New user WITHOUT role → { isNew:true, profile } so the UI can ask role.
//     New user WITH role → create account, pending admin approval either way
//     (no token yet).
const googleAuth = async ({ credential, role }) => {
  if (!env.GOOGLE_CLIENT_ID)
    throw { statusCode: 500, message: 'Google login is not configured on the server' };
  if (!credential)
    throw { statusCode: 400, message: 'Google credential is required' };

  // 1. Verify the ID token
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw { statusCode: 401, message: 'Invalid or expired Google token' };
  }
  if (!payload?.email) throw { statusCode: 400, message: 'Google account has no email' };

  const email   = payload.email.toLowerCase();
  const name    = payload.name || email.split('@')[0];
  const avatar  = payload.picture || null;

  // 2. Existing user?
  let user = await User.findOne({ where: { email }, paranoid: false });

  if (user) {
    if (user.deletedAt || user.deleted_at)
      throw { statusCode: 403, message: 'This account has been deleted. Please contact support if you think this is a mistake.' };
    if (user.status === 'banned')   throw { statusCode: 403, message: 'Account is banned' };
    if (user.status === 'inactive') throw { statusCode: 403, message: 'Account is inactive' };

    if (user.role === 'SELLER') {
      const profile = await SellerProfile.findOne({ where: { user_id: user.id } });
      if (profile && profile.approval_status === 'rejected')
        throw { statusCode: 403, message: 'Your seller account has been rejected by admin' };
      if (profile && profile.approval_status === 'pending')
        throw { statusCode: 403, message: 'Your seller account is pending admin approval' };
    }
    if (user.role === 'BUYER') {
      const profile = await BuyerProfile.findOne({ where: { user_id: user.id } });
      if (profile && profile.approval_status === 'rejected')
        throw { statusCode: 403, message: 'Your buyer account has been rejected by admin' };
      if (profile && profile.approval_status === 'pending')
        throw { statusCode: 403, message: 'Your buyer account is pending admin approval' };
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    return {
      token, role: user.role,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, is_verified: user.is_verified },
    };
  }

  // 3. New user — need a role
  if (!role) {
    return { isNew: true, profile: { email, name, avatar } };
  }
  const chosen = String(role).toUpperCase();
  if (!['BUYER', 'SELLER'].includes(chosen))
    throw { statusCode: 400, message: 'role must be BUYER or SELLER' };

  // Google users have no password — set a strong random one
  const randomPw = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);

  user = await User.create({
    name,
    email,
    password:    randomPw,
    role:        chosen,
    status:      'active',
    is_verified: true,            // email already verified by Google
    avatar,
  });

  if (chosen === 'SELLER') {
    await SellerProfile.create({ user_id: user.id, approval_status: 'pending' });
    // Pending approval → no token yet (consistent with normal seller signup)
    return {
      isNew: false,
      pendingApproval: true,
      message: 'Seller account created. It is pending admin approval before you can sign in.',
    };
  }

  // BUYER → pending approval, same as seller — no token yet
  await BuyerProfile.create({ user_id: user.id, approval_status: 'pending' }).catch(() => {});
  notify.buyerRegistered(user);
  return {
    isNew: false,
    pendingApproval: true,
    message: 'Buyer account created. It is pending admin approval before you can sign in.',
  };
};

// ── Apple sign-in ─────────────────────────────────────────────────────
// Flow (mirrors googleAuth):
//  1. Frontend/app gets an Apple identity token and posts it here, along
//     with the `user` object Apple's SDK provides — but ONLY on the very
//     first authorization ever (Apple never resends the name after that).
//  2. We verify the token against Apple's public keys + our client id(s).
//  3. Existing user → normal login (returns token).
//     New user WITHOUT role → { isNew:true, profile } so the UI can ask role.
//     New user WITH role → create account, pending admin approval either way
//     (no token yet).
const appleAuth = async ({ identity_token, id_token, user: appleUser, role }) => {
  const token = identity_token || id_token;
  if (!env.APPLE_CLIENT_ID)
    throw { statusCode: 500, message: 'Apple login is not configured on the server' };
  if (!token)
    throw { statusCode: 400, message: 'Apple identity token is required' };

  // 1. Verify the identity token
  let payload;
  try {
    payload = await verifyAppleToken(token);
  } catch {
    throw { statusCode: 401, message: 'Invalid or expired Apple token' };
  }

  const allowedAudiences = env.APPLE_CLIENT_ID.split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowedAudiences.includes(payload.aud))
    throw { statusCode: 401, message: 'Apple token was issued for a different client' };

  const rawEmail = payload.email || appleUser?.email;
  if (!rawEmail) throw { statusCode: 400, message: 'Apple account has no email' };
  const email = rawEmail.toLowerCase();

  // Apple only sends the name on first authorization, as a separate JSON
  // field (never inside the token) — fall back to the email handle after that.
  const appleName = appleUser?.name
    ? [appleUser.name.firstName, appleUser.name.lastName].filter(Boolean).join(' ')
    : '';
  const name = appleName || email.split('@')[0];

  // 2. Existing user?
  let user = await User.findOne({ where: { email }, paranoid: false });

  if (user) {
    if (user.deletedAt || user.deleted_at)
      throw { statusCode: 403, message: 'This account has been deleted. Please contact support if you think this is a mistake.' };
    if (user.status === 'banned')   throw { statusCode: 403, message: 'Account is banned' };
    if (user.status === 'inactive') throw { statusCode: 403, message: 'Account is inactive' };

    if (user.role === 'SELLER') {
      const profile = await SellerProfile.findOne({ where: { user_id: user.id } });
      if (profile && profile.approval_status === 'rejected')
        throw { statusCode: 403, message: 'Your seller account has been rejected by admin' };
      if (profile && profile.approval_status === 'pending')
        throw { statusCode: 403, message: 'Your seller account is pending admin approval' };
    }
    if (user.role === 'BUYER') {
      const profile = await BuyerProfile.findOne({ where: { user_id: user.id } });
      if (profile && profile.approval_status === 'rejected')
        throw { statusCode: 403, message: 'Your buyer account has been rejected by admin' };
      if (profile && profile.approval_status === 'pending')
        throw { statusCode: 403, message: 'Your buyer account is pending admin approval' };
    }

    const signedToken = signToken({ id: user.id, email: user.email, role: user.role });
    return {
      token: signedToken, role: user.role,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, is_verified: user.is_verified },
    };
  }

  // 3. New user — need a role
  if (!role) {
    return { isNew: true, profile: { email, name } };
  }
  const chosen = String(role).toUpperCase();
  if (!['BUYER', 'SELLER'].includes(chosen))
    throw { statusCode: 400, message: 'role must be BUYER or SELLER' };

  // Apple users have no password — set a strong random one
  const randomPw = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);

  user = await User.create({
    name,
    email,
    password:    randomPw,
    role:        chosen,
    status:      'active',
    is_verified: true,            // email already verified by Apple
  });

  if (chosen === 'SELLER') {
    await SellerProfile.create({ user_id: user.id, approval_status: 'pending' });
    return {
      isNew: false,
      pendingApproval: true,
      message: 'Seller account created. It is pending admin approval before you can sign in.',
    };
  }

  // BUYER → pending approval, same as seller — no token yet
  await BuyerProfile.create({ user_id: user.id, approval_status: 'pending' }).catch(() => {});
  notify.buyerRegistered(user);
  return {
    isNew: false,
    pendingApproval: true,
    message: 'Buyer account created. It is pending admin approval before you can sign in.',
  };
};

module.exports = {
  register, login, logout,
  verifyOtp, resendOtp,
  verifyPhoneOtp, resendPhoneOtp,
  forgotPasswordByPhone, verifyForgotPhoneOtp, resetPassword,
  googleAuth, appleAuth,
};
