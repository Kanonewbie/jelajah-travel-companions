'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { randomBytes, timingSafeEqual } = require('node:crypto');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const {
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateDisplayName,
  validateTripInput,
  sanitizeAppState
} = require('./lib/validation');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL belum diatur. Buat file .env dari .env.example dan isi koneksi PostgreSQL.');
  process.exit(1);
}
if (NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  console.error('SESSION_SECRET wajib berisi secret acak minimal 32 karakter di production.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Math.max(2, Math.min(Number(process.env.PG_POOL_MAX || 10), 20)),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000,
  application_name: 'jelajah-web'
});
pool.on('error', error => console.error('Unexpected PostgreSQL pool error:', error.message));

app.disable('x-powered-by');
if (NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://images.unsplash.com'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      ...(NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {})
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(express.json({ limit: '300kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan login. Coba lagi setelah 15 menit.' }
});

// Static files are served only from public/; .env, server code, and SQL are never web-accessible.
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  index: 'index.html',
  setHeaders(res, filePath) {
    if (/\.(html|js|webmanifest)$/.test(filePath) || filePath.endsWith(`${path.sep}sw.js`)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use('/api', apiLimiter);
app.use('/api', session({
  name: 'jelajah.sid',
  store: new PgSession({ pool, tableName: 'web_sessions', createTableIfMissing: false, pruneSessionInterval: 900 }),
  secret: process.env.SESSION_SECRET || 'local-development-secret-change-me-before-deploying',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/'
  }
}));

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}
function publicUser(row) {
  return { id: String(row.id), email: row.email, displayName: row.display_name || '' };
}
function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
function csrfProtection(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Origin tidak diizinkan.' });
    } catch { return res.status(403).json({ error: 'Origin tidak valid.' }); }
  }
  const expected = req.session && req.session.csrfToken;
  const supplied = req.get('x-csrf-token');
  if (typeof expected !== 'string' || typeof supplied !== 'string') return res.status(403).json({ error: 'Token keamanan tidak tersedia. Muat ulang halaman.' });
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return res.status(403).json({ error: 'Token keamanan tidak valid. Muat ulang halaman.' });
  next();
}
function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
}
function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}
function destroySession(req) {
  return new Promise(resolve => {
    if (!req.session) return resolve();
    req.session.destroy(() => resolve());
  });
}
async function requireUser(req, res, next) {
  try {
    const sessionUserId = req.session && req.session.userId;
    if (!sessionUserId) return res.status(401).json({ error: 'Silakan masuk untuk melanjutkan.' });
    const result = await pool.query(
      'SELECT id, email, display_name, disabled_at FROM app_users WHERE id = $1',
      [String(sessionUserId)]
    );
    const row = result.rows[0];
    if (!row || row.disabled_at) {
      await destroySession(req);
      return res.status(401).json({ error: 'Sesi tidak lagi aktif. Silakan masuk kembali.' });
    }
    req.appUser = row;
    next();
  } catch (error) { next(error); }
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', environment: NODE_ENV, time: new Date().toISOString() });
  } catch (error) {
    console.error('Health check database failure:', error.message);
    res.status(503).json({ status: 'degraded', database: 'unavailable' });
  }
});

app.get('/api/auth/csrf', (req, res) => {
  noStore(res);
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
  res.json({ csrfToken: req.session.csrfToken });
});

