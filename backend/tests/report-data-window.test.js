'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let cutoff = '2026-01-01';
let failPrimary = false;
const storePath = require.resolve('../services/global-data-window-store');
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: {
  readGlobalDataWindow: async () => {
    if (failPrimary) throw new Error('PRIMARY_UNAVAILABLE');
    return require('../services/data-window').boundaries(cutoff);
  },
} };
const db = h.installDbStub(({ text, inputs }) => {
  if (/dt\.RemaQty > 0/.test(text)) {
    const rows = [
      { DocuDate: '2025-12-31', TransRegistration: 'ตั๋วคุม', BacklogTon: 1 },
      { DocuDate: '2025-12-31', TransRegistration: 'รถทั่วไป', BacklogTon: 2 },
      { DocuDate: '2026-01-01', TransRegistration: 'ตั๋วคุม', BacklogTon: 3 },
      { DocuDate: '2026-01-02', TransRegistration: 'รถทั่วไป', BacklogTon: 4 },
      { DocuDate: null, TransRegistration: 'รถทั่วไป', BacklogTon: 5 },
    ];
    const current = rows.filter(row => row.DocuDate >= inputs.globalStartDate &&
      (row.DocuDate >= inputs.legacyCut || row.TransRegistration === 'ตั๋วคุม'));
    const old = rows.filter(row => row.DocuDate < inputs.globalStartDate);
    const undated = rows.filter(row => row.DocuDate == null);
    return [...current, ...(old.length ? [{ DocuNo: 'ยอดค้างส่งยกมา', DocuDate: null,
      BacklogTon: old.reduce((sum, row) => sum + row.BacklogTon, 0) }] : []),
      ...(undated.length ? [{ DocuNo: 'ยอดค้างส่งไม่ทราบวันที่', DocuDate: null,
        BacklogTon: undated.reduce((sum, row) => sum + row.BacklogTon, 0) }] : [])];
  }
  if (/FROM wf\.RebateClaim c WITH/.test(text)) {
    const rows = [{ CreatedAt: '2025-12-31T16:59:59.000Z' }, { CreatedAt: '2025-12-31T17:00:00.000Z' },
      { CreatedAt: '2026-01-01T03:00:00.000Z' }];
    return rows.filter(row => new Date(row.CreatedAt) >= inputs.globalStartUtc);
  }
  if (/FROM dbo\.SOHD hd/.test(text)) {
    const rows = [{ DocuDate: '2025-12-31' }, { DocuDate: '2026-01-01' }, { DocuDate: '2026-02-01' }];
    return rows.filter(row => row.DocuDate >= inputs.globalStartDate);
  }
  return [];
});
const { REPORTS, runReport } = require('../routes/reports').__testing;

test('transaction detail reports use the primary cutoff and include the boundary date', async () => {
  for (const report of ['sales-order-detail', 'wh-dispatch-daily']) {
    const result = await runReport(report);
    assert.deepEqual(result.rows.map(x => x.DocuDate), ['2026-01-01', '2026-02-01']);
    const call = db.calls.at(-1);
    assert.match(call.text, /hd\.DocuDate >= @globalStartDate/);
    assert.equal(call.inputs.globalStartDate, '2026-01-01');
  }
  cutoff = '2026-02-01';
  assert.deepEqual((await runReport('sales-order-detail')).rows.map(x => x.DocuDate), ['2026-02-01']);
});

