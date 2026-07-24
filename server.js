'use strict';
require('dotenv').config();
const http      = require('http');
const app       = require('./src/app');
const env       = require('./src/config/env');
const { sequelize } = require('./src/models/index');  // loads all models
const { initSocket } = require('./src/socket');

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

  } catch (err) {
    console.error('\n❌  Failed to start server:', err.message);
    process.exit(1);
  }
};

process.on('uncaughtException',  (err) => { console.error('Uncaught Exception:', err.message); process.exit(1); });
process.on('unhandledRejection', (err) => { console.error('Unhandled Rejection:', err);         process.exit(1); });

startServer();
