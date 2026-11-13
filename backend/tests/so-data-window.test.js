'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const { boundaries } = require('../services/data-window');
let date = '2026-01-01';
let unavailable = false;
let quoteRecord = null;
let replayRecord = null;
let rebateModeFixture = false;
let sourceCollisionFixture = false;
let bookingSnapshotFixture = false;
const db = h.installDbStub(({ text, inputs }) => {
  if (/WHERE x\.SourceDraftId=@id/.test(text)) return replayRecord ? [replayRecord] : [];
  if (/OBJECT_ID\('wf\.QuotationSourceSO', 'U'\)/.test(text)) return [{ HasTable: 1 }];
  if (/FROM wf\.QuotationSourceSO src WITH \(NOLOCK\)/.test(text) && /SELECT TOP 1 q\.Id/.test(text)) return quoteRecord ? [quoteRecord] : [];
  if (/FROM wf\.SystemSetting WHERE SettingKey = @k/.test(text)) return [{ SettingValue: '2022-01-01' }];
  if (/SELECT Status, COUNT\(\*\) AS Cnt/.test(text)) return [{ Status: 'DRAFT', Cnt: inputs.globalStartDate === '2026-01-01' ? 2 : 1 }];
  if (/SELECT COUNT_BIG\(\*\) AS TotalCount/.test(text)) return [{ TotalCount: 0 }];
  if (/COL_LENGTH\('wf\.SalesOrderLine', 'GiveawayApprovalStatus'\)/.test(text)) return [{ HasColumns: 1 }];
  if (rebateModeFixture && /SELECT \* FROM wf\.v_AllSalesOrders WHERE/.test(text) && inputs.id === 502) return [{ Id: 502, Status: 'DRAFT', ImportedDocuNo: 'I-TEST' }];
  if (rebateModeFixture && /FROM wf\.SalesOrderLine sol/.test(text)) return [{ LineNum: 1, GoodId: 12, RebatePricingMode: 'POOL' }];
  if (rebateModeFixture && /FROM wf\.v_AllSalesOrderLines WHERE/.test(text)) return [{ LineNum: 1, GoodId: 12 }];
  if (rebateModeFixture && /FROM wf\.SalesOrderLine cl WITH/.test(text)) return [{ LineNum: 1, RebatePricingMode: 'POOL' }];
  if (sourceCollisionFixture && /SELECT TOP 1 Id FROM wf\.SalesOrder WHERE Id=@soId AND Status='DRAFT'/.test(text)) return [{ Id: 502 }];
  if (bookingSnapshotFixture && /SELECT TOP 1 BookingSOID FROM wf\.RebateBookingPriceSnapshot/.test(text)) return [{ BookingSOID: 502 }];
  if (/SELECT \* FROM wf\.v_AllSalesOrders WHERE/.test(text) && inputs.id === 501) return [{ Id: 501, Status: 'DRAFT' }];
  if (/SELECT TOP 1 GrossScaleKg FROM wf\.WeighTicketItemLog/.test(text)) return [{ GrossScaleKg: 1000 }];
  if (/SELECT COUNT\(\*\) AS cnt FROM wf\.WeighTicketItemLog/.test(text)) return [{ cnt: 1 }];
  if (/SELECT DocuNo FROM dbo\.SOHD/.test(text) && inputs.id === 9999) return [{ DocuNo: 'TEST-RECENT' }];
  return [];
}, { activeUserIds: h.TEST_USERS, strictTypedInputs: true });
const path = require.resolve('../services/global-data-window-store');
require.cache[path] = { id: path, filename: path, loaded: true, exports: {
  readGlobalDataWindow: async () => { if (unavailable) throw new Error('PRIMARY_UNAVAILABLE'); return boundaries(date); },
} };
let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so']]); });
test.after(async () => { await app.close(); });
const admin = { sub: 1, role: 'ADMIN' };

test('draft mode is loaded only from draft rows; a native ID collision fails closed', async () => {
  rebateModeFixture = true;
  try {
    const draft = await app.call('GET', '/api/so/501', { user: admin });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.equal(draft.body.lines[0].rebatePricingMode, 'POOL');
    const native = await app.call('GET', '/api/so/502', { user: admin });
    assert.equal(native.status, 200, JSON.stringify(native.body));
    assert.equal(native.body.lines[0].rebatePricingMode, undefined);
    sourceCollisionFixture = true;
    const collided = await app.call('GET', '/api/so/502', { user: admin });
    assert.equal(collided.status, 409, JSON.stringify(collided.body));
    assert.equal(collided.body.lines, undefined);
  } finally { rebateModeFixture = false; sourceCollisionFixture = false; }
});

