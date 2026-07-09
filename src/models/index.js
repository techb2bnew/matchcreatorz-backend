'use strict';
const sequelize     = require('../config/db');
const User          = require('./user.model');
const SellerProfile = require('./sellerProfile.model');
const BuyerProfile  = require('./buyerProfile.model');
const Category      = require('./category.model');
const Service       = require('./service.model');

// ── Associations ──────────────────────────────────────────

// User ↔ SellerProfile (1:1)
User.hasOne(SellerProfile, { foreignKey: 'user_id', as: 'sellerProfile' });
SellerProfile.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// User ↔ BuyerProfile (1:1)
User.hasOne(BuyerProfile, { foreignKey: 'user_id', as: 'buyerProfile' });
BuyerProfile.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// User ↔ Services (1:many)
User.hasMany(Service, { foreignKey: 'seller_id', as: 'services' });
Service.belongsTo(User, { foreignKey: 'seller_id', as: 'seller' });

// Category ↔ Services (1:many)
Category.hasMany(Service, { foreignKey: 'category_id', as: 'services' });
Service.belongsTo(Category, { foreignKey: 'category_id', as: 'category' });

// ─────────────────────────────────────────────────────────

const db = {
  sequelize,
  User,
  SellerProfile,
  BuyerProfile,
  Category,
  Service,
};

module.exports = db;
