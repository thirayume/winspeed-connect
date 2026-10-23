'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let rows = [];
const db = h.installDbStub(call => {
  if (call.text.includes('FROM dbo.WGHD h') && call.text.includes('BookingNo')) return rows;
  return [];
}, { activeUserIds: [11] });
let app;
test.before(async () => { app = await h.startApp([['/api/weighing', '../../routes/weighing']]); });
test.after(async () => { await app.close(); });
const path = '/api/weighing/by-so?from=2026-09-01&to=2026-10-31';
const dataCalls = () => db.calls.filter(c => c.text.includes('FROM dbo.WGHD h'));

test('weighing report requires authentication and keeps SALES outside operational readers', async () => {
  const count = dataCalls().length;
  assert.equal((await app.call('GET', path)).status, 401);
  assert.equal((await app.call('GET', path, { user: { sub: 11, role: 'SALES' } })).status, 403);
  assert.equal(dataCalls().length, count);
});

test('weighing report requests typed delivery links and retains a differently numbered delivery', async () => {
  rows = [{ WeighId: 1, BookingNo: 'I69-00001', DeliveryNoteNo: 'K69-00002', DeliveryNoteCount: 1, WeightNet: 1000 }];
  const result = await app.call('GET', path, { user: { sub: 11, role: 'ACCOUNTING' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.rows, rows);
  assert.equal(result.body.count, 1);
  const call = dataCalls().at(-1);
  assert.equal(call.kind, 'query');
  assert.equal(call.inputs.from, '2026-09-01');
  assert.equal(call.inputs.to, '2026-10-31');
  assert.match(call.text, /link\.RefSOID\s*=\s*bk\.SOID/);
  assert.match(call.text, /COUNT\(DISTINCT dn\.SOID\)/);
  assert.doesNotMatch(call.text, /dn\.DocuNo\s*=\s*bk\.DocuNo|SELECT TOP 1 dn/);
  assert.doesNotMatch(call.text, /\b(?:INSERT|UPDATE|DELETE|EXEC)\b/i);
});

test('no child and multiple children remain distinguishable without an arbitrary delivery number', async () => {
  rows = [{ WeighId: 2, DeliveryNoteNo: null, DeliveryNoteCount: 0 }, { WeighId: 3, DeliveryNoteNo: null, DeliveryNoteCount: 2 }];
  const result = await app.call('GET', path, { user: { sub: 11, role: 'WAREHOUSE' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.rows, rows);
  assert.equal(result.body.count, 2);
});