test('native editor refuses changes after a 103 price snapshot exists', async () => {
  rebateModeFixture = true; bookingSnapshotFixture = true;
  try {
    const result = await app.call('PUT', '/api/so/502', { user: admin,
      body: { custId: '12', soPrefix: 'I', lines: [{goodId:12,qtyTon:1,pricePerTon:100}] } });
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.match(result.body.message, /ราคาที่ตรึงแล้ว/);
  } finally { rebateModeFixture = false; bookingSnapshotFixture = false; }
});

test('confirmation replay never returns an older booking or falls through to native mutation', async () => {
  replayRecord = { SOID: '1200', WfRef: 'OLD-BOOKING', SalesUserId: 1, InDataWindow: 0 };
  try {
    const before = db.calls.length;
    const result = await app.call('PATCH', '/api/so/1201/confirm', { user: admin });
    assert.equal(result.status, 404, JSON.stringify(result.body));
    assert.doesNotMatch(JSON.stringify(result.body), /OLD-BOOKING/);
    assert.ok(!db.calls.slice(before).some(c => /\b(?:UPDATE|INSERT|DELETE)\b/i.test(c.text)));
    const replay = db.calls.slice(before).find(c => /WHERE x\.SourceDraftId=@id/.test(c.text));
    assert.match(replay.text, /h\.DocuDate >= @globalStartDate/);
    assert.equal(replay.inputs.globalStartDate, '2026-01-01');
  } finally { replayRecord = null; }
});

test('a current confirmed booking can still be replayed after its draft was removed', async () => {
  replayRecord = { SOID: '1200', WfRef: 'CURRENT-BOOKING', SalesUserId: 1, InDataWindow: 1 };
  try {
    const result = await app.call('PATCH', '/api/so/1201/confirm', { user: admin });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.docuNo, 'CURRENT-BOOKING');
    assert.equal(result.body.replayed, true);
  } finally { replayRecord = null; }
});

test('all-scope user cannot confirm a native order outside the configured window', async () => {
  const before = db.calls.length;
  const result = await app.call('PATCH', '/api/so/1234/confirm', { user: admin });
  assert.equal(result.status, 404, JSON.stringify(result.body));
  assert.ok(!db.calls.slice(before).some(c => /\b(?:UPDATE|INSERT|DELETE)\b/i.test(c.text)));
});

test('older linked quotation is redacted while still blocking confirmation', async () => {
  quoteRecord = { Id: 77, QuoteNo: 'OLD-QUOTE', Status: 'DRAFT', Remark: 'old', ValidUntil: '2025-01-01', InDataWindow: 0 };
  try {
    let result = await app.call('GET', '/api/so/501', { user: admin });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.linkedQuoteId, null);
    assert.equal(result.body.linkedQuoteNo, null);
    assert.match(result.body.quotationLockReason, /ก่อนวันเริ่มข้อมูล/);
    result = await app.call('PATCH', '/api/so/501/confirm', { user: admin });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(result.body.requiresQuotationAccepted, true);
    assert.equal(result.body.quoteId, null);
    assert.equal(result.body.quoteNo, null);
    assert.doesNotMatch(JSON.stringify(result.body), /OLD-QUOTE/);
    const lookup = db.calls.find(c => /CASE WHEN q.CreatedAt >= @globalStartUtc/.test(c.text));
    assert.equal(lookup.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
  } finally { quoteRecord = null; }
});

test('current linked quotation retains its actionable details and still blocks confirmation', async () => {
  quoteRecord = { Id: 78, QuoteNo: 'NEW-QUOTE', Status: 'SENT', Remark: 'current', InDataWindow: 1 };
  try {
    let result = await app.call('GET', '/api/so/501', { user: admin });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.linkedQuoteId, 78);
    assert.equal(result.body.linkedQuoteNo, 'NEW-QUOTE');
    result = await app.call('PATCH', '/api/so/501/confirm', { user: admin });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(result.body.quoteId, 78);
    assert.equal(result.body.quoteNo, 'NEW-QUOTE');
  } finally { quoteRecord = null; }
});

test('customer rebate balance uses the claim source, includes opening lots and applies scope', async () => {
  const before = db.calls.length;
  const result = await app.call('GET', '/api/so/rebate-balance/123', { user: admin });
  assert.equal(result.status, 200);
  const query = db.calls.slice(before).find(c => /FROM wf\.v_RebateAccrualRemaining/.test(c.text));
  assert.ok(query);
  assert.match(query.text, /RemainingTonRebate \* RebatePerTon/);
  assert.match(query.text, /SourceDocuDate <= @today/);
  assert.doesNotMatch(query.text, /globalStart|RebateLedger/);
  assert.equal(query.inputs.custId, 123);
  assert.equal((await app.call('GET', '/api/so/rebate-balance/not-an-id', { user: admin })).status, 400);
});

