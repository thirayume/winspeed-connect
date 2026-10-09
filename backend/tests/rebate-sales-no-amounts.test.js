'use strict';

/**
 * Owner 2026-10-09: a salesperson sees no rebate amount on the rebate page either (D1 already hid it on bills).
 * SALES keeps their pools, claims and delivery lots with every baht figure removed, and files a claim by tons:
 * the price and the NET come from the delivery lot, never from the form.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const lots = [
  { SourceSOID: 2, SourceListNo: 1, SourceDocuNo: 'I69-03663', SourceDocuDate: '2026-09-03', GoodCode: '7-16080800BBCAR', GoodName: '16-8-8',
    ListPricePerTon: 15600, NetPricePerTon: 15000, RebatePerTon: 600, PlanId: 7, RemainingTonRebate: 120, RemainingTonDiff: 120, RemainingTon: 120, RemainingAmt: 72000 },
];
let poolAccrued = 5000;
const db = h.installDbStub(({ text }) => {
  if (/FROM dbo\.EMCust/.test(text)) return [{ CustID: 1078, CustCode: '0330005', CustName: 'ลูกค้า', SaleAreaID: 1 }];
  if (/SaleAreaCode/.test(text)) return [{ SaleAreaCode: '03300101' }];
  if (/FROM wf\.PolicySnapshot/.test(text)) return [{ SnapshotId: 1, RevisionNumber: 1, CustomerRatio: 100, CompanyRatio: 0 }];
  if (/FROM wf\.RebatePool p/.test(text)) return [{ Id: 1, SalesUserId: 43, PeriodYear: 2026, PeriodMonth: 10, AccruedAmt: poolAccrued, ClaimedAmt: 0, UsedAmt: 0, LedgerRemainingAmt: poolAccrued, AvailableAmt: poolAccrued, SalesName: 'พนักงานทดสอบ' }];
  if (/FROM wf\.v_RebateAccrualRemaining/.test(text)) return lots;
  if (/INSERT INTO wf\.RebateClaim \(/.test(text)) return [{ Id: 77, Status: 'TIER2_PENDING', ClaimAmt: 1200, CustomerAmount: 1200 }];
  if (/FROM wf\.RebateClaim c\s/.test(text) && /WHERE c\.Id = @id/.test(text)) {
    return [{ Id: 5, SalesUserId: 43, CustId: '1078', ClaimAmt: 1200, CustomerAmount: 1200, RetainedAmount: 0, Status: 'TIER2_PENDING', CnDocuNo: 'RBT69-054' }];
  }
  if (/FROM wf\.RebateClaimLine l/.test(text)) return [{ LineId: 1, ClaimId: 5, GoodCode: '16-8-8', QtyTon: 2, PricePerTon: 15600, NetPricePerTon: 15000, RebatePerTon: 600, LineAmount: 1200 }];
  if (/FROM wf\.v_RebateClaimTotals/.test(text)) return [{ ClaimId: 5, ClaimAmt: 1200, RebateAmt: 1200, DiffAmt: 0, RebateTon: 2, DiffTon: 0, LineCount: 1 }];
  return [];
});
const { redactRebateMoney } = require('../middleware/auth');

let app;
test.before(async () => { app = await h.startApp([['/api/rebate', '../../routes/rebate'], ['/api/so', '../../routes/so']]); });
test.after(async () => { await app.close(); });
const sales = { sub: 43, role: 'SALES' };
const manager = { sub: 25, role: 'MANAGER' };

test('money fields go, tons, ids, dates and ratios stay', () => {
  const d = new Date('2026-10-09T00:00:00Z');
  const out = redactRebateMoney({ claim: { Id: 5, ClaimAmt: 1, CustomerAmount: 2, CustomerRatio: 100, CreatedAt: d },
    lines: [{ QtyTon: 2, PricePerTon: 3, NetPricePerTon: 4, RebatePerTon: 5, LineAmount: 6, GoodPrice: 7, NetPrice: 8 }] });
  assert.deepEqual(out.lines[0], { QtyTon: 2, PricePerTon: null, NetPricePerTon: null, RebatePerTon: null, LineAmount: null, GoodPrice: null, NetPrice: null });
  assert.equal(out.claim.Id, 5); assert.equal(out.claim.CustomerRatio, 100); assert.equal(out.claim.CreatedAt, d);
  assert.equal(out.claim.ClaimAmt, null); assert.equal(out.claim.CustomerAmount, null);
});

test('a salesperson opens their pools without amounts', async () => {
  const r = await app.call('GET', '/api/rebate/pools', { user: sales });
  assert.equal(r.status, 200);
  assert.equal(r.body[0].PeriodMonth, 10);
  for (const k of ['AccruedAmt', 'ClaimedAmt', 'UsedAmt', 'LedgerRemainingAmt', 'AvailableAmt']) assert.equal(r.body[0][k], null, k);
});

test('a manager still sees the amounts', async () => {
  const r = await app.call('GET', '/api/rebate/pools', { user: manager });
  assert.equal(r.status, 200);
  assert.equal(r.body[0].AvailableAmt, 5000);
});

test('a claim opened by its salesperson shows tons and status, no baht', async () => {
  const r = await app.call('GET', '/api/rebate/claims/5', { user: sales });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.claim.Status, 'TIER2_PENDING');
  assert.equal(r.body.claim.ClaimAmt, null);
  assert.equal(r.body.lines[0].QtyTon, 2);
  assert.equal(r.body.lines[0].LineAmount, null);
  assert.equal(r.body.totals.RebateTon, 2);
  assert.equal(r.body.totals.RebateAmt, null);
});

test('delivery lots show tons to a salesperson, not prices', async () => {
  const r = await app.call('GET', '/api/rebate/accrual/1078', { user: sales });
  assert.equal(r.status, 200);
  assert.equal(r.body[0].RemainingTon, 120);
  for (const k of ['ListPricePerTon', 'NetPricePerTon', 'RebatePerTon', 'RemainingAmt']) assert.equal(r.body[0][k], null, k);
});

test('a salesperson files by tons; a NET typed on the form is ignored and the lot prices the claim', async () => {
  const before = db.calls.length;
  const r = await app.call('POST', '/api/rebate/claims', { body: { poolId: 1, custId: '1078',
    lines: [{ goodCode: '7-16080800BBCAR', qtyTon: 2, pricePerTon: 99999, netPricePerTon: 1, sourceSOID: 2, sourceListNo: 1 }] }, user: sales });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ins = db.calls.slice(before).find(c => /INSERT INTO wf\.RebateClaim \(/.test(c.text));
  assert.equal(Number(ins.inputs.amt), 1200, '2 t × (15,600 − 15,000) from the lot');
  assert.equal(r.body.ClaimAmt, null, 'the answer carries no amount');
});

test('the price-difference table is left to accounting', async () => {
  const r = await app.call('POST', '/api/rebate/claims', { body: { poolId: 1, custId: '1078',
    lines: [{ lineType: 'DIFF', goodCode: '7-16080800BBCAR', qtyTon: 1 }] }, user: sales });
  assert.equal(r.status, 403);
});

test('over the pool, the salesperson is told without figures', async () => {
  poolAccrued = 100;
  try {
    const r = await app.call('POST', '/api/rebate/claims', { body: { poolId: 1, custId: '1078',
      lines: [{ goodCode: '7-16080800BBCAR', qtyTon: 2, sourceSOID: 2, sourceListNo: 1 }] }, user: sales });
    assert.equal(r.status, 400);
    assert.doesNotMatch(r.body.message, /฿|\d{3}/);
  } finally { poolAccrued = 5000; }
});

test('the bill editor rebate balance is closed to a salesperson', async () => {
  const r = await app.call('GET', '/api/so/rebate-balance/1078', { user: sales });
  assert.equal(r.status, 403);
});
