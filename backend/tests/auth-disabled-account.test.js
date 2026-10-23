'use strict';

/**
 * UAT 2026-10-09 (PERM-07): login refused a disabled user, but a token issued before kept working for its whole
 * 8 hours. Every request now checks the account (and the Access As actor) and a disabled one gets 401.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

let simulateDbError = false;
const active = { 43: true, 99: false, 25: true, 26: false };
const db = h.installDbStub(({ text, inputs }) => {
  if (/SELECT IsActive FROM wf\.AppUser WHERE Id = @id/.test(text)) {
    if (simulateDbError) throw new Error('Simulated transient DB error');
    return inputs.id in active ? [{ IsActive: active[inputs.id] }] : [];
  }
  return [];
});
const { clearAccountStatusCache } = require('../middleware/auth');

let app;
test.before(async () => { app = await h.startApp([['/api/quotation', '../../routes/quotation']]); });
test.after(async () => { await app.close(); });

test('an active account passes', async () => {
  const r = await app.call('GET', '/api/quotation', { user: { sub: 43, role: 'SALES' } });
  assert.notEqual(r.status, 401);
});

test('a disabled account is refused at once, whatever its token says', async () => {
  const r = await app.call('GET', '/api/quotation', { user: { sub: 99, role: 'SALES' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'ACCOUNT_DISABLED');
});

test('a disabled Access As actor is refused too', async () => {
  const r = await app.call('GET', '/api/quotation', { user: { sub: 43, role: 'SALES', actorSub: 26, actorRole: 'MANAGER' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'ACCOUNT_DISABLED');
});

test('re-enabling takes effect once the cache is cleared (the user admin route does that)', async () => {
  active[99] = true;
  clearAccountStatusCache(99);
  const r = await app.call('GET', '/api/quotation', { user: { sub: 99, role: 'SALES' } });
  assert.notEqual(r.status, 401);
});

test('an unknown user id is refused with 401 ACCOUNT_NOT_FOUND (fail-closed)', async () => {
  const r = await app.call('GET', '/api/quotation', { user: { sub: 12345, role: 'SALES' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'ACCOUNT_NOT_FOUND');
  assert.ok(db.calls.some(c => /SELECT IsActive FROM wf\.AppUser/.test(c.text)));
});

test('an unknown Access As actor is refused with 401 (fail-closed)', async () => {
  const r = await app.call('GET', '/api/quotation', { user: { sub: 43, role: 'SALES', actorSub: 88888, actorRole: 'MANAGER' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'ACCOUNT_NOT_FOUND');
});

test('an invalid/malformed user id is refused with 401 INVALID_TOKEN', async () => {
  const r = await app.call('GET', '/api/quotation', { user: { sub: -5, role: 'SALES' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'INVALID_TOKEN');
});

test('a database lookup error returns 503 SERVICE_UNAVAILABLE and is not cached', async () => {
  clearAccountStatusCache(43);
  simulateDbError = true;
  try {
    const r1 = await app.call('GET', '/api/quotation', { user: { sub: 43, role: 'SALES' } });
    assert.equal(r1.status, 503);
    assert.equal(r1.body.code, 'SERVICE_UNAVAILABLE');
    assert.ok(!/SELECT|sql|error/i.test(r1.body.message || ''), 'Does not leak SQL details');
  } finally {
    simulateDbError = false;
  }
  // Transient failure recovers immediately without needing manual cache clear
  const r2 = await app.call('GET', '/api/quotation', { user: { sub: 43, role: 'SALES' } });
  assert.notEqual(r2.status, 503);
  assert.notEqual(r2.status, 401);
});
