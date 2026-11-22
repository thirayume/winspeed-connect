'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotOct31StandingPrices } = require('../services/rebate-conversion-service');

// Owner, 22 Nov 2026: the 31 Oct standing price is WinSpeed's general announced price on 31 Oct, chosen like the
// Rebate base price; Sale-App's own price book is not read.
test('snapshot reads the WinSpeed general price list on 31 Oct; a same-day tie is left out and reported', async () => {
  const writes = [];
  let listSql = null;
  const query = async (text, params) => {
    if (text.includes('FROM dbo.EMSetPriceHD')) {
      listSql = text;
      assert.equal(params.standingDate, '2026-10-31');
      return { recordset: [
        { GoodId: 7, GoodCode: 'G-7', GoodName: 'Seven', ListPricePerTon: 16000, SetPriceID: 30, PriceListCode: 'SP-30', BeginDate: '2026-10-19' },
        { GoodId: 7, GoodCode: 'G-7', GoodName: 'Seven', ListPricePerTon: 15000, SetPriceID: 20, PriceListCode: 'SP-20', BeginDate: '2026-09-01' },
        { GoodId: 9, GoodCode: 'G-9', ListPricePerTon: 100, SetPriceID: 31, BeginDate: '2026-10-01' },
        { GoodId: 9, GoodCode: 'G-9', ListPricePerTon: 200, SetPriceID: 32, BeginDate: '2026-10-01' },
      ] };
    }
    assert.doesNotMatch(text, /wf\.PriceBook/);
    writes.push(params);
    return { recordset: [{ Id: writes.length, StandingYear: params.standingYear, GoodId: params.goodId, BasePrice: params.basePrice }] };
  };
  const result = await snapshotOct31StandingPrices(query, { standingYear: 2026 });
  assert.match(listSql, /hd\.CustID IS NULL AND dt\.GoodPriceNet > 0/);
  assert.match(listSql, /hd\.BeginDate <= CAST\(@standingDate AS date\)/);
  assert.match(listSql, /hd\.EndDate IS NULL OR hd\.EndDate >= CAST\(@standingDate AS date\)/);
  assert.match(listSql, /ORDER BY dt\.ListID ASC, hd\.BeginDate DESC, dt\.SetPriceID DESC/);
  assert.doesNotMatch(listSql, /wf\.PriceBook/);
  // the latest list wins; the tied goods is not written
  assert.equal(writes.length, 1);
  assert.equal(writes[0].goodId, 7); assert.equal(writes[0].basePrice, 16000);
  assert.equal(writes[0].sourceType, 'WINSPEED_PRICELIST'); assert.equal(writes[0].sourcePriceBookId, 30); assert.equal(writes[0].priceListCode, 'SP-30');
  assert.equal(result.count, 1);
  assert.deepEqual(result.skipped, [{ goodId: 9, goodCode: 'G-9', reason: 'OCT31_PRICE_AMBIGUOUS' }]);
  // nothing effective on 31 Oct: nothing is written
  const empty = async text => { if (text.includes('FROM dbo.EMSetPriceHD')) return { recordset: [] }; throw new Error('no write expected'); };
  await assert.rejects(snapshotOct31StandingPrices(empty, { standingYear: 2026 }), { code: 'NO_PRICES_FOR_OCT31_SNAPSHOT' });
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
