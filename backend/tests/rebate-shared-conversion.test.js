'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { executeSharedSourceConversion } = require('../services/rebate-shared-conversion');

function fixture() {
  const calls = [];
  const lots = [
    { SourceSOID: 1, SourceListNo: 1, SourceDocuNo: 'OLD', SourceDocuDate: '2025-02-01', CustCode: 'TEST', CustName: 'test', RemainingTonRebate: 1, RebatePerTon: 100, PlanId: 1 },
    { SourceSOID: 2, SourceListNo: 1, SourceDocuNo: 'NEW', SourceDocuDate: '2026-02-01', CustCode: 'TEST', CustName: 'test', RemainingTonRebate: 2, RebatePerTon: 200, PlanId: 1 },
  ];
  const query = async (text, params) => {
    calls.push({ text, params });
    if (/SELECT TOP 1 1 AS ok/.test(text)) return { recordset: [{ ok: 1 }] };
    if (/FROM wf.Oct31StandingPrice/.test(text)) return { recordset: [{ GoodId: 9, GoodCode: 'TEST', GoodName: 'test', StandingYear: 2025, BasePrice: 1000 }] };
    if (/FROM wf.v_RebateAccrualRemaining/.test(text)) return { recordset: lots };
    if (/INSERT INTO wf.FertilizerTicketConversion/.test(text)) return { recordset: [{ Id: 11, CustId: params.custId, GoodId: params.goodId,
      StandingYear: params.year, ConvertedValueBaht: params.amount, ConvertedTons: params.tons, ConvertedBags: params.bags }] };
    if (/INSERT INTO wf.RebateConversionSourceAllocation/.test(text)) return { rowsAffected: [1] };
    throw Error('unexpected SQL');
  };
  return { query, calls };
}

test('conversion reserves the same WinSpeed lots used by existing claims, including opening balance', async () => {
  const { query, calls } = fixture();
  const result = await executeSharedSourceConversion(query, { custId: 123, goodId: 9, standingYear: 2025,
    asOfDate: '2026-06-01', actorUser: { id: 7, role: 'ACCOUNTING' }, requestedAmountBaht: 250, note: 'test', scopeSql: '1=1' });
  assert.equal(result.conversion.convertedValueBaht, 250);
  assert.equal(result.remainingPoolBalance, 250);
  const allocations = calls.filter(c => /INSERT INTO wf.RebateConversionSourceAllocation/.test(c.text));
  assert.deepEqual(allocations.map(c => [c.params.sourceSOID, c.params.qtyTon, c.params.amountBaht]), [[1, 1, 100], [2, 0.75, 150]]);
  assert.ok(!calls.some(c => /RebateTransactionLedger/.test(c.text)));
});

test('conversion uses chosen standing price to derive value from requested fertilizer tons', async () => {
  const { query } = fixture();
  const result = await executeSharedSourceConversion(query, { custId: 123, goodId: 9, standingYear: 2025,
    asOfDate: '2026-06-01', actorUser: { id: 7, role: 'ACCOUNTING' }, requestedTons: 0.25, note: 'test', scopeSql: '1=1' });
  assert.equal(result.conversion.convertedValueBaht, 250);
  assert.equal(result.conversion.convertedTons, 0.25);
});

test('lot reservation applies the same actor and effective-user scope as its access check', async () => {
  const { query, calls } = fixture();
  await executeSharedSourceConversion(query, { custId: 123, goodId: 9, standingYear: 2025,
    asOfDate: '2026-06-01', actorUser: { id: 7, role: 'ACCOUNTING' }, requestedAmountBaht: 100,
    scopeSql: '(SalesEmpId=@effectiveEmp AND SalesEmpId=@actorEmp)', scopeInputs: { effectiveEmp: 12, actorEmp: 12 } });
  const lotQuery = calls.find(c => /SELECT SourceSOID/.test(c.text));
  assert.match(lotQuery.text, /SalesEmpId=@effectiveEmp AND SalesEmpId=@actorEmp/);
  assert.equal(lotQuery.params.effectiveEmp, 12);
  assert.equal(lotQuery.params.actorEmp, 12);
});

test('unrepresentable tonnage fails before a conversion or allocation is inserted', async () => {
  const { query, calls } = fixture();
  await assert.rejects(executeSharedSourceConversion(query, { custId: 123, goodId: 9, standingYear: 2025,
    asOfDate: '2026-06-01', actorUser: { id: 7, role: 'ACCOUNTING' }, requestedTons: 0.100004, scopeSql: '1=1' }),
  err => err.code === 'CONVERSION_TONNAGE_NOT_REPRESENTABLE');
  assert.ok(!calls.some(c => /INSERT INTO wf\.(FertilizerTicketConversion|RebateConversionSourceAllocation)/.test(c.text)));
});
