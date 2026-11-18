'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const { stub: db } = h.installDbStub(() => [], { activeUserIds: h.TEST_USERS });
let approved = false, headerChanged = false, bookCreated = false, linesDeleted = false, lineInserted = false, bookStatus = 'ACTIVE';
db.wfTransaction = async fn => {
  const original = approved;
  const originalHeader = headerChanged;
  const originalCreated = bookCreated;
  const originalLinesDeleted = linesDeleted;
  const originalInserted = lineInserted, originalStatus = bookStatus;
  const tx = { request() {
    return { input() { return this; }, async query(text) {
      if (/FROM wf.PriceBookSpecialPrice sp/.test(text)) return { recordset: [{ Id: 7, RequestedBy: 2, GoodId: null, PriceBookId: 3, BookStatus: 'ACTIVE' }] };
      if (/COL_LENGTH\('wf.PriceBook'/.test(text)) return { recordset: [{ HasPb: 1, HasLine: 1, HasSpProc: 1 }] };
      if (/UPDATE wf.PriceBookSpecialPrice SET ApprovedPrice/.test(text)) { approved = true; return { rowsAffected: [1], recordset: [] }; }
      if (/FROM wf.PriceBook WITH \(UPDLOCK,HOLDLOCK\) WHERE Id=@id/.test(text)) return { recordset: [{ Id: 3, Name: 'test', Status: bookStatus, EffectiveMonth: '2026-11', SourceSetPriceIds: '123', EffectiveFrom: '2026-11-01', EffectiveTo: '2026-11-30' }] };
      if (/UPDATE wf.PriceBook\s+SET Name/.test(text)) { headerChanged = true; return { rowsAffected: [1], recordset: [] }; }
      if (/INSERT INTO wf.PriceBook \(Name/.test(text)) { bookCreated = true; return { rowsAffected: [1], recordset: [{ Id: 9 }] }; }
      if (/SELECT GoodId, WinSpeedSetPriceId, WinSpeedListNo/.test(text)) return { recordset: [{ GoodId: '101', WinSpeedSetPriceId: 123, WinSpeedListNo: 1 }] };
      if (/DELETE FROM wf.PriceBookLine/.test(text)) { linesDeleted = true; return { rowsAffected: [1], recordset: [] }; }
      if (/INSERT INTO wf.PriceBookLine/.test(text)) { lineInserted = true; return { rowsAffected: [1], recordset: [] }; }
      if (/UPDATE wf.PriceBook SET Status=@s/.test(text)) { bookStatus = 'ACTIVE'; return { rowsAffected: [1], recordset: [] }; }
      return { recordset: [], rowsAffected: [1] };
    } };
  } };
  try { return await fn(tx); } catch (error) { approved = original; headerChanged = originalHeader; bookCreated = originalCreated; linesDeleted = originalLinesDeleted; lineInserted = originalInserted; bookStatus = originalStatus; throw error; }
};
const servicePath = require.resolve('../services/pricebook-winspeed-sync');
const real = require(servicePath);
require.cache[servicePath].exports = { ...real, syncSpecialPriceToWinSpeed: async () => {
  throw Object.assign(new Error('simulated WinSpeed failure'), { status: 503 });
}, syncBookToWinSpeed: async () => { throw Object.assign(new Error('simulated WinSpeed failure'), { status: 503 }); } };
let app;
test.before(async () => { app = await h.startApp([['/api/pricebook', '../../routes/pricebook']]); });
test.after(async () => app.close());

test('failed WinSpeed special price rolls back approval and returns an error', async () => {
  const result = await app.call('PATCH', '/api/pricebook/special/7', { user: { sub: 1, role: 'ADMIN' }, body: { approvedPrice: 100 } });
  assert.equal(result.status, 503); assert.equal(approved, false);
});

test('failed WinSpeed header sync rolls back the app header update', async () => {
  const result = await app.call('PUT', '/api/pricebook/3', { user: { sub: 1, role: 'ADMIN' }, body: { name: 'changed' } });
  assert.equal(result.status, 503); assert.equal(headerChanged, false);
});

test('failed WinSpeed sync rolls back creation of the app price book', async () => {
  const result = await app.call('POST', '/api/pricebook', { user: { sub: 1, role: 'ADMIN' },
    body: { name: 'new', effectiveFrom: '2026-11-01', effectiveTo: '2026-11-30', status: 'ACTIVE', seedFromCurrent: false } });
  assert.equal(result.status, 503); assert.equal(bookCreated, false);
});

test('active bulk replacement refuses to silently drop products from WinSpeed', async () => {
  const result = await app.call('POST', '/api/pricebook/3/lines', { user: { sub: 1, role: 'ADMIN' }, body: { lines: [] } });
  assert.equal(result.status, 409); assert.equal(result.body.code, 'PRICE_LINE_REMOVAL_REQUIRES_SUSPEND');
  assert.equal(linesDeleted, false);
});

test('failed WinSpeed bulk sync rolls back replaced app lines', async () => {
  const result = await app.call('POST', '/api/pricebook/3/lines', { user: { sub: 1, role: 'ADMIN' },
    body: { lines: [{ goodId: '101', lineStatus: 'SUSPENDED' }] } });
  assert.equal(result.status, 503); assert.equal(linesDeleted, false);
});

test('failed WinSpeed sync rolls back a new price line', async () => {
  const result = await app.call('POST', '/api/pricebook/3/lines/item', { user: { sub: 1, role: 'ADMIN' },
    body: { goodId: '102', lineStatus: 'SUSPENDED' } });
  assert.equal(result.status, 503); assert.equal(lineInserted, false);
});

test('failed WinSpeed sync rolls back activation', async () => {
  bookStatus = 'APPROVED';
  const result = await app.call('POST', '/api/pricebook/3/activate', { user: { sub: 1, role: 'ADMIN' }, body: {} });
  assert.equal(result.status, 503); assert.equal(bookStatus, 'APPROVED');
  bookStatus = 'ACTIVE';
});
