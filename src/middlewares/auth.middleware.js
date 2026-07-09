'use strict';
const jwt      = require('jsonwebtoken');
const env      = require('../config/env');
const response = require('../helpers/response.helper');

/**
 * Verify JWT access token.
 * Attaches decoded payload to req.user
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return response.unauthorized(res, 'Access token missing');
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded;   // { id, email, role, iat, exp }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return response.unauthorized(res, 'Access token expired');
    }
    return response.unauthorized(res, 'Invalid access token');
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
