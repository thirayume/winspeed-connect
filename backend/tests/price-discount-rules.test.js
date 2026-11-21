'use strict';
// Owner, 18 Nov 2026: below the announced price by up to 200 baht/ton needs no approval, up to 300 needs a manager,
// beyond 300 the bill cannot be saved; prices move up or down from the announced price in steps of 100 baht.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const settings = { REBATE_STANDARD_LIMIT_PER_TON: '200', REBATE_MAX_LIMIT_PER_TON: '300' };
h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.SystemSetting WHERE SettingKey = @k/.test(text)) return settings[inputs.k] ? [{ SettingValue: settings[inputs.k] }] : [];
  if (/FROM dbo\.EMCust/.test(text)) return [{ CustID: 1078 }];
  if (/FROM dbo\.EMSetPriceHD/.test(text)) {
    if (inputs.goodId === 1114) return [{ SetPriceID: 1, ListNo: 1, AnnouncedPrice: 19000, PriceSource: 'EMSetPrice' }];
    if (inputs.goodId === 1200) return [{ SetPriceID: 1, ListNo: 2, AnnouncedPrice: 17250, PriceSource: 'EMSetPrice' }];
  }
  return [];
});
const { evaluateLinePrice, priceRuleError, readDiscountLimits } = require('../services/price-authority');
const { clearSettingCache } = require('../services/policy-contract');
const line = (goodId, pricePerTon) => ({ goodId: String(goodId), goodName: `สินค้า ${goodId}`, pricePerTon, qtyTon: 1 });

test('discount bands follow the App Settings limits', async () => {
  clearSettingCache?.();
  const at = async price => evaluateLinePrice(line(1114, price), '1078', '2026-12-01');
  for (const [price, approval, overMax] of [[19100, false, false], [19000, false, false], [18900, false, false],
    [18800, false, false], [18700, true, false], [18600, true, true], [18000, true, true]]) {
    const ev = await at(price);
    assert.equal(ev.requiresApproval, approval, `price ${price} approval`);
    assert.equal(ev.overMaxDiscount, overMax, `price ${price} over max`);
    assert.equal(ev.offPriceStep, false, `price ${price} step`);
  }
});

test('steps of 100 count from the announced price, also when it is not a whole hundred', async () => {
  assert.equal((await evaluateLinePrice(line(1114, 18950), '1078', '2026-12-01')).offPriceStep, true);
  assert.equal((await evaluateLinePrice(line(1114, 19050), '1078', '2026-12-01')).offPriceStep, true);
  assert.equal((await evaluateLinePrice(line(1200, 17050), '1078', '2026-12-01')).offPriceStep, false);
  assert.equal((await evaluateLinePrice(line(1200, 17000), '1078', '2026-12-01')).offPriceStep, true);
});

test('a bill with an off-step price or a discount beyond the ceiling is refused with a Thai message', async () => {
  const limits = await readDiscountLimits();
  assert.deepEqual(limits, { standard: 200, max: 300, step: 100 });
  const ok = await Promise.all([line(1114, 18800), line(1114, 18700)].map(l => evaluateLinePrice(l, '1078', '2026-12-01')));
  assert.equal(priceRuleError(ok, limits), null);
  const over = await evaluateLinePrice(line(1114, 18600), '1078', '2026-12-01');
  const overErr = priceRuleError([over], limits);
  assert.equal(overErr.code, 'PRICE_DISCOUNT_OVER_MAX');
  assert.equal(overErr.status, 400);
  assert.match(overErr.message, /ลดราคาเกินเพดาน 300 บาท\/ตัน บันทึกไม่ได้ \(สินค้า 1114\)/);
  assert.doesNotMatch(overErr.message, /19,?000/, 'the announced price is not revealed');
  const step = priceRuleError([await evaluateLinePrice(line(1114, 18950), '1078', '2026-12-01')], limits);
  assert.equal(step.code, 'PRICE_STEP_REQUIRED');
  assert.match(step.message, /ทีละ 100 บาท\/ตัน/);
});

test('giveaway lines and lines without an announced price are not held to the step or the ceiling', async () => {
  const give = await evaluateLinePrice({ ...line(1114, 0), isGiveaway: true }, '1078', '2026-12-01');
  assert.equal(give.requiresApproval, false);
  assert.equal(Boolean(give.overMaxDiscount || give.offPriceStep), false);
  const none = await evaluateLinePrice(line(9999, 12345), '1078', '2026-12-01');
  assert.equal(none.requiresApproval, true);
  assert.equal(Boolean(none.overMaxDiscount || none.offPriceStep), false);
});

test('the save path applies the rule on create and on a priced edit, and keeps old prices on an unpriced edit', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/so.js'), 'utf8');
  assert.match(src, /const priceRule = priceRuleError\(lineEvaluations, discountLimits\);\s+if \(priceRule\) throw priceRule;/);
  assert.match(src, /const priceRule = pricingChanged \? priceRuleError\(lineEvaluations, discountLimits\) : null;/);
});
// Owner, 21 Nov 2026: the step is App Setting PRICE_STEP_PER_TON; a discount that is not a whole step is refused.
test('the price step follows App Settings: 130, 15, 180, 220, 175 and 275 are refused at a step of 100; at 50 only whole fifties pass', async () => {
  const { evaluateLinePrice: evaluate, priceRuleError: ruleError } = require('../services/price-authority');
  const check = async (discount, limits) => ruleError([await evaluate(line(1114, 19000 - discount), '1078', '2026-12-01', { discountLimits: limits })], limits);
  const step100 = { standard: 200, max: 300, step: 100 };
  for (const d of [130, 15, 180, 220, 175, 275]) {
    const err = await check(d, step100);
    assert.equal(err?.code, 'PRICE_STEP_REQUIRED', String(d)); assert.match(err.message, /ได้ทีละ 100 บาท\/ตัน/);
  }
  for (const d of [0, 100, 200, 300]) assert.equal(await check(d, step100), null, String(d));
  const step50 = { standard: 200, max: 300, step: 50 };
  assert.equal(await check(150, step50), null);
  assert.match((await check(175, step50)).message, /ได้ทีละ 50 บาท\/ตัน/);
  settings.PRICE_STEP_PER_TON = '50';
  require('../services/policy-contract').clearSettingCache?.();
  assert.equal((await readDiscountLimits()).step, 50);
  delete settings.PRICE_STEP_PER_TON;
  require('../services/policy-contract').clearSettingCache?.();
});
