'use strict';
require('dotenv').config();
const http      = require('http');
const app       = require('./src/app');
const env       = require('./src/config/env');
const { sequelize, Booking, User } = require('./src/models/index');  // loads all models
const { Op }          = require('sequelize');
const { initSocket }  = require('./src/socket');
const notify           = require('./src/helpers/notification.helper');

const startServer = async () => {
  try {
    // 1. Test DB connection
    await sequelize.authenticate();
    console.log('\n✅  Database connected successfully');
    console.log(`    Host : ${env.DB_HOST}:${env.DB_PORT}`);
    console.log(`    DB   : ${env.DB_NAME}`);

    // 2. Sync models — alter:true adds/modifies columns without dropping tables
    await sequelize.sync({ alter: true });
    console.log('✅  Models synced');

    // 3. Start HTTP server (wrapped so Socket.IO can attach)
    const server = http.createServer(app);
    initSocket(server);   // real-time chat
    server.listen(env.PORT, () => {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`🚀  MatchCreatorz API running`);
      console.log(`    Mode : ${env.NODE_ENV}`);
      console.log(`    Port : ${env.PORT}`);
      console.log(`    URL  : http://localhost:${env.PORT}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    });

    // Graceful shutdown
    const shutdown = (signal) => {
      console.log(`\n${signal} received — shutting down...`);
      server.close(async () => {
        await sequelize.close();
        console.log('✅  DB connection closed');
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    // Escrow whole-booking holds (manual-capture PaymentIntents) auto-cancel
    // ~7 days after creation if never captured — remind the buyer at 5 days so
    // they have a window to accept the work before it expires. No existing
    // scheduler infra in this codebase, so a plain interval is the minimal fit.
    const ESCROW_REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h
    setInterval(async () => {
      try {
        const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
        const bookings = await Booking.findAll({
          where: {
            payment_mode: 'escrow',
            escrow_payment_intent_id: { [Op.ne]: null },
            escrow_captured_at: null,
            escrow_reminder_sent_at: null,
            created_at: { [Op.lt]: fiveDaysAgo },
          },
        });
        for (const booking of bookings) {
          const buyer = await User.findByPk(booking.buyer_id, {
            attributes: ['id', 'name', 'email', 'web_fcm_token', 'mobile_fcm_token'],
          });
          if (buyer) notify.escrowExpiringSoon(buyer, booking);
          await booking.update({ escrow_reminder_sent_at: new Date() });
        }
      } catch (err) {
        console.error('Escrow reminder sweep error:', err && err.message);
      }
    }, ESCROW_REMINDER_INTERVAL_MS);

  } catch (err) {
    console.error('\n❌  Failed to start server:', err.message);
    process.exit(1);
  }
};

process.on('uncaughtException',  (err) => { console.error('Uncaught Exception:', err.message); process.exit(1); });
process.on('unhandledRejection', (err) => { console.error('Unhandled Rejection:', err);         process.exit(1); });

startServer();
