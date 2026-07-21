'use strict';
const { SellerProfile, ConnectTransaction, sequelize } = require('../models');

// Cost (in connects) to place a single bid.
const BID_COST = 1;

/**
 * Apply a connects change atomically and write a ledger row.
 * @param {number} sellerId  user id of the seller
 * @param {number} delta     +credit / -debit
 * @param {string} type      admin_credit | bid_deduct | purchase | refund
 * @param {object} opts      { note, ref_id }
 * @returns {Promise<{balance:number, transaction:object}>}
 */
async function applyConnects(sellerId, delta, type, { note = null, ref_id = null } = {}) {
  return sequelize.transaction(async (t) => {
    const profile = await SellerProfile.findOne({
      where: { user_id: sellerId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!profile) throw { statusCode: 404, message: 'Seller profile not found' };

    const current = Number(profile.connects_balance || 0);
    const next    = current + Number(delta);
    if (next < 0) throw { statusCode: 400, message: 'Insufficient connects balance' };

    await profile.update({ connects_balance: next }, { transaction: t });

    const transaction = await ConnectTransaction.create({
      seller_id:     sellerId,
      amount:        Number(delta),
      balance_after: next,
      type,
      note,
      ref_id,
    }, { transaction: t });

    return { balance: next, transaction };
  });
}

module.exports = { applyConnects, BID_COST };