test('direct weighing reads reject old orders and apply UTC cutoff to ticket and item history', async () => {
  date = '2026-01-01';
  const before = db.calls.length;
  const missing = await app.call('GET', '/api/so/1234/weigh', { user: admin });
  assert.equal(missing.status, 404);
  assert.ok(!db.calls.slice(before).some(c => /FROM wf\.WeighTicket WHERE/.test(c.text)));
  const start = db.calls.length;
  assert.equal((await app.call('GET', '/api/so/501', { user: admin })).status, 200);
  assert.equal((await app.call('GET', '/api/so/501/weigh', { user: admin })).status, 200);
  assert.equal((await app.call('GET', '/api/so/501/weigh-history', { user: admin })).status, 200);
  const calls = db.calls.slice(start);
  const tickets = calls.filter(c => /FROM wf\.WeighTicket WHERE/.test(c.text));
  assert.equal(tickets.length, 3);
  for (const q of tickets) {
    assert.match(q.text, /CreatedAt >= @globalStartUtc/);
    assert.equal(q.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
  }
  const logs = calls.find(c => /FROM wf\.WeighTicketItemLog l/.test(c.text));
  assert.match(logs.text, /l\.WeighedAt >= @globalStartUtc/);
  const audit = calls.find(c => /FROM wf\.SalesOrderAudit a/.test(c.text));
  assert.match(audit.text, /a\.CreatedAt >= @globalStartUtc/);
});

test('item weighing rejects an order outside the window before writing', async () => {
  const before = db.calls.length;
  const result = await app.call('POST', '/api/so/1234/weigh-item', {
    user: admin, body: { grossScaleKg: 1200, lineNum: 1, goodCode: 'TEST' },
  });
  assert.equal(result.status, 404);
  assert.ok(!db.calls.slice(before).some(c => /INSERT INTO wf\.WeighTicketItemLog/.test(c.text)));
});

test('item weighing retains earlier pass for incremental weight calculation', async () => {
  const before = db.calls.length;
  const result = await app.call('POST', '/api/so/501/weigh-item', {
    user: admin, body: { grossScaleKg: 1200, lineNum: 1, goodCode: 'TEST' },
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.incrementalNetKg, 200);
  const calls = db.calls.slice(before);
  assert.doesNotMatch(calls.find(c => /SELECT TOP 1 GrossScaleKg/.test(c.text)).text, /globalStart/);
  assert.equal(calls.find(c => /INSERT INTO wf\.WeighTicketItemLog/.test(c.text)).inputs.uid, 1);
});

test('invalid scale weight cannot be written to SQL', async () => {
  for (const grossScaleKg of ['Infinity', 100000000, 0]) {
    const before = db.calls.length;
    const result = await app.call('POST', '/api/so/501/weigh-item', {
      user: admin, body: { grossScaleKg, lineNum: 1, goodCode: 'TEST' },
    });
    assert.equal(result.status, 400);
    assert.ok(!db.calls.slice(before).some(c => /INSERT INTO wf\.WeighTicketItemLog/.test(c.text)));
  }
});

test('sales list and empty-page count share both date boundaries', async () => {
  const before = db.calls.length;
  const result = await app.call('GET', '/api/so?page=2&limit=10', { user: admin });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const queries = db.calls.slice(before).filter(c => /WITH Orders AS/.test(c.text));
  assert.equal(queries.length, 2);
  for (const q of queries) {
    assert.match(q.text, /so\.CreatedAt >= @globalStartUtc/);
    assert.match(q.text, /hd\.DocuDate >= @globalStartDate/);
    assert.equal(q.inputs.globalStartDate, '2026-01-01');
    assert.equal(q.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
  }
  const listing = queries.find(q => /AS LinkedQuoteId/.test(q.text));
  assert.ok(listing);
  assert.equal((listing.text.match(/CASE WHEN pq\.CreatedAt >= @globalStartUtc THEN pq\.Id END AS LinkedQuoteId/g) || []).length, 2);
  assert.equal((listing.text.match(/pq\.Id IS NULL THEN NULL WHEN pq\.CreatedAt >= @globalStartUtc/g) || []).length, 2);
});

test('dashboard cache changes immediately with the global date and fails closed on missing policy', async () => {
  const before = db.calls.length;
  let result = await app.call('GET', '/api/so/stats', { user: admin });
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 2);
  result = await app.call('GET', '/api/so/stats', { user: admin });
  assert.equal(result.body.total, 2);
  assert.equal(db.calls.slice(before).filter(c => /SELECT Status, COUNT\(\*\) AS Cnt/.test(c.text)).length, 1);
  date = '2026-02-01';
  result = await app.call('GET', '/api/so/stats', { user: admin });
  assert.equal(result.body.total, 1);
  assert.equal(db.calls.slice(before).filter(c => /SELECT Status, COUNT\(\*\) AS Cnt/.test(c.text)).length, 2);
  unavailable = true;
  result = await app.call('GET', '/api/so/stats', { user: admin });
  assert.equal(result.status, 500);
  unavailable = false;
});

test('shipment history enforces the system boundary and rejects invalid dates', async () => {
  date = '2026-01-01';
  const before = db.calls.length;
  const result = await app.call('GET', '/api/so/shipped-today?date=2025-12-31', { user: admin });
  assert.equal(result.status, 200);
  const query = db.calls.slice(before).find(c => /CAST\(hd\.DocuDate AS DATE\) = @d/.test(c.text));
  assert.match(query.text, /hd\.DocuDate >= @globalStartDate/);
  assert.equal(query.inputs.globalStartDate, '2026-01-01');
  const invalid = await app.call('GET', '/api/so/shipped-today?date=2026-02-31', { user: admin });
  assert.equal(invalid.status, 400);
});

test('unlock request list and resolve apply the UTC boundary before any mutation', async () => {
  date = '2026-01-01';
  const before = db.calls.length;
  const list = await app.call('GET', '/api/so/unlock-requests', { user: admin });
  assert.equal(list.status, 200);
  const listing = db.calls.slice(before).find(c => /FROM wf\.UnlockRequest r/.test(c.text));
  assert.match(listing.text, /r\.RequestedAt >= @globalStartUtc/);
  assert.equal(listing.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
  const beforeResolve = db.calls.length;
  const result = await app.call('PATCH', '/api/so/unlock-requests/42/resolve', { user: admin, body: { approve: true } });
  assert.equal(result.status, 404);
  const calls = db.calls.slice(beforeResolve);
  const lookup = calls.find(c => /FROM wf\.UnlockRequest WHERE Id=@id/.test(c.text));
  assert.match(lookup.text, /RequestedAt >= @globalStartUtc/);
  assert.equal(lookup.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
  assert.equal(calls.some(c => /\bUPDATE\b/.test(c.text)), false);
});

test('pending giveaway approvals hide drafts before the UTC cutoff', async () => {
  date = '2026-01-01';
  const before = db.calls.length;
  const result = await app.call('GET', '/api/so/giveaways/pending', { user: admin });
  assert.equal(result.status, 200);
  const query = db.calls.slice(before).find(c => /FROM wf\.SalesOrderLine l/.test(c.text));
  assert.ok(query); assert.match(query.text, /s\.CreatedAt >= @globalStartUtc/);
  assert.equal(query.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
});

test('direct SO lookup and dedup fallback constrain both native and draft dates', async () => {
  date = '2026-01-01';
  const before = db.calls.length;
  const result = await app.call('GET', '/api/so/1234', { user: admin });
  assert.equal(result.status, 404);
  const calls = db.calls.slice(before);
  const direct = calls.find(c => /SELECT \* FROM wf\.v_AllSalesOrders WHERE/.test(c.text));
  const fallback = calls.find(c => /SELECT DocuNo FROM dbo\.SOHD/.test(c.text));
  assert.match(direct.text, /h\.DocuDate >= @globalStartDate/);
  assert.match(direct.text, /w\.CreatedAt >= @globalStartUtc/);
  assert.match(direct.text, /h\.DocuNo=\[wf\]\.\[v_AllSalesOrders\]\.\[ImportedDocuNo\]/);
  assert.match(fallback.text, /DocuDate >= @globalStartDate/);
  assert.match(fallback.text, /CreatedAt >= @globalStartUtc/);
  assert.equal(direct.inputs.globalStartDate, '2026-01-01');
  assert.equal(direct.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
  const fallbackBefore = db.calls.length;
  const dedupResult = await app.call('GET', '/api/so/9999', { user: admin });
  assert.equal(dedupResult.status, 404);
  const dedup = db.calls.slice(fallbackBefore).find(c => /\(WfRef = @docuNo OR ImportedDocuNo = @docuNo\)/.test(c.text));
  assert.ok(dedup);
  assert.match(dedup.text, /h\.DocuDate >= @globalStartDate/);
  assert.match(dedup.text, /w\.CreatedAt >= @globalStartUtc/);
});
