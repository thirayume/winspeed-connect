'use strict';

/**
 * UAT batch 6 (APV-04) — filing a rebate claim:
 *  FIFO reached 2019 invoices sold at ฿9,800 against a NET of ฿15,000, the amount went negative and the database
 *  refused the insert (HTTP 500). A lot at or below the NET carries no rebate and is skipped.
 *  A salesperson files against their own pool (the cap was checked only in the browser).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const lots = [
  { SourceSOID: 1, SourceListNo: 1, SourceDocuNo: 'I62-00011', SourceDocuDate: '2019-01-04', GoodCode: '7-16080800BBCAR', GoodName: '16-8-8', ListPricePerTon: 9800, NetPricePerTon: null, PlanId: null, RemainingTonRebate: 30, RemainingTonDiff: 30 },
  { SourceSOID: 2, SourceListNo: 1, SourceDocuNo: 'I69-03663', SourceDocuDate: '2026-09-03', GoodCode: '7-16080800BBCAR', GoodName: '16-8-8', ListPricePerTon: 15600, NetPricePerTon: null, PlanId: null, RemainingTonRebate: 120, RemainingTonDiff: 120 },
];
const db = h.installDbStub(({ text }) => {
  if (/FROM dbo\.EMCust/.test(text)) return [{ CustID: 1078, CustCode: '0330005', CustName: 'ลูกค้า', SaleAreaID: 1 }];
  if (/SaleAreaCode/.test(text)) return [{ SaleAreaCode: '03300101' }];
  if (/FROM wf\.PolicySnapshot/.test(text)) return [{ SnapshotId: 1, RevisionNumber: 1, CustomerRatio: 100, CompanyRatio: 0 }];
  if (/FROM wf\.RebatePool p/.test(text)) return [{ Id: 1, SalesUserId: 43, AccruedAmt: 5000, ClaimedAmt: 0, UsedAmt: 0, LedgerRemainingAmt: 5000 }];
  if (/FROM wf\.v_RebateAccrualRemaining/.test(text)) return lots;
  if (/INSERT INTO wf\.RebateClaim \(/.test(text)) return [{ Id: 77, Status: 'TIER2_PENDING' }];
  return [];
});

let app;
test.before(async () => { app = await h.startApp([['/api/rebate', '../../routes/rebate']]); });
test.after(async () => { await app.close(); });
const sales = { sub: 43, role: 'SALES' };
const claim = (lines, extra = {}) => app.call('POST', '/api/rebate/claims', { body: { poolId: 1, custId: '1078', lines, ...extra }, user: sales });

test('FIFO skips a lot sold at or below the NET and takes the next one', async () => {
  const before = db.calls.length;
  const r = await claim([{ goodCode: '7-16080800BBCAR', qtyTon: 2, netPricePerTon: 15000 }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ins = db.calls.slice(before).find(c => /INSERT INTO wf\.RebateClaim \(/.test(c.text));
  assert.equal(Number(ins.inputs.amt), 1200, '2 t × (15,600 − 15,000) from I69-03663');
});

test('a lot chosen on the form below the NET is refused with a reason, not a database error', async () => {
  const r = await claim([{ goodCode: '7-16080800BBCAR', qtyTon: 2, netPricePerTon: 15000, sourceSOID: 1, sourceListNo: 1 }]);
  assert.equal(r.status, 400);
  assert.match(r.body.message, /ไม่สูงกว่า NET/);
});

test('a salesperson must claim from a pool', async () => {
  const r = await app.call('POST', '/api/rebate/claims', { body: { custId: '1078', lines: [{ goodCode: '7-16080800BBCAR', qtyTon: 2, netPricePerTon: 15000 }] }, user: sales });
  assert.equal(r.status, 400);
});
