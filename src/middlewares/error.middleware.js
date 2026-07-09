'use strict';
const env = require('../config/env');

/**
 * Global error handler — must be last middleware in app.js.
 * Catches any error passed via next(err).
 */
const errorHandler = (err, req, res, next) => {
  // Log in non-production
  if (env.NODE_ENV !== 'production') {
    console.error('🔴  Error:', err);
  } else {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} — ${err.message}`);
  }

  // Joi validation errors (thrown manually)
  if (err.isJoi) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors:  err.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
    });
  }

  // PostgreSQL unique violation
  if (err.code === '23505') {
    return res.status(409).json({ success: false, message: 'Record already exists' });
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({ success: false, message: 'Referenced record not found' });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired' });
  }

  // AWS SDK v3 — surface as 500, never leak S3 status codes to the client
  if (err.$metadata?.httpStatusCode) {
    const awsMsg = env.NODE_ENV !== 'production'
      ? `S3 error (${err.$metadata.httpStatusCode}): ${err.message}`
      : 'File upload failed';
    return res.status(500).json({ success: false, message: awsMsg });
  }

  // Default 500
  const statusCode = err.statusCode || err.status || 500;
  const message    = statusCode < 500
    ? err.message
    : env.NODE_ENV !== 'production'
      ? (err.message || 'Internal server error')   // show real error in dev
      : 'Internal server error';

  return res.status(statusCode).json({
    success: false,
    message,
    ...(env.NODE_ENV !== 'production' && statusCode >= 500 && {
      debug: {
        name:    err.name    || null,
        detail:  err.message || null,
        sql:     err.sql     || null,   // Sequelize includes the failing query
      },
    }),
  });
};

/**
 * 404 handler — place BEFORE errorHandler in app.js
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

module.exports = { errorHandler, notFoundHandler };
