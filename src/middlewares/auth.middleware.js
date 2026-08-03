'use strict';
const jwt      = require('jsonwebtoken');
const env      = require('../config/env');
const response = require('../helpers/response.helper');
const { User } = require('../models');

/**
 * Verify JWT access token AND that the account is still valid right now.
 *
 * A JWT stays cryptographically valid for its whole lifetime (JWT_EXPIRES_IN)
 * no matter what happens to the account afterward — so without the DB check
 * below, a seller/buyer who gets deleted or blocked by admin would keep
 * working normally (and the frontend would have no signal to log them out)
 * until their token happened to expire on its own. This re-checks on every
 * request, so a deleted/banned/inactive account is rejected immediately —
 * the frontend then clears its session and redirects to login on the 401.
 *
 * Attaches decoded payload to req.user
 */
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return response.unauthorized(res, 'Access token missing');
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);

    // paranoid:false so a soft-deleted account is still found here (instead of
    // silently returning null) — we want to react to it explicitly below.
    const user = await User.findByPk(decoded.id, { attributes: ['id', 'status'], paranoid: false });
    if (!user || user.deletedAt || user.deleted_at) {
      return response.unauthorized(res, 'This account no longer exists');
    }
    if (user.status === 'banned') {
      return response.unauthorized(res, 'This account has been suspended');
    }
    if (user.status === 'inactive') {
      return response.unauthorized(res, 'This account is inactive');
    }

    req.user = decoded;   // { id, email, role, iat, exp }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return response.unauthorized(res, 'Access token expired');
    }
    if (err.name === 'JsonWebTokenError') {
      return response.unauthorized(res, 'Invalid access token');
    }
    return next(err);
  }
};

/**
 * Role-based access control.
 * Usage: authorize('ADMIN') or authorize('ADMIN', 'SELLER')
 */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return response.unauthorized(res);
  }
  if (!roles.includes(req.user.role)) {
    return response.forbidden(res, `Access restricted to: ${roles.join(', ')}`);
  }
  next();
};

module.exports = { authenticate, authorize };
