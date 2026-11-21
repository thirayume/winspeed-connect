'use strict';
// App Settings limits (REBATE_STANDARD_LIMIT_PER_TON / REBATE_MAX_LIMIT_PER_TON) as the bill's price check reads them.
require('../services/price-authority').readDiscountLimits = async () => ({ standard: 200, max: 300 });
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRebateBasePrice, evaluateRebatePriceDecision } = require('../services/rebate-price-authority');

const row = { SetPriceID: 9, ListNo: 1, GoodId: 17, BeginDate: '2026-01-01', EndDate: '2026-12-31', BasePrice: '18000.00', DatabaseName: 'UAT', ServerName: 'TEST\\SQL' };
function fixture(rows) {
  const calls = [];
  return { calls, query: async (sql, inputs) => { calls.push({ sql, inputs }); return { recordset: rows }; } };
}
test('base price uses the effective announced price list in a locked sale transaction', async () => {
  const f = fixture([row, { ...row, SetPriceID: 8, BeginDate: '2025-01-01' }]);
  assert.deepEqual(await resolveRebateBasePrice(f.query, { goodId: 17, saleDate: '2026-04-02' }), {
    setPriceId: 9, listNo: 1, goodId: 17, customerPrice: false, database: 'UAT', server: 'TEST\\SQL', saleDate: '2026-04-02', beginDate: '2026-01-01', endDate: '2026-12-31', basePrice: '18000.00',
  });
  assert.ok(f.calls[0].sql.includes('(hd.CustID IS NULL OR (@custId IS NOT NULL AND hd.CustID=@custId))'));
  assert.ok(f.calls[0].sql.includes('ORDER BY CASE WHEN hd.CustID IS NOT NULL THEN 0 ELSE 1 END,hd.BeginDate DESC'));
  assert.match(f.calls[0].sql, /UPDLOCK,HOLDLOCK/);
  assert.doesNotMatch(f.calls[0].sql, /NOLOCK/);
  assert.deepEqual(f.calls[0].inputs, { goodId: 17, saleDate: '2026-04-02', custId: null });
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
// Owner, 21 Nov 2026: a customer's own announced price is that customer's base price, as on the bill.
test('the customer own announced price is the base price; a tie is judged only within the same kind of list', async () => {
  const { resolveRebateCustomer } = require('../services/rebate-price-authority');
  const cust = { ...row, SetPriceID: 30, BasePrice: '17500.00', CustomerPrice: 1, BeginDate: '2026-02-01' };
  const general = { ...row, CustomerPrice: 0, BeginDate: '2026-02-01' };
  const f = fixture([cust, general]);
  const r = await resolveRebateBasePrice(f.query, { goodId: 17, saleDate: '2026-04-02', custId: 1078 });
  assert.equal(r.basePrice, '17500.00'); assert.equal(r.customerPrice, true); assert.equal(r.setPriceId, 30);
  assert.equal(f.calls[0].inputs.custId, 1078);
  await assert.rejects(resolveRebateBasePrice(fixture([cust, { ...cust, SetPriceID: 31 }]).query, { goodId: 17, saleDate: '2026-04-02', custId: 1078 }),
    { code: 'REBATE_BASE_PRICE_AMBIGUOUS' });
  await assert.rejects(resolveRebateBasePrice(fixture([row]).query, { goodId: 17, saleDate: '2026-04-02', custId: 0 }), { code: 'REBATE_PRICE_INPUT_INVALID' });
  // the customer key is read like the bill: a number is a CustID or a CustCode; two different customers are refused
  const seen = [];
  const q = rows => async (sql, inputs) => { seen.push({ sql, inputs }); return { recordset: rows }; };
  assert.equal(await resolveRebateCustomer(q([{ CustID: 1078 }]), '1078'), 1078);
  assert.match(seen[0].sql, /CustID=@cid OR CustCode=@code/); assert.deepEqual(seen[0].inputs, { cid: 1078, code: '1078' });
  assert.equal(await resolveRebateCustomer(q([{ CustID: 55 }]), 'C-0055'), 55);
  assert.match(seen[1].sql, /WHERE CustCode=@code/);
  assert.equal(await resolveRebateCustomer(q([]), 'none'), null);
  assert.equal(await resolveRebateCustomer(q([]), ''), null);
  await assert.rejects(resolveRebateCustomer(q([{ CustID: 1 }, { CustID: 2 }]), '2'), { code: 'REBATE_CUSTOMER_AMBIGUOUS' });
  // the decision carries the customer price into its calculation
  const d = await evaluateRebatePriceDecision(fixture([cust]).query, { draftId: 23, lineNo: 1, revision: 3, goodId: 17, saleDate: '2026-04-02',
    qtyTon: '1.000', sellingPrice: '17300.00', isCashDiscount: false, custId: 1078 });
  assert.equal(d.source.basePrice, '17500.00'); assert.equal(d.calculation.rebatePerTon, 200); assert.equal(d.calculation.requiresManagerApproval, false);
});
