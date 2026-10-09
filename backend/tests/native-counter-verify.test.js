'use strict';

/**
 * UAT full loop 2026-10-09 (FL13): a WinSpeed bill unlocked for an edit reads DRAFT. The counter's check (FR-022)
 * wrote wf.SalesOrder, where the bill has no row, and answered success; re-confirming never asked for the check.
 * The check now lives on wf.SalesOrderExt (migration 149), confirm asks for it and clears it when the bill is locked.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const ext = { 278000: { SOID: '278000', TripId: null, IsUnlocked: true, VerifiedAt: null, ConfirmedAt: '2026-10-06T00:00:00Z' } };
const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.v_AllSalesOrders WHERE CAST\(Id AS INT\) = @id/.test(text)) {
    if (Number(inputs.id) === 278000) return [{ Id: '278000', Status: 'DRAFT', SalesUserId: 43, WfRef: 'I69-04219', CustId: '1078' }];
    if (Number(inputs.id) === 21) return [{ Id: 21, Status: 'DRAFT', SalesUserId: 43, WfRef: 'I69-09021', CustId: '1078' }];
    return [];
  }
  if (/UPDATE wf\.SalesOrderExt SET VerifiedBy=@uid/.test(text)) {
    const row = ext[inputs.id];
    if (row && row.IsUnlocked) { row.VerifiedAt = new Date(); return { recordset: [], rowsAffected: [1] }; }
    return { recordset: [], rowsAffected: [0] };
  }
  if (/UPDATE wf\.SalesOrder SET VerifiedBy=@uid/.test(text)) return { recordset: [], rowsAffected: [Number(inputs.id) === 21 ? 1 : 0] };
  if (/FROM wf\.SalesOrderExt WHERE SOID=@id/.test(text)) return ext[inputs.id] ? [{ ...ext[inputs.id] }] : [];
  return [];
});

let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so']]); });
test.after(async () => { await app.close(); });

test('re-confirming an unlocked WinSpeed bill asks for the counter check first', async () => {
  const r = await app.call('PATCH', '/api/so/278000/confirm', { body: {}, user: { sub: 43, role: 'SALES' } });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.message, /FR-022/);
});

test('the counter check of an unlocked WinSpeed bill is kept on the extension', async () => {
  const before = db.calls.length;
  const r = await app.call('PATCH', '/api/so/278000/verify', { user: { sub: 64, role: 'COUNTER_SALES' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const calls = db.calls.slice(before);
  assert.ok(calls.some(c => /UPDATE wf\.SalesOrderExt SET VerifiedBy=@uid/.test(c.text)));
  assert.ok(!calls.some(c => /UPDATE wf\.SalesOrder SET VerifiedBy/.test(c.text)), 'no draft update for a WinSpeed bill');
  assert.ok(ext[278000].VerifiedAt);
});

test('after the check the bill is locked again and the check is cleared for the next edit', async () => {
  const before = db.calls.length;
  const r = await app.call('PATCH', '/api/so/278000/confirm', { body: {}, user: { sub: 43, role: 'SALES' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const lock = db.calls.slice(before).find(c => /UPDATE wf\.SalesOrderExt\s+SET IsUnlocked = 0/.test(c.text));
  assert.ok(lock, 'bill locked');
  assert.match(lock.text, /VerifiedBy = NULL, VerifiedAt = NULL/);
});

test('a draft is still checked on wf.SalesOrder', async () => {
  const before = db.calls.length;
  const r = await app.call('PATCH', '/api/so/21/verify', { user: { sub: 64, role: 'COUNTER_SALES' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(db.calls.slice(before).some(c => /UPDATE wf\.SalesOrder SET VerifiedBy=@uid/.test(c.text)));
});

test('the trip confirm locks an unlocked WinSpeed member only after the check', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/trips'), 'utf8');
  assert.match(src, /ต้องตรวจซ้ำ \(Counter-Sales\) ก่อนยืนยัน \(FR-022\)/);
  assert.match(src, /IsUnlocked = 0\s+WHERE SOID = @soid/);
});

test('a new trip takes in a WinSpeed bill that is in no trip yet', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/trips'), 'utf8');
  assert.match(src, /UPDATE wf\.SalesOrderExt SET TripId = @tripId, UpdatedAt = SYSUTCDATETIME\(\)\s+WHERE SOID = @soid AND TripId IS NULL AND \(@own = 0 OR SalesUserId = @uid\)/);
});
