'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_STATE_BYTES = 250_000;

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function validateEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 254 && EMAIL_RE.test(email);
}

function validatePassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}

function validateDisplayName(value) {
  return typeof value === 'string' && value.trim().length <= 80;
}

function validateTripInput(body = {}) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
  const startsOn = body.startsOn || null;
  const endsOn = body.endsOn || null;
  const budgetAmount = Number(body.budgetAmount ?? 0);
  const travelStyle = typeof body.travelStyle === 'string' ? body.travelStyle.trim().slice(0, 60) : 'slow_travel';

  if (!title || title.length > 120) return { ok: false, error: 'Nama perjalanan wajib diisi (maksimal 120 karakter).' };
  if (!destination || destination.length > 160) return { ok: false, error: 'Destinasi wajib diisi (maksimal 160 karakter).' };
  if (startsOn && !isDateOnly(startsOn)) return { ok: false, error: 'Tanggal mulai tidak valid.' };
  if (endsOn && !isDateOnly(endsOn)) return { ok: false, error: 'Tanggal selesai tidak valid.' };
  if (startsOn && endsOn && endsOn < startsOn) return { ok: false, error: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' };
  if (!Number.isSafeInteger(budgetAmount) || budgetAmount < 0 || budgetAmount > 1_000_000_000_000) return { ok: false, error: 'Anggaran tidak valid.' };
  return { ok: true, value: { title, destination, startsOn, endsOn, budgetAmount, travelStyle } };
}

function sanitizeAppState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'State harus berupa object JSON.' };
  }
  let encoded;
  try { encoded = JSON.stringify(input); }
  catch { return { ok: false, error: 'State tidak bisa dikonversi ke JSON.' }; }
  if (!encoded || Buffer.byteLength(encoded, 'utf8') > MAX_STATE_BYTES) {
    return { ok: false, error: 'Data backup terlalu besar (maksimal 250 KB).' };
  }
  const copy = JSON.parse(encoded);
  if (copy.trips !== undefined && !Array.isArray(copy.trips)) return { ok: false, error: 'Field trips harus berupa daftar.' };
  if (copy.itineraries !== undefined && (!copy.itineraries || typeof copy.itineraries !== 'object' || Array.isArray(copy.itineraries))) {
    return { ok: false, error: 'Field itineraries harus berupa object.' };
  }

  // Privacy by default: phone numbers and local-only permission flags never leave the browser.
  copy.contacts = [];
  copy.documents = Array.isArray(copy.documents)
    ? copy.documents.slice(0, 200).map(doc => ({
        id: typeof doc.id === 'string' ? doc.id.slice(0, 100) : '',
        title: typeof doc.title === 'string' ? doc.title.slice(0, 180) : '',
        type: typeof doc.type === 'string' ? doc.type.slice(0, 40) : 'Reminder',
        expiry: typeof doc.expiry === 'string' ? doc.expiry.slice(0, 10) : ''
      }))
    : [];
  if (copy.settings && typeof copy.settings === 'object') {
    delete copy.settings.locationConsent;
    delete copy.settings.analyticsConsent;
  }
  return { ok: true, value: copy };
}

module.exports = {
  MAX_STATE_BYTES,
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateDisplayName,
  validateTripInput,
  sanitizeAppState
};
