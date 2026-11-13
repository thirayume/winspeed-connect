'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateSharedRebate } = require('../services/rebate-shared-fifo');
const lots = [
  { SourceSOID: 2, SourceListNo: 1, SourceDocuNo: 'NEW', SourceDocuDate: '2026-02-01', RemainingTonRebate: 2, RebatePerTon: 200, PlanId: 1 },
  { SourceSOID: 1, SourceListNo: 1, SourceDocuNo: 'OLD', SourceDocuDate: '2025-02-01', RemainingTonRebate: 1, RebatePerTon: 100, PlanId: 1 },
];

test('shared source uses oldest remaining claim lots, including opening balance', () => {
  const result = allocateSharedRebate(lots, { requestedAmountBaht: 250, asOfDate: '2026-06-01' });
  assert.deepEqual(result.allocations.map(x => [x.sourceSOID, x.qtyTon, x.amountBaht]), [[1, 1, 100], [2, 0.75, 150]]);
  assert.equal(result.remainingBaht, 250);
});

test('early conversion is allowed and matured-only is based on document date', () => {
  const early = allocateSharedRebate(lots, { convertAll: true, asOfDate: '2026-06-01' });
  assert.equal(early.convertedBaht, 500);
  const matured = allocateSharedRebate(lots, { convertAll: true, maturedOnly: true, asOfDate: '2026-06-01' });
  assert.equal(matured.convertedBaht, 100);
  assert.deepEqual(matured.allocations.map(x => x.sourceSOID), [1]);
});

test('amounts that cannot be represented by FIFO source quantities fail without rounding away value', () => {
  const source = [{ ...lots[0], RemainingTonRebate: 1, RebatePerTon: 1500 }];
  assert.throws(() => allocateSharedRebate(source, { requestedAmountBaht: 1, asOfDate: '2026-06-01' }), { code: 'CONVERSION_AMOUNT_NOT_REPRESENTABLE' });
});

test('duplicate source rows and overspending are rejected', () => {
  assert.throws(() => allocateSharedRebate([lots[0], lots[0]], { convertAll: true, asOfDate: '2026-06-01' }), { code: 'REBATE_SOURCE_DUPLICATE' });
  assert.throws(() => allocateSharedRebate(lots, { requestedAmountBaht: 501, asOfDate: '2026-06-01' }), { code: 'INSUFFICIENT_REBATE_BALANCE' });
});
