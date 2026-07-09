'use strict';
const { validate }  = require('../helpers/validation.helper');
const response      = require('../helpers/response.helper');

/**
 * Returns an Express middleware that validates req.body
 * against the given Joi schema.
 *
 * Usage:
 *   router.post('/register', validateBody(authSchemas.register), controller)
 */
const validateBody = (schema) => (req, res, next) => {
  const { value, errors } = validate(schema, req.body);
  if (errors) return response.validationError(res, errors);
  req.body = value;   // replace with sanitised/converted values
  next();
};

/**
 * Validate req.query (search, pagination, filters)
 */
const validateQuery = (schema) => (req, res, next) => {
  const { value, errors } = validate(schema, req.query);
  if (errors) return response.validationError(res, errors);
  req.query = value;
  next();
};

/**
 * Validate req.params
 */
const validateParams = (schema) => (req, res, next) => {
  const { value, errors } = validate(schema, req.params);
  if (errors) return response.validationError(res, errors);
  req.params = value;
  next();
};

module.exports = { validateBody, validateQuery, validateParams };
