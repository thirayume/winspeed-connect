'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(({ text, inputs }) => {
  // The truck-plate lookup checks customer visibility before reading history.
  if (/WHERE c\.CustID=@visibilityCustId/.test(text) && inputs.visibilityCustId === 123) return [{ ok: 1 }];
  return [];
}, { activeUserIds: h.TEST_USERS });
let app;
test.before(async () => { app = await h.startApp([['/api/master', '../../routes/master']]); });
test.after(async () => { await app.close(); });

test('truck history and suggestions use both UTC and WinSpeed business-date boundaries', async () => {
  const user = { sub: 12, role: 'ADMIN' };
  for (const [url, pattern] of [
    ['/api/master/truck-plates?custId=123', /SELECT DISTINCT Plate FROM/],
    ['/api/master/trucks-stats', /AS truckPlate/],
    ['/api/master/trucks/ABC-123/history', /AS qtyTon/],
  ]) {
    const before = db.calls.length;
    const response = await app.call('GET', url, { user });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const call = db.calls.slice(before).find(c => pattern.test(c.text));
    assert.ok(call, url);
    assert.match(call.text, /CreatedAt >= @globalStartUtc/);
    assert.match(call.text, /DocuDate >= @globalStartDate/);
    assert.equal(call.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
    assert.equal(call.inputs.globalStartDate, '2026-01-01');
  }
});

test('invoice list cannot bypass the global boundary with an earlier dateFrom', async () => {
  const before = db.calls.length;
  const response = await app.call('GET', '/api/master/invoices?dateFrom=2020-01-01', { user: { sub: 12, role: 'ADMIN' } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const call = db.calls.slice(before).find(c => /FROM dbo\.SOInvHD h/.test(c.text));
  assert.match(call.text, /h\.DocuDate >= @globalStartDate/);
  assert.equal(call.inputs.globalStartDate, '2026-01-01');
  assert.equal(call.inputs.dateFrom, '2020-01-01');
});

test('aging searches and exports apply cutoff even when requesting all dates', async () => {
  const user = { sub: 12, role: 'ADMIN' };
  for (const url of ['/api/master/aging?bust=1', '/api/master/aging/search?all=1&export=1&dateFrom=2000-01-01']) {
    const before = db.calls.length;
    const response = await app.call('GET', url, { user });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const statements = db.calls.slice(before).filter(call => /TicketLeft AS \(/.test(call.text));
    assert.equal(statements.length, url.includes('search') ? 2 : 1);
    for (const call of statements) {
      assert.match(call.text, /hd\.DocuDate >= @globalStartDate/);
      assert.equal(call.inputs.globalStartDate, '2026-01-01');
    }
  }
});

test('aging cache changes key when administrator changes the cutoff', async () => {
  const store = require('../services/global-data-window-store');
  const original = store.readGlobalDataWindow;
  const user = { sub: 12, role: 'ADMIN' };
  try {
    store.readGlobalDataWindow = async () => ({ businessDate: '2026-06-01', utcInstant: new Date('2026-05-31T17:00:00Z') });
    const before = db.calls.length;
    const response = await app.call('GET', '/api/master/aging', { user });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const call = db.calls.slice(before).find(item => /TicketLeft AS \(/.test(item.text));
    assert.ok(call); assert.equal(call.inputs.globalStartDate, '2026-06-01');
  } finally { store.readGlobalDataWindow = original; }
});

test('aging counts a bill only while WinSpeed still has goods to ship (owner, 18 Nov 2026)', async () => {
  const user = { sub: 12, role: 'ADMIN' };
  const before = db.calls.length;
  const response = await app.call('GET', '/api/master/aging/search?all=1&page=3&pageSize=100', { user });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const statements = db.calls.slice(before).filter(call => /TicketLeft AS \(/.test(call.text));
  assert.equal(statements.length, 2);
  for (const { text } of statements) {
    // A booking taken by a sales order, or whose truck the scale weighed out, is no longer waiting.
    assert.match(text, /NOT \(hd\.DocuType = 103 AND RTRIM\(ISNULL\(hd\.DocuStatus, ''\)\) = 'Y'\)/);
    assert.match(text, /FROM dbo\.WGHD wg WITH \(NOLOCK\)\s+WHERE wg\.SPID = hd\.SOID AND wg\.WGType = 'SO' AND RTRIM\(wg\.Status\) = '3'/);
    // A sales order whose tickets are all used (cut, invoiced by 107, or returned) is closed.
    assert.match(text, /\(hd\.DocuType <> 104 OR tb\.DocuID IS NULL OR tb\.RemaQty > 0\.00005\)/);
    assert.match(text, /LEFT HASH JOIN TicketBill tb/);
    // The truck plate plays no part, and the 103/104 counters overlap, so no de-duplication by number.
    assert.doesNotMatch(text, /PARTITION BY hd\.DocuNo/);
    assert.doesNotMatch(text, /TransRegistration\)\), ''\), 'ไม่ระบุรถ'\) <>/);
  }
  // Pages are cut in lines, so the total counts lines from the same set.
  assert.match(statements[0].text, /SELECT COUNT\(\*\) AS Total, COUNT\(DISTINCT SoId\) AS Bills/);
  assert.equal(db.calls.slice(before).find(call => /RowNum > @offset/.test(call.text)).inputs.offset, 200);
});
