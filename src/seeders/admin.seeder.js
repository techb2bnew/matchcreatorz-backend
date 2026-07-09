'use strict';
require('dotenv').config();
const bcrypt        = require('bcryptjs');
const { sequelize, User } = require('../models/index');

const seedAdmin = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });

    const email    = 'admin@matchcreatorz.com';
    const password = 'Admin@123';

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      console.log('⚠️   Admin already exists:', email);
      process.exit(0);
    }

    const hashed = await bcrypt.hash(password, 12);

    await User.create({
      name:        'Super Admin',
      email,
      password:    hashed,
      role:        'ADMIN',
      status:      'active',
      is_verified: true,
    });

    console.log('✅  Admin created successfully!');
    console.log('    Email   :', email);
    console.log('    Password: Admin@123');
    process.exit(0);

  } catch (err) {
    console.error('❌  Seeder failed:', err.message);
    process.exit(1);
  }
};

seedAdmin();
