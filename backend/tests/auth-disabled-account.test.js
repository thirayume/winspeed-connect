'use strict';

/**
 * UAT 2026-10-09 (PERM-07): login refused a disabled user, but a token issued before kept working for its whole
 * 8 hours. Every request now checks the account (and the Access As actor) and a disabled one gets 401.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const active = { 43: true, 99: false, 25: true, 26: false };
const db = h.installDbStub(({ text, inputs }) => {
  if (/SELECT IsActive FROM wf\.AppUser WHERE Id = @id/.test(text)) {
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
});

test('re-enabling takes effect once the cache is cleared (the user admin route does that)', async () => {
  active[99] = true;
  clearAccountStatusCache(99);
  const r = await app.call('GET', '/api/quotation', { user: { sub: 99, role: 'SALES' } });
  assert.notEqual(r.status, 401);
});

test('an unknown user id does not block (only a row with IsActive = 0 does)', async () => {
  const r = await app.call('GET', '/api/quotation', { user: { sub: 12345, role: 'SALES' } });
  assert.notEqual(r.status, 401);
  assert.ok(db.calls.some(c => /SELECT IsActive FROM wf\.AppUser/.test(c.text)));
});
