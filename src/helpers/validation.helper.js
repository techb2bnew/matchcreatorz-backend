'use strict';
const Joi = require('joi');

// ── Reusable field rules ────────────────────────────────────────────

const fields = {
  name:     Joi.string().min(2).max(80).trim(),
  email:    Joi.string().email({ tlds: { allow: false } }).lowercase().trim(),
  password: Joi.string().min(8).max(128)
              .pattern(/[A-Z]/, 'one uppercase')
              .pattern(/[0-9]/, 'one number'),
  phone:    Joi.string().pattern(/^\+?[1-9]\d{9,14}$/).messages({
              'string.pattern.base': 'Phone number is invalid',
            }),
  otp:      Joi.string().length(6).pattern(/^\d+$/),
  uuid:     Joi.string().uuid({ version: 'uuidv4' }),
  page:     Joi.number().integer().min(1).default(1),
  limit:    Joi.number().integer().min(1).max(100).default(10),
  role:     Joi.string().valid('ADMIN', 'SELLER', 'BUYER'),
};

// ── Auth schemas ────────────────────────────────────────────────────

const authSchemas = {
  register: Joi.object({
    // ── Required for all roles ────────────────────
    name:     fields.name.required(),
    email:    fields.email.required(),
    password: fields.password.required(),
    role:     Joi.string().valid('SELLER', 'BUYER').required(),

    // ── Optional for all roles ────────────────────
    phone:         fields.phone.optional(),
    profile_image: Joi.string().uri().optional(),

    // ── Seller: required when role = SELLER ───────
    skills: Joi.when('role', {
      is:        'SELLER',
      then:      Joi.array().items(Joi.string()).min(1).required()
                   .messages({ 'any.required': 'skills is required for sellers' }),
      otherwise: Joi.array().items(Joi.string()).optional(),
    }),

    hourly_rate: Joi.when('role', {
      is:        'SELLER',
      then:      Joi.number().min(0).required()
                   .messages({ 'any.required': 'hourly_rate is required for sellers' }),
      otherwise: Joi.number().min(0).optional(),
    }),

    address: Joi.when('role', {
      is:        'SELLER',
      then:      Joi.string().max(255).required()
                   .messages({ 'any.required': 'address is required for sellers' }),
      otherwise: Joi.string().max(255).optional(),
    }),

    // ── Seller: optional ──────────────────────────
    bio: Joi.string().max(500).optional(),

    // ── Buyer: optional ───────────────────────────
    company_name: Joi.string().max(150).optional(),
  }),

  login: Joi.object({
    email:    fields.email.optional(),
    phone:    fields.phone.optional(),
    password: Joi.string().required(),
  }).or('email', 'phone'),   // at least one required

  forgotPassword: Joi.object({
    email: fields.email.required(),
  }),

  resetPassword: Joi.object({
    token:    Joi.string().required(),
    password: fields.password.required(),
  }),

  verifyOtp: Joi.object({
    email: fields.email.required(),
    otp:   fields.otp.required(),
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword:     fields.password.required(),
  }),

  verifyPhoneOtp: Joi.object({
    phone: fields.phone.required(),
    otp:   fields.otp.required(),
  }),

  resendPhoneOtp: Joi.object({
    phone: fields.phone.required(),
  }),

  // ── Forgot password (email OR phone) ────────────
  forgotPasswordPhone: Joi.object({
    email: fields.email.optional(),
    phone: fields.phone.optional(),
  }).or('email', 'phone'),          // at least one required

  verifyForgotPhoneOtp: Joi.object({
    email: fields.email.optional(),
    phone: fields.phone.optional(),
    otp:   fields.otp.required(),
  }).or('email', 'phone'),

  resetPassword: Joi.object({
    token:    Joi.string().required(),
    password: fields.password.required(),
  }),

  refreshToken: Joi.object({
    refreshToken: Joi.string().required(),
  }),
};

// ── Seller schemas ──────────────────────────────────────────────────

const sellerSchemas = {
  updateProfile: Joi.object({
    name:        fields.name.optional(),
    phone:       fields.phone.optional(),
    bio:         Joi.string().max(500).optional(),
    skills:      Joi.array().items(Joi.string()).optional(),
    hourlyRate:  Joi.number().min(0).optional(),
    category:    Joi.string().optional(),
    address:     Joi.string().max(255).optional(),
  }),

  createService: Joi.object({
    title:       Joi.string().min(5).max(150).required(),
    description: Joi.string().min(20).max(2000).required(),
    price:       Joi.number().min(0).required(),
    categoryId:  fields.uuid.required(),
    deliveryDays:Joi.number().integer().min(1).required(),
    tags:        Joi.array().items(Joi.string()).optional(),
  }),

  placeBid: Joi.object({
    jobId:       fields.uuid.required(),
    amount:      Joi.number().min(0).required(),
    message:     Joi.string().max(500).optional(),
    deliveryDays:Joi.number().integer().min(1).required(),
  }),
};

// ── Buyer schemas ───────────────────────────────────────────────────

const buyerSchemas = {
  createJob: Joi.object({
    title:       Joi.string().min(5).max(150).required(),
    description: Joi.string().min(20).max(2000).required(),
    budget:      Joi.number().min(0).required(),
    categoryId:  fields.uuid.required(),
    deadline:    Joi.date().greater('now').optional(),
    skills:      Joi.array().items(Joi.string()).optional(),
  }),

  search: Joi.object({
    q:          Joi.string().optional(),
    category:   Joi.string().optional(),
    minPrice:   Joi.number().min(0).optional(),
    maxPrice:   Joi.number().min(0).optional(),
    rating:     Joi.number().min(0).max(5).optional(),
    sortBy:     Joi.string().valid('relevance', 'price_asc', 'price_desc', 'rating').default('relevance'),
    page:       fields.page,
    limit:      fields.limit,
  }),
};

// ── Admin schemas ───────────────────────────────────────────────────

const adminSchemas = {
  addConnects: Joi.object({
    userId:   fields.uuid.required(),
    amount:   Joi.number().integer().min(1).required(),
    type:     Joi.string().valid('Bonus', 'Manual', 'Refund', 'Promotional').required(),
    note:     Joi.string().max(300).optional(),
  }),

  updateUser: Joi.object({
    name:     fields.name.optional(),
    email:    fields.email.optional(),
    phone:    fields.phone.optional(),
    status:   Joi.string().valid('active', 'inactive', 'banned').optional(),
  }),

  createCategory: Joi.object({
    name:     Joi.string().min(2).max(80).required(),
    icon:     Joi.string().optional(),
    parentId: fields.uuid.optional(),
  }),
};

// ── Validate helper ─────────────────────────────────────────────────

/**
 * Validate data against a Joi schema.
 * Returns { value, error } where error is a formatted array or null.
 */
const validate = (schema, data) => {
  const { error, value } = schema.validate(data, {
    abortEarly:   false,
    stripUnknown: true,
    convert:      true,
  });

  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.path.join('.'),
      message: d.message.replace(/['"]/g, ''),
    }));
    return { value: null, errors };
  }

  return { value, errors: null };
};

module.exports = {
  fields,
  authSchemas,
  sellerSchemas,
  buyerSchemas,
  adminSchemas,
  validate,
};
