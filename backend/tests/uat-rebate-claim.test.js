'use strict';

/**
 * UAT batch 6 (APV-04) — filing a rebate claim:
 *  FIFO reached 2019 invoices sold at ฿9,800 against a NET of ฿15,000, the amount went negative and the database
 *  refused the insert (HTTP 500). A lot at or below the NET carries no rebate and is skipped.
 *  Owner 2026-11-13: claims consume the customer's source lots rather than a monthly sales pool.
 *  Rebate prices come from the approved plan and sale lot, not caller input.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const lots = [
  { SourceSOID: 1, SourceListNo: 1, SourceDocuNo: 'I62-00011', SourceDocuDate: '2019-01-04', GoodCode: '7-16080800BBCAR', GoodName: '16-8-8', ListPricePerTon: 9800, NetPricePerTon: null, PlanId: null, RemainingTonRebate: 30, RemainingTonDiff: 30 },
  { SourceSOID: 2, SourceListNo: 1, SourceDocuNo: 'I69-03663', SourceDocuDate: '2026-09-03', GoodCode: '7-16080800BBCAR', GoodName: '16-8-8', ListPricePerTon: 15600, NetPricePerTon: 15000, RebatePerTon: 600, PlanId: 1, RemainingTonRebate: 120, RemainingTonDiff: 120 },
];
const db = h.installDbStub(({ text }) => {
  if (/FROM dbo\.EMCust/.test(text)) return [{ CustID: 1078, CustCode: '0330005', CustName: 'ลูกค้า', SaleAreaID: 1 }];
  if (/SaleAreaCode/.test(text)) return [{ SaleAreaCode: '03300101' }];
  if (/FROM wf\.PolicySnapshot/.test(text)) return [{ SnapshotId: 1, RevisionNumber: 1, CustomerRatio: 100, CompanyRatio: 0 }];
  if (/SELECT Id, EmpId, PositionCode FROM wf\.AppUser/.test(text)) return [{ Id: 43, EmpId: 43, PositionCode: null }];
  if (/FROM wf\.RebatePool p/.test(text)) return [{ Id: 1, SalesUserId: 43, AccruedAmt: 5000, ClaimedAmt: 0, UsedAmt: 0, LedgerRemainingAmt: 5000 }];
  if (/FROM wf\.v_RebateAccrualRemaining/.test(text)) return /AND 1=0/.test(text) ? [] : lots;
  if (/INSERT INTO wf\.RebateClaim \(/.test(text)) return [{ Id: 77, Status: 'TIER2_PENDING' }];
  return [];
}, { activeUserIds: h.TEST_USERS });

let app;
test.before(async () => { app = await h.startApp([['/api/rebate', '../../routes/rebate']]); });
test.after(async () => { await app.close(); });
const sales = { sub: 43, role: 'SALES' };
const accounting = { sub: 12, role: 'ACCOUNTING' };
const claim = (lines, extra = {}) => app.call('POST', '/api/rebate/claims', { body: { poolId: 1, custId: '1078', lines, ...extra }, user: accounting });

test('FIFO skips a lot sold at or below the NET and takes the next one', async () => {
  const before = db.calls.length;
  const r = await claim([{ goodCode: '7-16080800BBCAR', qtyTon: 2, netPricePerTon: 15000 }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ins = db.calls.slice(before).find(c => /INSERT INTO wf\.RebateClaim \(/.test(c.text));
  assert.equal(Number(ins.inputs.amt), 1200, '2 t × (15,600 − 15,000) from I69-03663');
});

test('a lot without an approved plan is refused, not priced from caller input', async () => {
  const r = await claim([{ goodCode: '7-16080800BBCAR', qtyTon: 2, netPricePerTon: 15000, sourceSOID: 1, sourceListNo: 1 }]);
  assert.equal(r.status, 400);
  assert.match(r.body.message, /ไม่ตรงกับยอดขนจริง/);
});

test('a salesperson cannot price a lot without an approved plan by typing one', async () => {
  const r = await app.call('POST', '/api/rebate/claims', { body: { poolId: 1, custId: '1078', lines: [{ goodCode: '7-16080800BBCAR', qtyTon: 2, netPricePerTon: 15000, sourceSOID: 1, sourceListNo: 1 }] }, user: sales });
  assert.equal(r.status, 400);
});

test('customer lots can be claimed without a monthly pool or changes to its ledger', async () => {
  const before = db.calls.length;
  const r = await app.call('POST', '/api/rebate/claims', { body: { custId: '1078', lines: [{ goodCode: '7-16080800BBCAR', qtyTon: 2 }] }, user: sales });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const calls = db.calls.slice(before);
  const insert = calls.find(c => /INSERT INTO wf\.RebateClaim \(/.test(c.text));
  assert.equal(insert.inputs.pid, null);
  assert.equal(Number(insert.inputs.amt), 1200);
  assert.ok(!calls.some(c => /UPDATE wf\.(RebatePool|RebateLedger)/.test(c.text)));
  const lotQuery = calls.find(c => /FROM wf\.v_RebateAccrualRemaining/.test(c.text));
  assert.match(lotQuery.text, /SourceDocuDate <= @today/);
  assert.match(lotQuery.text, /CAST\(SalesEmpId AS VARCHAR\(20\)\) IN/);
});

test('client price cannot inflate even an accounting rebate claim', async () => {
  const before = db.calls.length;
  const r = await claim([{ goodCode: '7-16080800BBCAR', qtyTon: 2, sourceSOID: 2, sourceListNo: 1,
    pricePerTon: 200000, netPricePerTon: 1 }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(Number(db.calls.slice(before).find(c => /INSERT INTO wf\.RebateClaim \(/.test(c.text)).inputs.amt), 1200);
});

test('historical document cannot be selected directly when it is outside the data window', async () => {
  const r = await claim([{ goodCode: '7-16080800BBCAR', qtyTon: 1, sourceSOID: 1, sourceListNo: 1 }]);
  assert.equal(r.status, 400);
  assert.doesNotMatch(JSON.stringify(r.body), /I62-00011/);
});

test('a shortage of one thousandth of a ton is not silently ignored', async () => {
  const r = await claim([{ goodCode: '7-16080800BBCAR', qtyTon: 120.001, sourceSOID: 2, sourceListNo: 1 }]);
  assert.equal(r.status, 400);
});

test('invalid or over-precise tonnage cannot round into a financial claim', async () => {
  for (const qtyTon of [0, -1, 'not-a-number', 1.0004]) {
    const r = await claim([{ goodCode: '7-16080800BBCAR', qtyTon, sourceSOID: 2, sourceListNo: 1 }]);
    assert.equal(r.status, 400, String(qtyTon));
  }
});

test('amount-only claims cannot bypass the customer lot balance', async () => {
  const r = await app.call('POST', '/api/rebate/claims', { body: { custId: '1078', claimAmt: 100, note: 'adjustment' }, user: accounting });
  assert.equal(r.status, 400);
});

test('opening balance claim uses historical FIFO source pricing, not client-supplied prices', async () => {
  const old = { ...lots[0] };
  try {
    Object.assign(lots[0], { NetPricePerTon: 9000, RebatePerTon: 800, PlanId: 1 });
    const before = db.calls.length;
    const result = await claim([{ goodCode: '7-16080800BBCAR', qtyTon: 2, openingBalance: true,
      pricePerTon: 100000, netPricePerTon: 1 }]);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const insert = db.calls.slice(before).find(c => /INSERT INTO wf\.RebateClaim \(/.test(c.text));
    assert.equal(Number(insert.inputs.amt), 1600);
    const line = db.calls.slice(before).find(c => /INSERT INTO wf\.RebateClaimLine/.test(c.text));
    assert.equal(Number(line.inputs.price), 9800);
    assert.equal(Number(line.inputs.netPrice), 9000);
    assert.equal(Number(line.inputs.sSoid), 1);
  } finally { Object.assign(lots[0], old); }
});

test('opening balance cannot bypass an unapproved plan or reveal an old document in errors', async () => {
  const result = await claim([{ goodCode: '7-16080800BBCAR', qtyTon: 2, openingBalance: true,
    pricePerTon: 100000, netPricePerTon: 1 }]);
  assert.equal(result.status, 400);
  assert.doesNotMatch(JSON.stringify(result.body), /I62-00011/);
  assert.match(JSON.stringify(result.body), /ยอดยกมา/);
});

test('opening balance is part of the idempotency fingerprint', () => {
  const router = require('../routes/rebate');
  const line = { goodCode: 'A', qtyTon: 1 };
  assert.notEqual(router.buildCanonicalPayloadHash({ lines: [line] }),
    router.buildCanonicalPayloadHash({ lines: [{ ...line, openingBalance: true }] }));
});
