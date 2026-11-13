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
