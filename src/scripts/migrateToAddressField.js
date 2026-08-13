'use strict';
/**
 * One-off migration: consolidates the old separate location fields
 * (User.location, SellerProfile.city+country, BuyerProfile.city+country)
 * into a single `address` column on each table, preserving existing data.
 *
 * Safe to re-run — every step is idempotent (checks column existence /
 * only backfills rows where address is still null).
 *
 * Usage: node src/scripts/migrateToAddressField.js
 */
const sequelize = require('../config/db');

const columnExists = async (table, column) => {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = :table AND column_name = :column`,
    { replacements: { table, column } }
  );
  return rows.length > 0;
};

const addAddressColumnIfMissing = async (table) => {
  if (!(await columnExists(table, 'address'))) {
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN address TEXT`);
    console.log(`+ added ${table}.address`);
  }
};

const dropColumnIfPresent = async (table, column) => {
  if (await columnExists(table, column)) {
    await sequelize.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    console.log(`- dropped ${table}.${column}`);
  }
};

const run = async () => {
  await sequelize.authenticate();
  console.log('Connected. Starting address-field migration...');

  // ── users.location -> users.address ────────────────────────────────
  await addAddressColumnIfMissing('users');
  if (await columnExists('users', 'location')) {
    const [, meta] = await sequelize.query(
      `UPDATE users SET address = location WHERE location IS NOT NULL AND (address IS NULL OR address = '')`
    );
    console.log(`users: backfilled ${meta?.rowCount ?? 0} row(s) from location`);
    await dropColumnIfPresent('users', 'location');
  }

  // ── seller_profiles.city+country -> seller_profiles.address ────────
  await addAddressColumnIfMissing('seller_profiles');
  if (await columnExists('seller_profiles', 'city') || await columnExists('seller_profiles', 'country')) {
    const [, meta] = await sequelize.query(`
      UPDATE seller_profiles
      SET address = TRIM(', ' FROM CONCAT_WS(', ', NULLIF(TRIM(city), ''), NULLIF(TRIM(country), '')))
      WHERE (address IS NULL OR address = '')
        AND (COALESCE(city, '') <> '' OR COALESCE(country, '') <> '')
    `);
    console.log(`seller_profiles: backfilled ${meta?.rowCount ?? 0} row(s) from city/country`);
    await dropColumnIfPresent('seller_profiles', 'city');
    await dropColumnIfPresent('seller_profiles', 'country');
  }

  // ── buyer_profiles.city+country -> buyer_profiles.address ──────────
  await addAddressColumnIfMissing('buyer_profiles');
  if (await columnExists('buyer_profiles', 'city') || await columnExists('buyer_profiles', 'country')) {
    const [, meta] = await sequelize.query(`
      UPDATE buyer_profiles
      SET address = TRIM(', ' FROM CONCAT_WS(', ', NULLIF(TRIM(city), ''), NULLIF(TRIM(country), '')))
      WHERE (address IS NULL OR address = '')
        AND (COALESCE(city, '') <> '' OR COALESCE(country, '') <> '')
    `);
    console.log(`buyer_profiles: backfilled ${meta?.rowCount ?? 0} row(s) from city/country`);
    await dropColumnIfPresent('buyer_profiles', 'city');
    await dropColumnIfPresent('buyer_profiles', 'country');
  }

  console.log('Migration complete.');
  await sequelize.close();
};

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
