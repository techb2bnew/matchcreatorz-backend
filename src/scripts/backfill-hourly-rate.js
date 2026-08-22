'use strict';
// One-off script — run once after the schema migration that adds
// Booking.hourly_rate, BEFORE enabling the new work-entry submit/approve
// routes. Seeds `hourly_rate` for every pre-existing hourly booking using the
// exact algebraic recovery `submitWork` used to do inline
// (rate = amount/hours_worked if already submitted, else amount is the rate
// itself). Safe to run more than once — only touches rows where
// hourly_rate IS NULL.
//
// Usage: node src/scripts/backfill-hourly-rate.js
const { Op } = require('sequelize');
const { sequelize, Booking } = require('../models');

async function run() {
  const rows = await Booking.findAll({
    where: { job_type: 'hourly', hourly_rate: null },
  });

  console.log(`Found ${rows.length} hourly booking(s) needing a hourly_rate backfill.`);

  let updated = 0;
  for (const booking of rows) {
    const rate = booking.hours_worked != null && Number(booking.hours_worked) > 0
      ? Number(booking.amount) / Number(booking.hours_worked)
      : Number(booking.amount);

    await booking.update({ hourly_rate: Math.round((rate + Number.EPSILON) * 100) / 100 });
    updated++;
    console.log(`  booking #${booking.id}: hourly_rate = ${booking.hourly_rate}`);
  }

  console.log(`Backfilled ${updated} booking(s).`);
  await sequelize.close();
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
