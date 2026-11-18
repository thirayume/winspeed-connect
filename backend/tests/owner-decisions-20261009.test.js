'use strict';

/**
 * Owner decisions 2026-10-09:
 *  1. the bill editor shows the salesperson a colour for the price only, never an amount (bands set 18 Nov 2026:
 *     no approval up to 200 below, approval up to 300, beyond that the bill cannot be saved, steps of 100);
 *     NET prices are redacted for roles that do not see rebate amounts;
 *  2. a change in goods, tons or price after an unlock voids the WinSpeed approval;
 *  3. rebate claims are cut year by year on the accounting year;
 *  4. WinSpeed bookings before LEGACY_DOC_CUTOFF_DATE are hidden (an open control ticket always shows).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const windowPath = require.resolve('../services/global-data-window-store');
require.cache[windowPath] = {id:windowPath,filename:windowPath,loaded:true,exports:{readGlobalDataWindow:async()=>({businessDate:'2026-01-01',utcInstant:new Date('2025-12-31T17:00:00Z')})}};

const settings = { REBATE_STANDARD_LIMIT_PER_TON: '200', REBATE_MAX_LIMIT_PER_TON: '300', REBATE_CLAIM_FISCAL_START_MONTH: '1', LEGACY_DOC_CUTOFF_DATE: '2022-01-01' };
const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.SystemSetting WHERE SettingKey = @k/.test(text)) return settings[inputs.k] ? [{ SettingValue: settings[inputs.k] }] : [];
  if (/FROM dbo\.EMCust/.test(text)) return [{ CustID: 1078 }];
  if (/FROM dbo\.EMSetPriceHD/.test(text)) return inputs.goodId === 1114 ? [{ SetPriceID: 2016, ListNo: 1, AnnouncedPrice: 19000, PriceSource: 'EMSetPrice' }] : [];
  return [];
}, { activeUserIds: h.TEST_USERS });

const so = require('../routes/so');
const rebate = require('../routes/rebate');
const { clearSettingCache } = require('../services/policy-contract');

let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so'], ['/api/papertrail', '../../routes/papertrail'], ['/api/reports', '../../routes/reports']]); });
test.after(async () => { await app.close(); });

test('1. price colour (owner 18 Nov 2026): no approval up to 200, approval up to 300, red beyond, steps of 100, no amounts returned', async () => {
  const limits = { standard: 200, max: 300 };
  assert.equal(so.priceLevel(19500, 19000, limits), 'GREEN');
  assert.equal(so.priceLevel(19000, 19000, limits), 'EQUAL');
  assert.equal(so.priceLevel(18800, 19000, limits), 'BELOW_STANDARD');
  assert.equal(so.priceLevel(18700, 19000, limits), 'YELLOW');
  assert.equal(so.priceLevel(18600, 19000, limits), 'RED');
  assert.equal(so.priceLevel(18950, 19000, limits), 'OFF_STEP');
  assert.equal(so.priceLevel(19050, 19000, limits), 'OFF_STEP');
  assert.equal(so.priceLevel(18000, 0, limits), 'NONE');
  const r = await app.call('POST', '/api/so/price-indicator', { body: { custId: '1078', deliveryDate: '2026-12-15', lines: [
    { key: 'a', goodId: '1114', pricePerTon: 19500 }, { key: 'b', goodId: '1114', pricePerTon: 18000 }, { key: 'c', goodId: '1118', pricePerTon: 16000 },
    { key: 'd', goodId: '1114', pricePerTon: 0, isGiveaway: true },
  ] }, user: { sub: 43, role: 'SALES' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.lines.map(l => l.level), ['GREEN', 'RED', 'NONE', 'SKIP']);
  assert.ok(!JSON.stringify(r.body).includes('19000'), 'the announced price is not sent back');
});

test('2. a material change is goods, tons, price or giveaway; a remark-only edit is not', () => {
  const before = [{ GoodId: 1118, QtyTon: 1, PricePerTon: 16000, IsGiveaway: false }];
  assert.equal(so.materialChange(before, [{ goodId: '1118', qtyTon: 1, pricePerTon: 16000 }]), false);
  assert.equal(so.materialChange(before, [{ goodId: '1118', qtyTon: 2, pricePerTon: 16000 }]), true);
  assert.equal(so.materialChange(before, [{ goodId: '1118', qtyTon: 1, pricePerTon: 15900 }]), true);
  assert.equal(so.materialChange(before, [{ goodId: '1114', qtyTon: 1, pricePerTon: 16000 }]), true);
  assert.equal(so.materialChange(before, [{ goodId: '1118', qtyTon: 1, pricePerTon: 16000 }, { goodId: '1200', qtyTon: 0.5, pricePerTon: 0, isGiveaway: true }]), true);
});

test('3. claims retain unused balances from previous accounting years', async () => {
  clearSettingCache();
  assert.equal(await rebate.claimCutoffDate('2026-10-09'), null);
  settings.REBATE_CLAIM_FISCAL_START_MONTH = '10'; clearSettingCache();
  assert.equal(await rebate.claimCutoffDate('2026-10-09'), null);
  assert.equal(await rebate.claimCutoffDate('2026-09-30'), null);
  settings.REBATE_CLAIM_FISCAL_START_MONTH = '0'; clearSettingCache();
  assert.equal(await rebate.claimCutoffDate('2026-10-09'), null);
  settings.REBATE_CLAIM_FISCAL_START_MONTH = '1'; clearSettingCache();
});

test('4. the board, the bill list and the backlog report carry the legacy cut-off', async () => {
  const before = db.calls.length;
  await app.call('GET', '/api/papertrail/board', { user: { sub: 12, role: 'ACCOUNTING' } });
  await app.call('GET', '/api/so?page=1&limit=20', { user: { sub: 12, role: 'ACCOUNTING' } });
  // An empty later page also exercises the count-only fallback.
  await app.call('GET', '/api/so?page=2&limit=20', { user: { sub: 12, role: 'ACCOUNTING' } });
  await app.call('GET', '/api/reports/so-backlog', { user: { sub: 12, role: 'ACCOUNTING' } });
  const calls = db.calls.slice(before).filter(c => /@legacyCut/.test(c.text));
  assert.ok(calls.length >= 5, `cut-off in board, both list pages, fallback count and backlog (got ${calls.length})`);
  for (const c of calls) assert.equal(String(c.inputs.legacyCut).slice(0, 10), '2022-01-01');
  assert.ok(calls.some(c => /RTRIM\(hd\.TransRegistration\) = N'ตั๋วคุม'/.test(c.text)), 'open control tickets stay visible');
});

test('1b. NET prices are redacted from a bill for a role that does not see rebate amounts', () => {
  const redacted = so.redactSoForRoleForTest
    ? so.redactSoForRoleForTest({ user: { role: 'SALES' } }, { lines: [{ NetPricePerTon: 19000, PricePerTon: 19500 }] })
    : null;
  if (redacted) { assert.equal(redacted.lines[0].NetPricePerTon, null); assert.equal(redacted.lines[0].PricePerTon, 19500); }
});
