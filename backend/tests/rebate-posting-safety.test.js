'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(() => [], { activeUserIds: h.TEST_USERS });
let app;
test.before(async () => { app = await h.startApp([['/api/rebate-pool', '../../routes/rebate-pool']]); });
test.after(async () => app.close());

test('unverified caller input cannot create rebate balances, issue tickets or deduct tickets', async () => {
  for (const path of ['/ledger', '/tickets/issue', '/tickets/redeem', '/conversions/execute']) {
    const before = db.calls.length;
    const result = await app.call('POST', `/api/rebate-pool${path}`, { user: { sub: 1, role: 'ADMIN' },
      body: { custId: 1, goodId: 1, requestedTonnage: 10, agingOverrideGranted: true, asOfDate: '1900-01-01' } });
    assert.equal(result.status, 503, path);
    assert.equal(db.calls.slice(before).some(c => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(c.text)), false, path);
  }
});

test('unprivileged users cannot convert or redeem tickets', async () => {
  for (const path of ['/tickets/redeem', '/conversions/execute']) {
    const result = await app.call('POST', `/api/rebate-pool${path}`, { user: { sub: 2, role: 'WAREHOUSE' }, body: {} });
    assert.equal(result.status, 403, path);
  }
});

test('sales cannot retrieve rebate money through the new pool endpoints', async () => {
  for (const path of ['/ledger', '/queue/123', '/alerts', '/conversions', '/tickets?custId=123', '/aging/123']) {
    const result = await app.call('GET', `/api/rebate-pool${path}`, { user: { sub: 2, role: 'SALES' } });
    assert.equal(result.status, 403, path);
  }
});

test('aging does not disclose a customer outside the actor and effective scope', async () => {
  const before = db.calls.length;
  const result = await app.call('GET', '/api/rebate-pool/aging/123', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(result.status, 404);
  assert.ok(!db.calls.slice(before).some(c => /ARPay|ARCard/i.test(c.text)));
});

test('ticket reads do not expose another customer or ticket history', async () => {
  for (const path of ['/tickets?custId=123', '/tickets/9/history']) {
    const before = db.calls.length;
    const result = await app.call('GET', `/api/rebate-pool${path}`, { user: { sub: 1, role: 'ADMIN' } });
    assert.equal(result.status, 404, path);
    assert.ok(!db.calls.slice(before).some(c => /FROM wf\.TicketRedemptionHistory/i.test(c.text)));
  }
});

test('expiry and extension stay closed until the ticket lifecycle is verified', async () => {
  for (const path of ['/tickets/expire', '/tickets/1/extend']) {
    const before = db.calls.length;
    const result = await app.call('POST', `/api/rebate-pool${path}`, { user: { sub: 1, role: 'ADMIN' },
      body: { asOfDate: '2099-01-01', force: true } });
    assert.equal(result.status, 503, path);
    assert.ok(!db.calls.slice(before).some(c => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(c.text)));
  }
});

test('legacy alert job stays closed', async () => {
  const before = db.calls.length;
  const result = await app.call('POST', '/api/rebate-pool/alerts/check', { user: { sub: 1, role: 'ADMIN' }, body: { asOfDate: '2099-01-01', force: true } });
  assert.equal(result.status, 503);
  assert.ok(!db.calls.slice(before).some(c => /UPDATE\s+wf\.RebateTransactionLedger/i.test(c.text)));
});
