'use strict';

/**
 * Uniform API response helper.
 * Every controller uses these so the front-end always gets a
 * consistent shape: { success, message, data, meta }
 */

/**
 * 200 OK — general success
 */
const success = (res, message = 'Success', data = null, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * 201 Created
 */
const created = (res, message = 'Created successfully', data = null) => {
  return success(res, message, data, 201);
};

/**
 * Paginated list response
 * @param {object} meta  { page, limit, total }
 */
const paginate = (res, message = 'Fetched successfully', data = [], meta = {}) => {
  const { page = 1, limit = 10, total = 0 } = meta;
  return res.status(200).json({
    success:    true,
    message,
    data,
    meta: {
      page:       Number(page),
      limit:      Number(limit),
      total:      Number(total),
      totalPages: Math.ceil(total / limit),
    },
  });
};

/**
 * 400 Bad Request
 */
const badRequest = (res, message = 'Bad request', errors = null) => {
  return res.status(400).json({
    success: false,
    message,
    errors,
  });
};

/**
 * 401 Unauthorized
 */
const unauthorized = (res, message = 'Unauthorized') => {
  return res.status(401).json({ success: false, message });
};

/**
 * 403 Forbidden
 */
const forbidden = (res, message = 'Forbidden') => {
  return res.status(403).json({ success: false, message });
};

/**
 * 404 Not Found
 */
const notFound = (res, message = 'Not found') => {
  return res.status(404).json({ success: false, message });
};

/**
 * 409 Conflict
 */
const conflict = (res, message = 'Conflict') => {
  return res.status(409).json({ success: false, message });
};

/**
 * 422 Unprocessable Entity (validation errors)
 */
const validationError = (res, errors) => {
  return res.status(422).json({
    success: false,
    message: 'Validation failed',
    errors,
  });
};

/**
 * 500 Internal Server Error
 */
const serverError = (res, message = 'Internal server error') => {
  return res.status(500).json({ success: false, message });
};

module.exports = {
  success,
  created,
  paginate,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  validationError,
  serverError,
};