test('backlog applies the global boundary even to old control tickets', async () => {
  cutoff = '2026-01-01';
  const result = await runReport('so-backlog');
  const call = db.calls.at(-1);
  assert.match(call.text, /AND hd\.DocuDate >= @globalStartDate\s+AND \(hd\.DocuDate >= @legacyCut/);
  assert.equal(call.inputs.globalStartDate, '2026-01-01');
  assert.deepEqual(result.rows.map(row => row.DocuDate), ['2026-01-01', '2026-01-02', null, null]);
  assert.equal(result.rows[2].BacklogTon, 3);
  assert.equal(result.rows[3].BacklogTon, 5);
  assert.equal(result.rows.reduce((sum, row) => sum + row.BacklogTon, 0), 15);
  assert.match(call.text, /GROUP BY hd\.CustID, hd\.CustName, dt\.GoodID, dt\.GoodName/);
  assert.match(call.text, /hd\.DocuDate IS NULL OR hd\.DocuDate < @globalStartDate/);
  assert.match(call.text, /hd\.DocuDate < @legacyCut/);
  failPrimary = true;
  await assert.rejects(runReport('so-backlog'), /PRIMARY_UNAVAILABLE/);
  failPrimary = false;
});

test('unavailable primary fails closed and receivable balances have no cutoff', async () => {
  failPrimary = true;
  await assert.rejects(runReport('sales-order-detail'), /PRIMARY_UNAVAILABLE/);
  assert.doesNotMatch(REPORTS['ar-aging-summary'].sql, /@globalStartDate|DocuDate\s*>=/i);
  failPrimary = false;
});

test('status counts and incidents use Bangkok midnight for UTC timestamps', async () => {
  cutoff = '2026-01-01';
  await runReport('so-status');
  let call = db.calls.at(-1);
  assert.match(call.text, /CreatedAt >= @globalStartUtc/);
  assert.match(call.text, /hd\.DocuDate >= @globalStartDate/);
  assert.equal(call.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
  assert.equal(call.inputs.globalStartDate, '2026-01-01');
  await runReport('rule-incidents');
  call = db.calls.at(-1);
  assert.match(call.text, /i\.OccurredAt >= @globalStartUtc/);
  assert.equal(call.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
});

test('weighing and current sales report use the business-date boundary', async () => {
  cutoff = '2026-01-01';
  await runReport('weighbridge-log');
  let call = db.calls.at(-1);
  assert.match(call.text, /COALESCE\(w\.DateOut, w\.DateIn, w\.DateReg\) >= @globalStartDate/);
  assert.equal(call.inputs.globalStartDate, cutoff);
  await runReport('sales-performance');
  call = db.calls.at(-1);
  assert.match(call.text, /hd\.DocuDate >= @globalStartDate/);
  assert.equal(call.inputs.globalStartDate, cutoff);
});

test('rebate claim detail hides pre-cutoff claims without removing opening balances', async () => {
  cutoff = '2026-01-01';
  const result = await runReport('rebate-claim-detail');
  assert.deepEqual(result.rows.map(x=>x.CreatedAt),['2025-12-31T17:00:00.000Z','2026-01-01T03:00:00.000Z']);
  const call=db.calls.at(-1);
  assert.match(call.text,/WHERE c\.CreatedAt >= @globalStartUtc/);
  assert.equal(call.inputs.globalStartUtc.toISOString(),'2025-12-31T17:00:00.000Z');
  assert.doesNotMatch(REPORTS['ar-aging-summary'].sql,/@globalStartDate|@globalStartUtc/);
  failPrimary=true;
  await assert.rejects(runReport('rebate-claim-detail'),/PRIMARY_UNAVAILABLE/);
  failPrimary=false;
});

test('paper, special price and weigh-ticket reports apply the UTC cutoff and fail closed', async () => {
  cutoff = '2026-01-01';
  const reports = [
    ['paper-status', /PrintedAt >= @globalStartUtc/],
    ['special-price-detail', /sp\.CreatedAt >= @globalStartUtc/],
    ['weighbridge-detail', /COALESCE\(wt\.WeighOutAt, wt\.WeighInAt, wt\.CreatedAt\) >= @globalStartUtc/],
    ['weighbridge-variance', /COALESCE\(t\.WeighOutAt, t\.WeighInAt, t\.CreatedAt\) >= @globalStartUtc/],
  ];
  for (const [name, predicate] of reports) {
    await runReport(name);
    const call = db.calls.at(-1);
    assert.match(call.text, predicate);
    assert.equal(call.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
    failPrimary = true;
    await assert.rejects(runReport(name), /PRIMARY_UNAVAILABLE/);
    failPrimary = false;
  }
});

test('history, native documents, dispatch and GL enforce the configured boundary even for older requested ranges', async () => {
  cutoff = '2026-01-01';
  const cases = [
    ['policy-history', /pv\.CreatedAt >= @globalStartUtc/, 'globalStartUtc'],
    ['truck-hold-log', /l\.ActedAt >= @globalStartUtc/, 'globalStartUtc'],
    ['control-ticket-alert-history', /COALESCE\(a\.AlertDate, CAST\(DATEADD\(hour,7,a\.CreatedAt\) AS date\)\) >= @globalStartDate/, 'globalStartDate'],
    ['native-print-log', /n\.PrintedAt >= @globalStartUtc/, 'globalStartUtc'],
    ['native-documents', /o\.CreatedAt >= @globalStartUtc/, 'globalStartUtc'],
    ['gl-sales-journal', /gl\.DocuDate >= @globalStartDate/, 'globalStartDate'],
    ['customer-dispatch', /h\.DocuDate >= @globalStartDate/, 'globalStartDate'],
  ];
  for (const [name, predicate, field] of cases) {
    const before = db.calls.length;
    await runReport(name, { from: '2020-01-01', to: '2026-12-31' });
    const call = db.calls.slice(before).find(c => predicate.test(c.text));
    assert.ok(call, `${name} must constrain its own query`);
    assert.equal(field === 'globalStartUtc' ? call.inputs[field].toISOString() : call.inputs[field],
      field === 'globalStartUtc' ? '2025-12-31T17:00:00.000Z' : '2026-01-01');
    if (name === 'customer-dispatch') assert.match(call.text, /CASE WHEN bk\.DocuDate >= @globalStartDate THEN bk\.DocuNo ELSE NULL END/);
    failPrimary = true;
    await assert.rejects(runReport(name), /PRIMARY_UNAVAILABLE/);
    failPrimary = false;
  }
});
