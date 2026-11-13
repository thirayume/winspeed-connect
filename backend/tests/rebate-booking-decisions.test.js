'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareRebateBookingDecisions } = require('../services/rebate-booking-decisions');

const draft = { Id: 51, DocumentRevision: 3 };
const line = { SoId: 51, LineNum: 1, GoodId: 12, QtyTon: 2, PricePerTon: 9750, RebatePricingMode: 'POOL' };
const query = async (_text, inputs) => ({ recordset: [{ SetPriceID: 8, ListNo: 1, GoodId: inputs.goodId,
  BeginDate: '2026-01-01', EndDate: '2026-12-31', BasePrice: 10000,
  DatabaseName: 'test_uat', ServerName: 'test_server' }] });

test('booking decisions use locked draft values, issuance date and server price', async () => {
  const [result] = await prepareRebateBookingDecisions(query, { draft, lines: [line], saleDate: '2026-11-13' });
  assert.equal(result.source.basePrice, '10000.00');
  assert.equal(result.sellingPrice, '9750.00');
  assert.equal(result.calculation.invoiceUnitPrice, 10000);
  assert.equal(result.calculation.requiresManagerApproval, true);
  assert.equal(result.calculation.totalRebateEarned, 500);
  assert.equal(result.saleDate, '2026-11-13');
});

test('missing mode, special lines, duplicates and another draft fail closed', async () => {
  for (const [lines, code] of [
    [[{ ...line, RebatePricingMode: null }], 'REBATE_PRICING_MODE_REQUIRED'],
    [[{ ...line, IsCouponDrawn: 1 }], 'REBATE_NONCOMMERCIAL_PROOF_UNAVAILABLE'],
    [[line, line], 'REBATE_DRAFT_INVALID'],
    [[{ ...line, SoId: 52 }], 'REBATE_DRAFT_INVALID'],
  ]) await assert.rejects(prepareRebateBookingDecisions(query, { draft, lines, saleDate:'2026-11-13' }), { code });
});

test('zero-priced giveaways are excluded from native pricing decisions', async () => {
  const gift={SoId:51,LineNum:2,GoodId:13,QtyTon:0,PricePerTon:0,IsGiveaway:1,RebatePricingMode:null};
  const decisions=await prepareRebateBookingDecisions(query,{draft,lines:[line,gift],saleDate:'2026-11-13'});
  assert.equal(decisions.length,1);assert.equal(decisions[0].lineNo,1);
  await assert.rejects(prepareRebateBookingDecisions(query,{draft,lines:[line,{...gift,PricePerTon:1}],saleDate:'2026-11-13'}),
    {code:'REBATE_NONCOMMERCIAL_PROOF_UNAVAILABLE'});
});

test('changing the mode or sale date produces a different approval fingerprint', async () => {
  const prepare = (lines, saleDate) => prepareRebateBookingDecisions(query, { draft, lines, saleDate });
  const [pool] = await prepare([line], '2026-11-13');
  const [cash] = await prepare([{ ...line, RebatePricingMode: 'CASH' }], '2026-11-13');
  const [later] = await prepare([line], '2026-11-14');
  assert.notEqual(pool.fingerprint, cash.fingerprint);
  assert.notEqual(pool.fingerprint, later.fingerprint);
  assert.equal(cash.calculation.totalRebateEarned, 0);
});
