'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let failLookup = false;
const db = h.installDbStub(({ text, inputs }) => {
  if (/SELECT Id, EmpId, PositionCode FROM wf.AppUser/.test(text)) return [{ Id: inputs.id, EmpId: inputs.id === 11 ? 101 : 102, PositionCode: null }];
  if (/NativeScopeSources/.test(text)) {
    if (failLookup) throw new Error('private database diagnostic');
    return Object.entries(inputs).map(([key, id]) => ({ SourceType: key.replace(/\d+$/, ''), SourceID: id,
      OwnerSOID: id, EmpID: id === 501 ? 101 : 102, SalesUserId: null }));
  }
  return [];
}, { activeUserIds: [11, 12, 34, 99] });
function fixture(id) {
  return { resolved: true, chain: { bookings: [{ soId: id, docuNo: 'TEST', custName: 'fixture customer' }],
    deliveries: [], coupons: [], redemptions: [], invoices: [] }, truncated: id === 777, isAmbiguous: id === 778 };
}
const resolverPath = require.resolve('../services/native-document-resolver');
require.cache[resolverPath] = { id: resolverPath, filename: resolverPath, loaded: true,
  exports: { resolveNativeDocumentChain: async options => fixture(Number(options.exactId)) } };
const policyPath = require.resolve('../services/ticket-policy');
const policy = require('../services/ticket-policy');
require.cache[policyPath].exports = { ...policy, traceNativeTicketChain: async (_ref, options) => fixture(Number(options.exactId)) };
let app;
test.before(async () => { app = await h.startApp([['/api/master', '../../routes/master']]); });
test.after(async () => { await app.close(); });
test('typed and legacy trace allow the owner and conceal a foreign chain', async () => {
  for (const url of ['/api/master/control-tickets/typed/BOOKING/501', '/api/master/control-tickets/TEST/trace?entityType=BOOKING&exactId=501']) {
    assert.equal((await app.call('GET', url, { user: { sub: 11, role: 'SALES' } })).status, 200);
    const forbidden = await app.call('GET', url, { user: { sub: 12, role: 'SALES', actorSub: 99, actorRole: 'ADMIN' } });
    assert.equal(forbidden.status, 404);
    assert.equal(forbidden.body.chain, undefined);
  }
});
test('operational all-record roles keep access to the same foreign chain', async () => {
  for (const role of ['WAREHOUSE', 'ACCOUNTING', 'COUNTER_SALES']) {
    assert.equal((await app.call('GET', '/api/master/control-tickets/typed/BOOKING/501', { user: { sub: 34, role } })).status, 200);
  }
});
test('scoped users cannot receive ambiguous or truncated graph details', async () => {
  for (const id of [777, 778]) assert.equal((await app.call('GET', '/api/master/control-tickets/typed/BOOKING/' + id,
    { user: { sub: 11, role: 'SALES' } })).status, 404);
});
test('ownership lookup failure returns 503 without the diagnostic or chain', async () => {
  failLookup = true;
  try {
    const r = await app.call('GET', '/api/master/control-tickets/typed/BOOKING/501', { user: { sub: 11, role: 'SALES' } });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { message: 'Document scope could not be verified' });
  } finally { failLookup = false; }
});
test('line and draw queries bind effective-user scope on both exact-ID and document-number paths', async () => {
  for (const suffix of ['/TEST?entityType=COUPON&exactId=600', '/TEST/draws?entityType=COUPON&exactId=600',
    '/TEST/draws?entityType=BOOKING&exactId=501', '/TEST?entityType=DRAFT&exactId=1', '/TEST', '/TEST/draws']) {
    const before = db.calls.length;
    assert.equal((await app.call('GET', '/api/master/control-tickets' + suffix, { user: { sub: 11, role: 'SALES' } })).status, 200);
    const reads = db.calls.slice(before).filter(c => c.kind === 'query');
    assert.ok(reads.length);
    for (const read of reads) {
      assert.match(read.text, /AND \(.*(?:EmpID|SalesUserId)/);
      assert.ok(Object.entries(read.inputs).some(([k, v]) => /^(?:dcp|ddv|lcp|ldr|lso)[EU]/.test(k) && [11, '101'].includes(v)));
    }
  }
});
