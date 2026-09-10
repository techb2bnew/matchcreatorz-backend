'use strict';
// Run manually after adding/changing a model — never automatically on server
// start (see server.js). Usage:
//   npm run db:sync         — creates any missing tables, touches nothing existing
//   npm run db:sync:alter   — also reconciles column/constraint diffs on existing tables
require('dotenv').config();
const { sequelize } = require('../models');

const alter = process.argv.includes('--alter');

(async () => {
  try {
    await sequelize.authenticate();
    console.log(`Syncing models${alter ? ' (alter)' : ''} — this walks every table, give it a minute...`);
    await sequelize.sync(alter ? { alter: true } : undefined);
    console.log('✅  Synced.');
    process.exit(0);
  } catch (err) {
    console.error('❌  Sync failed:', err.message);
    process.exit(1);
  }
})();
