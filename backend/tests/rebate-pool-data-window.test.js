'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(({ text }) => {
  if (/SELECT TOP 1 1 AS ok FROM wf\.v_RebateAccrualRemaining/.test(text)) return [{ ok: 1 }];
  if (/AS MaturedBalance/.test(text) && /FROM wf\.v_RebateAccrualRemaining/.test(text)) return [
    { MaturedBalance: 50, UnmaturedBalance: 75, OpeningBalance: 50, OpeningCount: 1, WithoutPlanCount: 0 },
  ];
  if (/SELECT TOP 500 SourceSOID/.test(text)) return [
    { SourceSOID: 2, SourceListNo: 1, SourceDocuNo: 'NEW', SourceDocuDate: '2026-02-01', CycleExpiryDate: '2027-02-01', RemainingAmount: 75 },
  ];
  if (/FROM wf\.FertilizerTicketConversion WITH \(NOLOCK\)/.test(text)) return [
    { Id: 3, CustId: 123, ConvertedAt: '2026-02-01', StandingYear: 2026, GoodId: 2, ConvertedValueBaht: 125 },
  ];
  if (/FROM wf\.FertilizerTicketConversionAllocation a/.test(text)) return [
    { ConversionId: 3, LedgerId: 2, DeductedAmount: 75, RemainingAfter: 0, DocNo: 'NEW', EarnedDate: '2026-02-01' },
  ];
  if (/FROM wf\.RebateConversionSourceAllocation a/.test(text)) return [
    { ConversionId: 3, SourceSOID: 9, SourceListNo: 1, QtyTon: 1, AmountBaht: 50, DocuNo: 'NEW-104', DocuDate: '2026-02-01' },
  ];
  if (/FROM wf\.RebateTransactionLedger WITH \(NOLOCK\)\s+WHERE CustId = @custId/.test(text)) return [
    { Id: 1, LedgerCode: 'OLD', CustId: 123, EarnedDate: '2025-12-01', CycleExpiryDate: '2026-01-01', RemainingAmount: 50, Status: 'ACTIVE', ApprovalStatus: 'APPROVED' },
    { Id: 2, LedgerCode: 'NEW', CustId: 123, EarnedDate: '2026-02-01', CycleExpiryDate: '2027-02-01', RemainingAmount: 75, Status: 'READY_FOR_CONVERSION', ApprovalStatus: 'APPROVED' },
  ];
  return [];
}, { activeUserIds: h.TEST_USERS });
let app;
test.before(async () => { app = await h.startApp([['/api/rebate-pool', '../../routes/rebate-pool']]); });
test.after(async () => app.close());

test('ledger history is bounded by business date with typed filters', async () => {
  const result = await app.call('GET', '/api/rebate-pool/ledger?custId=123&status=ACTIVE&limit=25', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const call = db.calls.find(c => /FROM wf\.RebateTransactionLedger WITH \(NOLOCK\)/.test(c.text));
  assert.match(call.text, /EarnedDate >= @globalStartDate/);
  assert.equal(call.inputs.globalStartDate, '2026-01-01');
  assert.equal(call.inputs.custId, 123);
  assert.equal(call.inputs.limit, 25);
  assert.equal(call.inputs.status, 'ACTIVE');
});

test('queue hides pre-cutoff detail but retains its opening amount in the balance', async () => {
  const result = await app.call('GET', '/api/rebate-pool/queue/123?asOfDate=2026-06-01', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.totalFifoEligibleBalance, 125);
  assert.equal(result.body.openingEligibleBalance, 50);
  assert.equal(result.body.openingEligibleCount, 1);
  assert.equal(result.body.maturedBalance, 50);
  assert.equal(result.body.activeUnmaturedBalance, 75);
  assert.deepEqual(result.body.eligibleLedgers.map(row => row.docNo), ['NEW']);
  const detail = db.calls.find(c => /SELECT TOP 500 SourceSOID/.test(c.text));
  assert.match(detail.text, /SourceDocuDate >= @cutoff/);
  assert.equal(detail.inputs.cutoff, '2026-01-01');
});

test('conversion history applies Bangkok business date without filtering balances', async () => {
  const result = await app.call('GET', '/api/rebate-pool/conversions?custId=123&limit=25', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const call = db.calls.find(c => /FROM wf\.FertilizerTicketConversion WITH \(NOLOCK\)/.test(c.text));
  assert.match(call.text, /ConvertedAt >= @globalStartDate AND CustId = @custId/);
  assert.equal(call.inputs.globalStartDate, '2026-01-01');
  assert.equal(call.inputs.custId, 123);
  const allocations = db.calls.find(c => /FROM wf\.FertilizerTicketConversionAllocation a/.test(c.text));
  assert.match(allocations.text, /l.EarnedDate >= @globalStartDate/);
  assert.equal(allocations.inputs.globalStartDate, '2026-01-01');
  const shared = db.calls.find(c => /FROM wf\.RebateConversionSourceAllocation a/.test(c.text));
  assert.match(shared.text, /h.DocuDate >= @globalStartDate/);
  assert.deepEqual(result.body[0].allocations.map(row => row.docNo), ['NEW', 'NEW-104']);
});

test('annual maturity summary uses the shared WinSpeed-backed balance', async () => {
  const before = db.calls.length;
  const result = await app.call('GET', '/api/rebate-pool/alerts?year=2026', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const call = db.calls.slice(before).find(c => /GROUP BY CustId ORDER BY MaturedBalance/.test(c.text));
  assert.ok(call); assert.match(call.text, /FROM wf\.v_RebateAccrualRemaining/);
  assert.equal(call.inputs.asOf, '2026-11-01');
  assert.ok(!db.calls.slice(before).some(c => /FROM wf\.RebateConversionAlert/.test(c.text)));
});

test('queue rejects malformed as-of dates without querying source lots', async () => {
  const before = db.calls.length;
  const result = await app.call('GET', '/api/rebate-pool/queue/123?asOfDate=2026-02-30', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(result.status, 400);
  assert.ok(!db.calls.slice(before).some(c => /FROM wf\.v_RebateAccrualRemaining/.test(c.text)));
});

test('new shipment workflow never exposes legacy ledger or alerts as current balances',async()=>{
  process.env.REBATE_POOL_103_ENABLED='true';
  try {
    for(const path of ['/ledger','/alerts']) {
      const result=await app.call('GET','/api/rebate-pool'+path,{user:{sub:1,role:'ADMIN'}});
      assert.equal(result.status,503);assert.equal(result.body.code,'REBATE_SHIPMENT_VIEW_UNAVAILABLE');
    }
  } finally {delete process.env.REBATE_POOL_103_ENABLED;}
});
