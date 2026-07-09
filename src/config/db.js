'use strict';
const { Sequelize } = require('sequelize');
const env = require('./env');

const sequelize = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
  host:    env.DB_HOST,
  port:    env.DB_PORT,
  dialect: 'postgres',
  logging: env.NODE_ENV === 'development' ? console.log : false,
  dialectOptions: env.DB_SSL
    ? { ssl: { require: true, rejectUnauthorized: false } }
    : {},
  pool: {
    max:     10,
    min:     0,
    acquire: 30000,
    idle:    10000,
  },
  define: {
    timestamps:  true,
    underscored: true,   // createdAt → created_at in DB
    freezeTableName: false,
  },
});

module.exports = sequelize;
