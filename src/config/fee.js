'use strict';
const env = require('./env');

// Single source of truth for the platform commission — every payment path
// (bids, offers, bookings, milestones, hourly work entries) must go through
// this instead of keeping its own copy of the percentage.
//
// The admin panel's Settings > Platform Fees screen saves to the
// `platform_fees` AppSetting row — that is the actual live value, not
// PLATFORM_FEE_PERCENT (which only serves as the fallback before an admin
// ever saves anything). Short in-process cache so the hot payment path
// doesn't need a DB round-trip per call, same pattern as escrow.service.js's
// getEscrowSettings().
let _cache = { value: null, at: 0 };
const CACHE_TTL_MS = 20000;

const DEFAULT_PERCENT = () => Number(env.PLATFORM_FEE_PERCENT) || 10;

const getPlatformFeePercent = async () => {
  const now = Date.now();
  if (_cache.value !== null && now - _cache.at < CACHE_TTL_MS) return _cache.value;
  // Required here (not at module load) to avoid a circular-require with
  // models that themselves pull in config/fee.js indirectly.
  const { AppSetting } = require('../models');
  const row = await AppSetting.findOne({ where: { key: 'platform_fees' } });
  const saved = Number(row?.value?.platform_fee);
  const percent = Number.isFinite(saved) && saved >= 0 ? saved : DEFAULT_PERCENT();
  _cache = { value: percent, at: now };
  return percent;
};

const feePercent = async () => (await getPlatformFeePercent()) / 100;

const computeFee = async (amount) =>
  Math.round((Number(amount) + Number.EPSILON) * (await feePercent()) * 100) / 100;

module.exports = { feePercent, computeFee, getPlatformFeePercent };
