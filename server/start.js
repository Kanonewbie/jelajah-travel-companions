'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Apply forward-only, idempotently tracked migrations before the API begins accepting traffic.
const migration = spawnSync(process.execPath, [path.join(__dirname, 'migrate.js')], { stdio: 'inherit', env: process.env });
if (migration.status !== 0) process.exit(migration.status || 1);

const { app, pool } = require('./index');
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, '0.0.0.0', () => console.log(`Jelajah listening on port ${port} (${process.env.NODE_ENV || 'development'}).`));

function shutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully.`);
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
