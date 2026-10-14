'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL belum diatur. Salin .env.example menjadi .env dan isi koneksi PostgreSQL.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 10000
});
const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
const lockKey = 729_561_840;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [lockKey]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

    const files = (await fs.readdir(migrationsDir)).filter(f => /^\d+_[\w-]+\.sql$/.test(f)).sort();
    for (const file of files) {
      const already = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (already.rowCount) {
        console.log(`Migration already applied: ${file}`);
        continue;
      }
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      console.log(`Applying migration: ${file}`);
      await client.query('BEGIN');
      try {
        // Migration source is committed code, not user input. It intentionally contains multiple DDL statements.
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    console.log('Database migrations complete.');
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey]); } catch { /* connection may already be broken */ }
    client.release();
    await pool.end();
  }
}

migrate().catch(error => {
  const reason = error.message || error.code || 'Unknown database error';
  console.error('Database migration failed:', reason);
  process.exitCode = 1;
});
