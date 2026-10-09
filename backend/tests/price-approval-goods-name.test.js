'use strict';

/**
 * UAT 2026-10-09: a line sent without its goods code was stored as the text "undefined" and the approver saw
 * "สินค้า: undefined". A missing code or name now comes from the goods master.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

h.installDbStub(() => []);
const { createPriceApprovalRequest } = require('../services/price-authority');

function captureTx() {
  const seen = { inputs: {}, text: '' };
  const r = { input(name, _t, v) { seen.inputs[name] = v; return r; }, async query(text) { seen.text = text; return { recordset: [{ Id: 1 }] }; } };
  return { seen, tx: { request: () => r } };
}

test('a missing goods code is not stored as "undefined"; the master fills it', async () => {
  const { seen, tx } = captureTx();
  await createPriceApprovalRequest(tx, { soId: 1, custId: '1078', goodId: '1118', goodCode: undefined, goodName: undefined,
    qtyTon: 1, announcedPrice: 0, requestedPrice: 16000, priceDeviationPerTon: 0, totalDeviationAmt: 0, requestedBy: 43 });
  assert.equal(seen.inputs.goodCode, null);
  assert.equal(seen.inputs.goodName, null);
  assert.match(seen.text, /COALESCE\(@goodCode, \(SELECT TOP 1 g\.GoodCode FROM dbo\.EMGood/);
  assert.match(seen.text, /COALESCE\(@goodName, \(SELECT TOP 1 g\.GoodName1 FROM dbo\.EMGood/);
});

test('a code sent by the editor is kept', async () => {
  const { seen, tx } = captureTx();
  await createPriceApprovalRequest(tx, { soId: 1, custId: '1078', goodId: '1114', goodCode: '7-15151500BBCAR', goodName: '15-15-15',
    qtyTon: 1, announcedPrice: 0, requestedPrice: 19500, priceDeviationPerTon: 0, totalDeviationAmt: 0, requestedBy: 43 });
  assert.equal(seen.inputs.goodCode, '7-15151500BBCAR');
  assert.equal(seen.inputs.goodName, '15-15-15');
});
