'use strict';
// Review of the UAT round of 18 Nov 2026 (accounting page, rebate plan, giveaway alignment, master data writes).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers/route-harness.cjs');

const windowPath = require.resolve('../services/global-data-window-store');
require.cache[windowPath] = { id: windowPath, filename: windowPath, loaded: true,
  exports: { readGlobalDataWindow: async () => ({ businessDate: '2026-01-01', utcInstant: new Date('2025-12-31T17:00:00Z') }) } };
const db = h.installDbStub(() => [], { activeUserIds: h.TEST_USERS });
const bills = require('../services/accounting-bills');
const { redactRebateMoney } = require('../middleware/auth');

let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so'], ['/api/master', '../../routes/master']]); });
test.after(async () => { await app.close(); });

test('accounting list and bill detail are for accounting roles only', async () => {
  for (const url of ['/api/so/shipped-today?date=2026-11-18', '/api/so/123/accounting-detail']) {
    const sales = await app.call('GET', url, { user: { sub: 43, role: 'SALES' } });
    assert.equal(sales.status, 403, `${url} for SALES`);
  }
  const ok = await app.call('GET', '/api/so/shipped-today?startDate=2026-11-01&endDate=2026-11-18', { user: { sub: 12, role: 'ACCOUNTING' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const missing = await app.call('GET', '/api/so/123/accounting-detail', { user: { sub: 12, role: 'ACCOUNTING' } });
  assert.equal(missing.status, 404);
  const bad = await app.call('GET', '/api/so/abc/accounting-detail', { user: { sub: 12, role: 'ACCOUNTING' } });
  assert.equal(bad.status, 400);
});

test('the accounting date range is checked and kept inside the data window', () => {
  assert.deepEqual(bills.readRange({ startDate: '2025-12-20', endDate: '2026-01-05' }, '2026-11-18', '2026-01-01'), { start: '2026-01-01', end: '2026-01-05' });
  assert.deepEqual(bills.readRange({}, '2026-11-18', '2026-01-01'), { start: '2026-11-18', end: '2026-11-18' });
  assert.throws(() => bills.readRange({ startDate: '2026-11-18', endDate: '2026-11-01' }, '2026-11-18', '2026-01-01'), /วันเริ่มต้องไม่หลังวันสิ้นสุด/);
  assert.throws(() => bills.readRange({ startDate: '2026-01-01', endDate: '2026-11-18' }, '2026-11-18', '2026-01-01'), /ไม่เกิน 93 วัน/);
  assert.throws(() => bills.readRange({ date: '18/11/2569' }, '2026-11-18', '2026-01-01'), /วันที่ไม่ถูกต้อง/);
});

test('documents follow WinSpeed links: 104 by the booking reference, 107 by SOInvDT.RefID, 116 through the tickets', async () => {
  const calls = [];
  const fake = async (text, inputs) => {
    calls.push(text);
    if (/FROM dbo\.SOHD b WITH \(NOLOCK\)\s+JOIN dbo\.SOHD d/.test(text)) return { recordset: [{ BookingId: 10, SOID: 20, DocuNo: 'D104', DocuDate: new Date('2026-11-02') }] };
    if (/FROM dbo\.SOInvDT i/.test(text)) return { recordset: [{ RefID: 20, SOInvID: 30, DocuNo: 'J107', DocuDate: new Date('2026-11-04'), PostGL: 'Y', NetAmnt: 100 }] };
    if (/FROM dbo\.WFCoupon c/.test(text)) return { recordset: [{ CouponID: 40, DocuID: 20 }] };
    if (/FROM dbo\.WFRedemtionDT rd/.test(text)) return { recordset: [{ CouponID: 40, RedemtionID: 50, DocuNo: 'C116', DocuDate: new Date('2026-11-03') }] };
    return { recordset: [] };
  };
  const chain = (await bills.loadDocumentChain(fake, require('mssql'), [10])).get(10);
  assert.equal(chain.delivery.no, 'D104');
  assert.equal(chain.cut.no, 'C116');
  assert.equal(chain.invoice.no, 'J107');
  const sqlText = calls.join('\n');
  assert.match(sqlText, /d\.RefNo = COALESCE\(NULLIF\(RTRIM\(b\.AppvDocuNo\), ''\), b\.DocuNo\)/);
  assert.match(sqlText, /i\.RefID IN \(/);
  assert.match(sqlText, /c\.Docutype = 104 AND c\.DocuID IN \(/);
  assert.doesNotMatch(sqlText, /RefSOID|wf\.AuditTrail|ScaleNo/);
});

test('migration 246 never runs again; goods and groups are never written to dbo directly from routes', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'migration-policy.json'), 'utf8'));
  assert.ok(policy.excludedFiles.includes('246_align_giveaway_budget_to_promotion_emgood.sql'));
  const master = fs.readFileSync(path.join(__dirname, '..', 'routes', 'master.js'), 'utf8');
  assert.doesNotMatch(master, /INSERT INTO dbo\.EMGood|INSERT INTO dbo\.EMGoodGroup|DELETE FROM dbo\.EMGoodGroup|DELETE FROM dbo\.EMGood\b/);
});

test('rebate plan budget details are hidden with the other rebate money', () => {
  const out = redactRebateMoney([{ PlanNo: 'RP69-001', AllocatedAmount: 1000, DetailsJson: '{"expenses":[{"amount":500}]}', Objective: 'x' }]);
  assert.deepEqual(out, [{ PlanNo: 'RP69-001', AllocatedAmount: null, DetailsJson: null, Objective: 'x' }]);
});
