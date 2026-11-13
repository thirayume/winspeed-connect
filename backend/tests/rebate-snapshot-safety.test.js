'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotOct31StandingPrices } = require('../services/rebate-conversion-service');

test('snapshot reads actual PriceBook schema and rejects ambiguous product prices before writing', async () => {
  let writes = 0;
  const query = async text => {
    if (text.includes('FROM wf.PriceBookLine')) {
      assert.match(text, /pbl\.Price AS ListPricePerTon/);
      assert.match(text, /pb\.Name AS PriceListCode/);
      assert.doesNotMatch(text, /pbl\.ListPricePerTon|pb\.Code/);
      return { recordset: [
        { GoodId: 9, ListPricePerTon: 100, PriceBookId: 1 },
        { GoodId: 9, ListPricePerTon: 200, PriceBookId: 2 },
      ] };
    }
    writes++;
    return { recordset: [] };
  };
  await assert.rejects(snapshotOct31StandingPrices(query, { standingYear: 2026 }), { code: 'OCT31_PRICE_AMBIGUOUS' });
  assert.equal(writes, 0);
});

test('snapshot validates all manual entries before its first write', async () => {
  let writes = 0;
  const query = async () => { writes++; return { recordset: [] }; };
  await assert.rejects(snapshotOct31StandingPrices(query, { standingYear: 2026,
    entries: [{ goodId: 1, basePrice: 100 }, { goodId: 2, basePrice: 0 }] }), { code: 'INVALID_STANDING_PRICE_ENTRY' });
  assert.equal(writes, 0);
  await assert.rejects(snapshotOct31StandingPrices(query, { standingYear: 2026,
    entries: [{ goodId: 1, basePrice: 100 }, { goodId: 1, basePrice: 200 }] }), { code: 'DUPLICATE_STANDING_PRICE_ENTRY' });
  assert.equal(writes, 0);
});