app.post('/api/auth/register', authLimiter, csrfProtection, async (req, res, next) => {
  noStore(res);
  const email = normalizeEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!validateEmail(email)) return res.status(400).json({ error: 'Masukkan alamat email yang valid.' });
  if (!validatePassword(password)) return res.status(400).json({ error: 'Kata sandi harus 12–128 karakter.' });
  if (!validateDisplayName(name)) return res.status(400).json({ error: 'Nama tampilan maksimal 80 karakter.' });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    let result;
    try {
      result = await pool.query(
        'INSERT INTO app_users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name',
        [email, name, passwordHash]
      );
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Email sudah terdaftar. Silakan masuk.' });
      throw error;
    }
    await regenerateSession(req);
    req.session.userId = String(result.rows[0].id);
    req.session.csrfToken = randomBytes(32).toString('hex');
    await saveSession(req);
    return res.status(201).json({ user: publicUser(result.rows[0]), csrfToken: req.session.csrfToken });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', authLimiter, csrfProtection, async (req, res, next) => {
  noStore(res);
  const email = normalizeEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  if (!validateEmail(email) || typeof password !== 'string' || password.length > 128) {
    return res.status(400).json({ error: 'Email atau kata sandi tidak valid.' });
  }
  try {
    const result = await pool.query(
      'SELECT id, email, display_name, password_hash, disabled_at FROM app_users WHERE lower(email) = $1 LIMIT 1',
      [email]
    );
    const row = result.rows[0];
    const valid = row && !row.disabled_at ? await bcrypt.compare(password, row.password_hash) : false;
    if (!valid) return res.status(401).json({ error: 'Email atau kata sandi salah.' });
    await regenerateSession(req);
    req.session.userId = String(row.id);
    req.session.csrfToken = randomBytes(32).toString('hex');
    await saveSession(req);
    return res.json({ user: publicUser(row), csrfToken: req.session.csrfToken });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', async (req, res, next) => {
  noStore(res);
  try {
    if (!req.session.userId) return res.json({ user: null });
    const result = await pool.query('SELECT id, email, display_name, disabled_at FROM app_users WHERE id = $1', [String(req.session.userId)]);
    const row = result.rows[0];
    if (!row || row.disabled_at) { await destroySession(req); return res.json({ user: null }); }
    res.json({ user: publicUser(row) });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', csrfProtection, async (req, res) => {
  noStore(res);
  await destroySession(req);
  res.clearCookie('jelajah.sid', { path: '/', httpOnly: true, secure: NODE_ENV === 'production', sameSite: 'lax' });
  res.json({ ok: true });
});

app.delete('/api/account', csrfProtection, requireUser, async (req, res, next) => {
  noStore(res);
  const userId = String(req.appUser.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Remove memberships and data created by this account from the relational foundation.
    await client.query('DELETE FROM web_sessions WHERE sess->>\'userId\' = $1', [userId]);
    await client.query('DELETE FROM vote_responses WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM votes WHERE proposed_by = $1', [userId]);
    await client.query('DELETE FROM trip_members WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM expenses WHERE created_by_user_id = $1', [userId]);
    await client.query('DELETE FROM trip_notes WHERE author_user_id = $1', [userId]);
    await client.query('DELETE FROM trip_photos WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM bookings WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM document_metadata WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_badges WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM published_routes WHERE creator_user_id = $1', [userId]);
    await client.query('DELETE FROM sync_operations WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM travel_preferences WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM travel_profiles WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM trips WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM app_users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    await destroySession(req);
    res.clearCookie('jelajah.sid', { path: '/', httpOnly: true, secure: NODE_ENV === 'production', sameSite: 'lax' });
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});

// Autosave API for the current local-first UI. It stores a bounded, sanitized snapshot per account.
app.get('/api/state', requireUser, async (req, res, next) => {
  noStore(res);
  try {
    const result = await pool.query('SELECT payload, version, updated_at FROM user_app_state WHERE user_id = $1', [req.appUser.id]);
    const row = result.rows[0];
    res.json({ state: row ? row.payload : null, version: row ? row.version : 0, updatedAt: row ? row.updated_at : null });
  } catch (error) { next(error); }
});

app.delete('/api/state', csrfProtection, requireUser, async (req, res, next) => {
  noStore(res);
  try {
    await pool.query('DELETE FROM user_app_state WHERE user_id = $1', [req.appUser.id]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.put('/api/state', csrfProtection, requireUser, async (req, res, next) => {
  noStore(res);
  const baseVersion = Number(req.body && req.body.baseVersion);
  if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) return res.status(400).json({ error: 'Versi dasar sinkronisasi tidak valid.' });
  const validation = sanitizeAppState(req.body && req.body.state);
  if (!validation.ok) return res.status(400).json({ error: validation.error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT payload, version, updated_at FROM user_app_state WHERE user_id = $1 FOR UPDATE', [req.appUser.id]);
    const row = current.rows[0];
    if (!row) {
      if (baseVersion !== 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Versi cloud berubah. Muat ulang status sinkronisasi.', version: 0, state: null });
      }
      const inserted = await client.query(
        'INSERT INTO user_app_state (user_id, payload, version) VALUES ($1, $2::jsonb, 1) ON CONFLICT (user_id) DO NOTHING RETURNING version, updated_at',
        [req.appUser.id, JSON.stringify(validation.value)]
      );
      if (inserted.rowCount) {
        await client.query('COMMIT');
        return res.json({ ok: true, version: inserted.rows[0].version, updatedAt: inserted.rows[0].updated_at });
      }
      const latest = await client.query('SELECT payload, version, updated_at FROM user_app_state WHERE user_id = $1', [req.appUser.id]);
      await client.query('COMMIT');
      return res.status(409).json({ error: 'Versi cloud dibuat dari tab lain.', version: latest.rows[0].version, state: latest.rows[0].payload });
    }
    if (baseVersion !== Number(row.version)) {
      await client.query('COMMIT');
      return res.status(409).json({ error: 'Versi cloud berubah pada perangkat lain.', version: row.version, state: row.payload, updatedAt: row.updated_at });
    }
    const updated = await client.query(
      'UPDATE user_app_state SET payload = $1::jsonb, version = version + 1, updated_at = now() WHERE user_id = $2 RETURNING version, updated_at',
      [JSON.stringify(validation.value), req.appUser.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, version: updated.rows[0].version, updatedAt: updated.rows[0].updated_at });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});

// Normalized trip endpoints are ready for the next UI/API integration phase.
app.get('/api/trips', requireUser, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id::text AS id, title, destination, starts_on AS "startsOn", ends_on AS "endsOn",
              budget_amount AS "budgetAmount", currency_code AS currency, travel_style AS "travelStyle", status,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM trips WHERE user_id = $1 AND deleted_at IS NULL ORDER BY starts_on NULLS LAST, created_at DESC LIMIT 100`,
      [String(req.appUser.id)]
    );
    res.json({ trips: result.rows });
  } catch (error) { next(error); }
});

app.post('/api/trips', csrfProtection, requireUser, async (req, res, next) => {
  const check = validateTripInput(req.body);
  if (!check.ok) return res.status(400).json({ error: check.error });
  try {
    const t = check.value;
    const result = await pool.query(
      `INSERT INTO trips (user_id, title, destination, starts_on, ends_on, budget_amount, travel_style, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'planning')
       RETURNING id::text AS id, title, destination, starts_on AS "startsOn", ends_on AS "endsOn",
                 budget_amount AS "budgetAmount", currency_code AS currency, travel_style AS "travelStyle", status, created_at AS "createdAt"`,
      [String(req.appUser.id), t.title, t.destination, t.startsOn, t.endsOn, t.budgetAmount, t.travelStyle]
    );
    res.status(201).json({ trip: result.rows[0] });
  } catch (error) { next(error); }
});

app.patch('/api/trips/:id', csrfProtection, requireUser, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'ID perjalanan tidak valid.' });
  try {
    const current = await pool.query('SELECT * FROM trips WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [id, String(req.appUser.id)]);
    if (!current.rowCount) return res.status(404).json({ error: 'Perjalanan tidak ditemukan.' });
    const row = current.rows[0];
    const check = validateTripInput({
      title: req.body.title ?? row.title,
      destination: req.body.destination ?? row.destination,
      startsOn: req.body.startsOn ?? dateOnly(row.starts_on),
      endsOn: req.body.endsOn ?? dateOnly(row.ends_on),
      budgetAmount: req.body.budgetAmount ?? row.budget_amount,
      travelStyle: req.body.travelStyle ?? row.travel_style
    });
    if (!check.ok) return res.status(400).json({ error: check.error });
    const t = check.value;
    const updated = await pool.query(
      `UPDATE trips SET title=$1, destination=$2, starts_on=$3, ends_on=$4, budget_amount=$5, travel_style=$6, updated_at=now(), version=version+1
       WHERE id=$7 AND user_id=$8 RETURNING id::text AS id, title, destination, starts_on AS "startsOn", ends_on AS "endsOn", budget_amount AS "budgetAmount", travel_style AS "travelStyle", status, updated_at AS "updatedAt"`,
      [t.title,t.destination,t.startsOn,t.endsOn,t.budgetAmount,t.travelStyle,id,String(req.appUser.id)]
    );
    res.json({ trip: updated.rows[0] });
  } catch (error) { next(error); }
});

app.delete('/api/trips/:id', csrfProtection, requireUser, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'ID perjalanan tidak valid.' });
  try {
    const result = await pool.query(
      `UPDATE trips SET deleted_at=now(), status='archived', updated_at=now(), version=version+1
       WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING id`,
      [id, String(req.appUser.id)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Perjalanan tidak ditemukan.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint API tidak ditemukan.' }));
app.get('*', (req, res, next) => {
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error && error.type === 'entity.too.large') return res.status(413).json({ error: 'Ukuran permintaan terlalu besar.' });
  if (error && error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON permintaan tidak valid.' });
  console.error('Request failed:', req.method, req.path, error && error.message);
  res.status(500).json({ error: 'Terjadi kesalahan server. Data lokal di browser tetap tersedia.' });
});

module.exports = { app, pool };
