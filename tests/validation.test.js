'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateDisplayName,
  validateTripInput,
  sanitizeAppState
} = require('../server/lib/validation');

test('normalizes email and validates expected formats', () => {
  assert.equal(normalizeEmail('  TRAVELER@example.com  '), 'traveler@example.com');
  assert.equal(validateEmail('Traveler@example.com'), true);
  assert.equal(validateEmail('bad-email'), false);
  assert.equal(validateEmail(''), false);
});

test('password and profile name boundaries are enforced', () => {
  assert.equal(validatePassword('a-long-demo-password'), true);
  assert.equal(validatePassword('short'), false);
  assert.equal(validatePassword('x'.repeat(129)), false);
  assert.equal(validateDisplayName('Ravindra'), true);
  assert.equal(validateDisplayName('x'.repeat(81)), false);
});

test('trip validation blocks invalid dates, names, and budgets', () => {
  assert.equal(validateTripInput({ title:'Bali', destination:'Bali', startsOn:'2026-10-20', endsOn:'2026-10-25', budgetAmount:2500000 }).ok, true);
  assert.equal(validateTripInput({ title:'', destination:'Bali' }).ok, false);
  assert.equal(validateTripInput({ title:'Bali', destination:'Bali', startsOn:'2026-10-25', endsOn:'2026-10-20', budgetAmount:1 }).ok, false);
  assert.equal(validateTripInput({ title:'Bali', destination:'Bali', startsOn:'2026-02-31', budgetAmount:1 }).ok, false);
  assert.equal(validateTripInput({ title:'Bali', destination:'Bali', budgetAmount:-1 }).ok, false);
});

test('cloud snapshot strips phone contacts and permission flags', () => {
  const input = {
    trips: [], itineraries: {}, contacts: [{ id:'c1', name:'Trusted', phone:'+628123456' }],
    documents: [{ id:'d1', title:'Passport reminder', type:'Reminder', expiry:'2027-01-01', note:'private note' }],
    settings: { style:'Slow travel', locationConsent:true, analyticsConsent:true }
  };
  const result = sanitizeAppState(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.contacts, []);
  assert.deepEqual(result.value.documents, [{ id:'d1', title:'Passport reminder', type:'Reminder', expiry:'2027-01-01' }]);
  assert.equal('locationConsent' in result.value.settings, false);
  assert.equal('analyticsConsent' in result.value.settings, false);
  assert.equal(input.contacts.length, 1, 'sanitizer should not mutate the caller object');
});

test('rejects huge or wrongly shaped cloud state', () => {
  assert.equal(sanitizeAppState([]).ok, false);
  assert.equal(sanitizeAppState({ trips: 'not-an-array' }).ok, false);
  assert.equal(sanitizeAppState({ text: 'x'.repeat(260_000) }).ok, false);
});
