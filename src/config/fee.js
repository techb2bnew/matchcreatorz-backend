'use strict';
const env = require('./env');

// Single source of truth for the platform commission — every payment path
// (bids, offers, bookings, milestones, hourly work entries) must go through
// this instead of keeping its own copy of the percentage.
const feePercent = () => (Number(env.PLATFORM_FEE_PERCENT) || 10) / 100;

const computeFee = (amount) => Math.round((Number(amount) + Number.EPSILON) * feePercent() * 100) / 100;

module.exports = { feePercent, computeFee };
