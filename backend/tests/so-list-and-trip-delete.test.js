'use strict';

/**
 * Regression suite for:
 * 1. GET /api/so & GET /api/so/stats — valid T-SQL clause order (WHERE after OUTER APPLY) and no duplicate WHERE/AND clauses
 * 2. Native SO delete (bulk-cancel-delete & DELETE /api/so/:id) — MERGE wf.SalesOrderExt provides NOT NULL WfRef & SoPrefix
 * 3. DELETE /api/trips/:id — valid role/scope check (no unknown trip.create capability), blocks when active orders remain,
 *    and marks wf.SalesTrip Status = 'DELETED' without referencing non-existent UpdatedAt column.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

let tripActiveCount = 0;

const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.v_AllSalesOrders WHERE (CAST\(Id AS INT\)|Id) = @id/.test(text)) {
    if (Number(inputs.id) === 289050 || inputs.id === '289050') {
      return [{
        Id: '289050',
        WfRef: 'I69-05000',
        SoPrefix: 'I',
        Status: 'CANCELLED',
        SalesUserId: 34,
        ImportedDocuNo: 'I69-05000',
        TripId: 88,
      }];
    }
    return [];
  }
  if (/FROM wf\.EditReason\s+WHERE ReasonCode = @code/.test(text)) {
    return inputs.code === 'SO_DELETED'
      ? [{ ReasonCode: 'SO_DELETED', ReasonText: 'ลบบิล', AppliesTo: 'SO_DELETE', IsActive: 1 }]
      : [];
  }
  if (/SELECT COUNT_BIG\(\*\) AS TotalCount\s+FROM/i.test(text)) {
    return [{ TotalCount: 0 }];
  }
  if (/SELECT TripId, Status FROM wf\.SalesTrip WITH \(NOLOCK\) WHERE TripId = @tid/.test(text)) {
    return [53, 88].includes(Number(inputs.tid)) ? [{ TripId: Number(inputs.tid), Status: 'DRAFT' }] : [];
  }
  if (/FROM wf\.SalesTrip t WHERE t\.TripId = @tid/.test(text)) {
    // Trip 88 belongs to user 34; Trip 53 belongs to user 20 only
    const ids = Object.entries(inputs).filter(([k]) => /^t[ea][cm]/.test(k)).map(([, v]) => Number(v));
    if (Number(inputs.tid) === 88 && ids.includes(34)) return [{ ok: 1 }];
    if (Number(inputs.tid) === 53 && ids.includes(20)) return [{ ok: 1 }];
    return [];
  }
  if (/SELECT COUNT\(\*\) AS Cnt\s+FROM \(/i.test(text) && text.includes('wf.SalesOrder so')) {
    return [{ Cnt: tripActiveCount }];
  }
  return [];
}, { activeUserIds: h.TEST_USERS });

let app;
test.before(async () => {
  app = await h.startApp([
    ['/api/so', '../../routes/so'],
    ['/api/trips', '../../routes/trips'],
  ]);
});
test.after(async () => { await app.close(); });

test('GET /api/so?page=1&limit=20 and page=2 emit valid T-SQL without duplicate WHERE or WHERE before OUTER APPLY', async () => {
  const before = db.calls.length;
  const r = await app.call('GET', '/api/so?page=1&limit=20', { user: { sub: 12, role: 'ADMIN' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const mainCall = db.calls.slice(before).find((c) => /WITH Orders AS/i.test(c.text));
  assert.ok(mainCall, 'main CTE query executed');

  const outerApplyIdx = mainCall.text.indexOf('OUTER APPLY');
  const pqEndIdx = mainCall.text.indexOf(') pq');
  const wfWhereIdx = mainCall.text.indexOf("WHERE so.Status <> 'DELETED'");
  assert.ok(outerApplyIdx > 0 && pqEndIdx > outerApplyIdx, 'OUTER APPLY pq present');
  assert.ok(wfWhereIdx > pqEndIdx, 'WHERE so.Status <> DELETED must appear AFTER ) pq, never before OUTER APPLY');
  assert.equal((mainCall.text.match(/WHERE so\.Status <> 'DELETED'/g) || []).length, 1);
  assert.equal((mainCall.text.match(/ISNULL\(ext\.IsDeleted, 0\) = 0/g) || []).length, 1);

  const before2 = db.calls.length;
  const r2 = await app.call('GET', '/api/so?page=2&limit=20', { user: { sub: 12, role: 'ADMIN' } });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  const countCall = db.calls.slice(before2).find((c) => /SELECT COUNT_BIG\(\*\) AS TotalCount/i.test(c.text));
  assert.ok(countCall, 'empty-page count fallback query executed on page=2');
  assert.equal((countCall.text.match(/WHERE so\.Status <> 'DELETED'/g) || []).length, 1);
  assert.equal((countCall.text.match(/ISNULL\(ext\.IsDeleted, 0\) = 0/g) || []).length, 1);
});

test('GET /api/so/stats excludes DELETED drafts on wf.SalesOrder', async () => {
  const before = db.calls.length;
  const r = await app.call('GET', '/api/so/stats?bust=1', { user: { sub: 12, role: 'ADMIN' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const statsCall = db.calls.slice(before).find((c) => /SELECT Status, COUNT\(\*\) AS Cnt/i.test(c.text));
  assert.ok(statsCall, 'stats query executed');
  assert.ok(statsCall.text.includes("WHERE so.Status <> 'DELETED'"));
});

test('POST /api/so/bulk-cancel-delete native DELETE populates WfRef/SoPrefix on SalesOrderExt MERGE and omits SalesTrip.UpdatedAt', async () => {
  tripActiveCount = 0;
  const before = db.calls.length;
  const r = await app.call('POST', '/api/so/bulk-cancel-delete', {
    body: { soIds: ['289050'], action: 'DELETE', reasonCode: 'SO_DELETED', reasonText: 'ลบบิล' },
    user: { sub: 12, role: 'ADMIN' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const calls = db.calls.slice(before);
  const mergeCall = calls.find((c) => /MERGE wf\.SalesOrderExt AS target/i.test(c.text));
  assert.ok(mergeCall, 'MERGE wf.SalesOrderExt executed');
  assert.ok(mergeCall.text.includes('INSERT (SOID, WfRef, SoPrefix, IsDeleted, DeletedAt, CreatedAt, UpdatedAt)'));
  assert.equal(mergeCall.inputs.wfRef, 'I69-05000');
  assert.equal(mergeCall.inputs.soPrefix, 'I');

  const tripDelCall = calls.find((c) => /UPDATE wf\.SalesTrip SET Status = 'DELETED'/i.test(c.text));
  assert.ok(tripDelCall, 'SalesTrip marked DELETED when 0 orders remain');
  assert.ok(!tripDelCall.text.includes('UpdatedAt'), 'wf.SalesTrip has no UpdatedAt column');
});

test('DELETE /api/so/:id on native bill also marks SalesOrderExt.IsDeleted via MERGE', async () => {
  const before = db.calls.length;
  const r = await app.call('DELETE', '/api/so/289050', {
    body: { reasonCode: 'SO_DELETED', reason: 'ลบเดี่ยว' },
    user: { sub: 12, role: 'ADMIN' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mergeCall = db.calls.slice(before).find((c) => /MERGE wf\.SalesOrderExt AS target/i.test(c.text));
  assert.ok(mergeCall, 'MERGE wf.SalesOrderExt executed on single DELETE');
  assert.ok(mergeCall.text.includes('WfRef') && mergeCall.text.includes('SoPrefix'));
});

test('DELETE /api/trips/:id enforces scope, rejects active bills (409), and deletes empty trip without UpdatedAt', async () => {
  // 1. Out-of-scope SALES gets 404 (not 500 unknown capability)
  const outScope = await app.call('DELETE', '/api/trips/53', { user: { sub: 34, role: 'SALES' } });
  assert.equal(outScope.status, 404);

  // 2. Trip with active bills returns 409
  tripActiveCount = 2;
  const hasBills = await app.call('DELETE', '/api/trips/88', { user: { sub: 34, role: 'SALES' } });
  assert.equal(hasBills.status, 409, JSON.stringify(hasBills.body));

  // 3. Empty scoped trip deletes cleanly without referencing UpdatedAt
  tripActiveCount = 0;
  const before = db.calls.length;
  const ok = await app.call('DELETE', '/api/trips/88', { user: { sub: 34, role: 'SALES' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const updCall = db.calls.slice(before).find((c) => /UPDATE wf\.SalesTrip SET Status = 'DELETED'/i.test(c.text));
  assert.ok(updCall, 'SalesTrip updated to DELETED');
  assert.ok(!updCall.text.includes('UpdatedAt'), 'must not reference non-existent UpdatedAt column');
});
