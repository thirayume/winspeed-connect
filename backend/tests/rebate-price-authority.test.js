'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRebateBasePrice, evaluateRebatePriceDecision } = require('../services/rebate-price-authority');

const row = { SetPriceID: 9, ListNo: 1, GoodId: 17, BeginDate: '2026-01-01', EndDate: '2026-12-31', BasePrice: '18000.00', DatabaseName: 'UAT', ServerName: 'TEST\\SQL' };
function fixture(rows) {
  const calls = [];
  return { calls, query: async (sql, inputs) => { calls.push({ sql, inputs }); return { recordset: rows }; } };
}
test('base price uses the general effective price list in a locked sale transaction', async () => {
  const f = fixture([row, { ...row, SetPriceID: 8, BeginDate: '2025-01-01' }]);
  assert.deepEqual(await resolveRebateBasePrice(f.query, { goodId: 17, saleDate: '2026-04-02' }), {
    setPriceId: 9, listNo: 1, goodId: 17, database: 'UAT', server: 'TEST\\SQL', saleDate: '2026-04-02', beginDate: '2026-01-01', endDate: '2026-12-31', basePrice: '18000.00',
  });
  assert.match(f.calls[0].sql, /hd\.CustID IS NULL/);
  assert.match(f.calls[0].sql, /UPDLOCK,HOLDLOCK/);
  assert.doesNotMatch(f.calls[0].sql, /NOLOCK/);
  assert.deepEqual(f.calls[0].inputs, { goodId: 17, saleDate: '2026-04-02' });
});

test('decision derives every case from the server price and binds price, mode and quantity', async () => {
  const decision = { draftId: 23, lineNo: 1, revision: 3, goodId: 17, saleDate: '2026-04-02', qtyTon: '1.000', sellingPrice: '17750.00', isCashDiscount: false };
  const run = input => evaluateRebatePriceDecision(fixture([row]).query, input);
  const over = await run(decision);
  assert.equal(over.calculation.invoiceUnitPrice, 18000);
  assert.equal(over.calculation.rebatePerTon, 250);
  assert.equal(over.calculation.requiresManagerApproval, true);
  assert.equal(over.fingerprint, (await run(decision)).fingerprint);
  assert.notEqual(over.fingerprint, (await run({ ...decision, qtyTon: '2.000' })).fingerprint);
  assert.notEqual(over.fingerprint, (await run({ ...decision, draftId: 24 })).fingerprint);
  assert.notEqual(over.fingerprint, (await run({ ...decision, revision: 4 })).fingerprint);
  assert.notEqual(over.fingerprint, (await evaluateRebatePriceDecision(fixture([{ ...row, DatabaseName: 'OTHER' }]).query, decision)).fingerprint);
  const cash = await run({ ...decision, isCashDiscount: true });
  assert.equal(cash.calculation.invoiceUnitPrice, 17750);
  assert.equal(cash.calculation.rebatePerTon, 0);
  assert.notEqual(over.fingerprint, cash.fingerprint);
  const markup = await run({ ...decision, sellingPrice: '18300.00' });
  assert.equal(markup.calculation.invoiceUnitPrice, 18300);
  assert.equal(markup.calculation.rebatePerTon, 200);
  assert.equal(markup.calculation.companyExtraProfitPerTon, 100);
  assert.equal((await run({ ...decision, sellingPrice: '17800.00' })).calculation.requiresManagerApproval, false);
  assert.equal((await run({ ...decision, sellingPrice: '17799.99' })).calculation.requiresManagerApproval, true);
  assert.equal((await run({ ...decision, sellingPrice: '17700.00' })).calculation.rebatePerTon, 300);
  assert.equal((await run({ ...decision, sellingPrice: '18000.00' })).calculation.rebatePerTon, 0);
  await assert.rejects(run({ ...decision, sellingPrice: '17699.99' }), { code: 'REBATE_EXCEEDS_MAX_LIMIT' });
  await assert.rejects(run({ ...decision, sellingPrice: '17699.00' }), { code: 'REBATE_EXCEEDS_MAX_LIMIT' });
  for (const bad of [{ ...decision, draftId: 0 }, { ...decision, isCashDiscount: 'false' }, { ...decision, qtyTon: '1.0001' }, { ...decision, sellingPrice: '17750.001' }]) {
    await assert.rejects(run(bad), { code: 'REBATE_PRICE_INPUT_INVALID' });
  }
});
test('missing, same-day ambiguous, expired and mismatched prices fail closed', async () => {
  const input = { goodId: 17, saleDate: '2026-04-02' };
  await assert.rejects(resolveRebateBasePrice(fixture([]).query, input), { code: 'REBATE_BASE_PRICE_UNAVAILABLE' });
  await assert.rejects(resolveRebateBasePrice(fixture([row, { ...row, SetPriceID: 10 }]).query, input), { code: 'REBATE_BASE_PRICE_AMBIGUOUS' });
  for (const bad of [{ ...row, EndDate: '2026-01-02' }, { ...row, GoodId: 18 }, { ...row, BasePrice: '0.00' }]) {
    await assert.rejects(resolveRebateBasePrice(fixture([bad]).query, input));
  }
  for (const bad of [{ ...input, goodId: 0 }, { ...input, saleDate: '2026-02-30' }]) {
    await assert.rejects(resolveRebateBasePrice(fixture([row]).query, bad), { code: 'REBATE_PRICE_INPUT_INVALID' });
  }
});
