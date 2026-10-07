'use strict';

/**
 * UAT batch 5 (found live on I69-04219): an unlocked native bill was saved with the lines exactly as sent — a price
 * far below the list with no approval, a NET floor of ฿1 from the client (rebate = (price − NET) × tons) and
 * giveaways nobody approved. The edit now gets the server checks a new bill gets.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

// announced (list) price per good; 1165 has none in effect
const announced = { 1118: 16000 };
h.installDbStub(({ text, inputs }) => {
  if (/FROM dbo\.EMCust/.test(text)) return [{ CustID: 1078 }];
  if (/FROM dbo\.EMSetPriceHD/.test(text)) {
    const p = announced[inputs.goodId];
    return p ? [{ SetPriceID: 1, ListNo: 1, AnnouncedPrice: p, PriceSource: 'EMSetPrice' }] : [];
  }
  return [];
});

const so = require('../routes/so');
const held = [{ Id: 5, GoodId: 1156, LeftQty: 1 }];
const tx = { request: () => ({ input() { return this; }, query: async (t) => ({ recordset: /FROM wf\.CouponReservation/.test(t) ? held.map(x => ({ ...x })) : [] }) }) };
const bill = { Id: '278000', CustId: '1078', SalesUserId: 43, SoPrefix: 'I' };
const before = [
  { GoodId: 1118, QtyTon: 1, PricePerTon: 15500, IsGiveaway: false },
  { GoodId: 1165, QtyTon: 1, PricePerTon: 17000, IsGiveaway: false },
  { GoodId: 1200, QtyTon: 0.5, PricePerTon: 0, IsGiveaway: true, GiveawayApprovalStatus: 'APPROVED', GiveawayApprovedBy: 25, GiveawayApprovedAt: '2026-10-07T03:00:00Z' },
];
const sales = { user: { sub: 43, role: 'SALES' } };
const edit = (lines, custId = '1078') => so.checkUnlockedNativeEdit(tx, sales, bill, { custId, soPrefix: 'I', deliveryDate: '2026-10-09', lines }, before);
const line = (goodId, qtyTon, pricePerTon, extra = {}) => ({ goodId: String(goodId), qtyTon, pricePerTon, isGiveaway: false, ...extra });

test('a price below the list and below the bill\'s own price is refused', async () => {
  await assert.rejects(edit([line(1118, 2, 9000, { netPricePerTon: 1 })]), e => e.status === 409 && e.code === 'UNLOCKED_EDIT_NEEDS_APPROVAL');
});

test('an approved discount keeps its price but may not grow in tons', async () => {
  const kept = await edit([line(1118, 1, 15500, { netPricePerTon: 1 })]);
  assert.equal(kept[0].net, 16000, 'NET comes from the price list, not the client');
  await assert.rejects(edit([line(1118, 2, 15500)]), e => e.status === 409);
});

test('without a list price, the bill\'s own price is kept and tons may change', async () => {
  const r = await edit([line(1165, 3, 17000, { netPricePerTon: 1 })]);
  assert.equal(r[0].net, 0);
  await assert.rejects(edit([line(1165, 1, 16000)]), e => e.status === 409);
});

test('at or above the list, any edit passes with the server NET', async () => {
  const r = await edit([line(1118, 5, 16500, { netPricePerTon: 1 })]);
  assert.equal(r[0].net, 16000);
});

test('the baseline is the same customer only', async () => {
  await assert.rejects(edit([line(1165, 1, 17000)], '1079'), e => e.status === 409);
});

test('giveaways: an approved one is kept, a new one from sales is refused', async () => {
  const r = await edit([line(1118, 1, 16000), line(1200, 0.5, 0, { isGiveaway: true })]);
  assert.equal(r[1].giveaway.status, 'APPROVED');
  assert.equal(r[1].giveaway.by, 25);
  await assert.rejects(edit([line(1118, 1, 16000), line(1200, 1, 0, { isGiveaway: true })]), e => /ของแถม/.test(e.message));
});

test('a ฿0 line is accepted only against a coupon reservation already on the bill', async () => {
  const r = await edit([line(1156, 1, 0)]);
  assert.equal(r[0].net, 0);
  await assert.rejects(edit([line(1156, 2, 0)]), e => e.status === 409);
  await assert.rejects(edit([line(1156, 1, 0), line(1156, 1, 0)]), e => e.status === 409);
});
