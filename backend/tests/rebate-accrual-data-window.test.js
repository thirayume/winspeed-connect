'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM dbo\.EMCust/.test(text)) return [{ CustID: 123, CustCode: 'TEST', CustName: 'test', SaleAreaID: 1 }];
  if (/FROM wf\.RebateClaim c/.test(text) && /c.CreatedAt >= @globalStartUtc/.test(text)) {
    const newer = { Id: 2, CustId: '123', SalesUserId: 1, CnDocuNo: 'RB-NEW', CreatedAt: new Date('2026-01-01T00:00:00Z') };
    return inputs.id === 1 ? [] : [newer];
  }
  if (/FROM wf\.RebateClaimLine l/.test(text) && /WHERE l.ClaimId/.test(text)) return [
    { Id: 3, SourceSOID: 19, SourceListNo: 1, SourceDocuNo: 'OLD', SourceDocuDate: '2025-12-01', InvoiceNo: 'OLD', QtyTon: 2 },
    { Id: 4, SourceSOID: 20, SourceListNo: 1, SourceDocuNo: 'NEW', SourceDocuDate: '2026-01-01', InvoiceNo: 'NEW', QtyTon: 1 },
  ];
  if (/SELECT TOP 1 1 AS ok FROM wf\.v_RebateAccrualRemaining/.test(text)) return [{ ok: 1 }];
  if (/FROM wf\.v_RebateAccrualRemaining/.test(text) && /GROUP BY GoodCode/.test(text)) {
    assert.match(text, /SourceDocuDate < @globalStartDate/);
    return [{ GoodCode: 'TEST', GoodName: 'test', RemainingTon: 2, RemainingAmt: 100 }];
  }
  if (/FROM wf\.v_RebateAccrualRemaining/.test(text) && /GROUP BY CustId/.test(text)) {
    assert.doesNotMatch(text, /WHERE[^]*SourceDocuDate >= @globalStartDate/);
    return [{ CustId: '123', RemainingAmt: 125, OpeningAmt: 50, RemainingTon: 2, OpeningTon: 1, LotCount: 1 }];
  }
  if (/FROM wf\.v_RebateAccrualRemaining/.test(text) && /SourceDocuDate >= @globalStartDate/.test(text)) {
    assert.equal(inputs.globalStartDate, '2026-01-01');
    return [{ SourceSOID: 2, SourceDocuDate: '2026-01-01' }];
  }
  return [];
}, { activeUserIds: h.TEST_USERS });
let app;
test.before(async () => { app = await h.startApp([['/api/rebate', '../../routes/rebate']]); });
test.after(async () => app.close());

test('accrual summary preserves eligible opening balance and masks old date detail', async () => {
  const result = await app.call('GET', '/api/rebate/accrual', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body[0].RemainingAmt, 125); assert.equal(result.body[0].OpeningAmt, 50);
  const call = db.calls.find(c => /GROUP BY CustId/.test(c.text) && /v_RebateAccrualRemaining/.test(c.text));
  assert.match(call.text, /CASE WHEN SourceDocuDate < @globalStartDate/);
  assert.match(call.text, /MIN\(CASE WHEN SourceDocuDate >= @globalStartDate/);
});

test('individual old accrual lots are not returned by the detail endpoint', async () => {
  const result = await app.call('GET', '/api/rebate/accrual/123', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.map(row => row.SourceSOID), [2]);
});

test('claim details hide old document references without removing their financial lines', async () => {
  const user = { sub: 1, role: 'ADMIN' };
  const old = await app.call('GET', '/api/rebate/claims/1', { user });
  assert.equal(old.status, 404);
  const current = await app.call('GET', '/api/rebate/claims/2', { user });
  assert.equal(current.status, 200, JSON.stringify(current.body));
  assert.equal(current.body.lines[0].IsOpeningBalance, true);
  assert.equal(current.body.lines[0].SourceDocuNo, null);
  assert.equal(current.body.lines[0].QtyTon, 2);
  assert.equal(current.body.lines[1].SourceDocuNo, 'NEW');
});

test('opening balance choices are aggregated without historical document identities', async () => {
  const result = await app.call('GET', '/api/rebate/accrual/123/opening', { user: { sub: 1, role: 'ADMIN' } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body[0].RemainingTon, 2);
  assert.equal(result.body[0].SourceSOID, undefined);
  assert.equal(result.body[0].SourceDocuNo, undefined);
});

test('opening balance choices do not expose money to sales', async () => {
  const result = await app.call('GET', '/api/rebate/accrual/123/opening', { user: { sub: 2, role: 'SALES' } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body[0].RemainingTon, 2);
  assert.equal(result.body[0].RemainingAmt, null);
});
