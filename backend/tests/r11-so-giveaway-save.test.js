'use strict';

/**
 * R11 B — POST /api/so with a giveaway line (real payload shape from the bill editor:
 * qtyTon = pieces, qtyBag = pieces × BagPerTon, pieceQty = pieces).
 *  - over quota → 400 GIVEAWAY_OVER_QUOTA before anything is inserted (U-7/U-8);
 *  - within quota → the line is stored as pieces: QtyTon 0, MasterQty 0, QtyBag = pieces (U-5).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const state = { remaining: 300 };
let nextSoId = 4001;
const db = h.installDbStub(({ text }) => {
  if (/FROM wf\.GiveawayItemMapping/.test(text)) return [{ Brand: 'รถเกษตร', ItemName: 'เสื้อยืดแขนยาว' }];
  if (/FROM wf\.v_GiveawayBudgetStatus\s+WHERE SalesUserId = @su AND PeriodYear = @y/.test(text)) {
    return [{ Region: 'ภาคกลาง', Brand: 'รถเกษตร', ItemName: 'เสื้อยืดแขนยาว', BudgetQty: 5000, WithdrawnQty: 5000 - state.remaining, RemainingQty: state.remaining }];
  }
  if (/JOIN wf\.SalesOrder s ON s\.Id = l\.SoId/.test(text)) return [];
  if (/INSERT INTO wf\.SalesOrder\s*\(/.test(text) && /OUTPUT/i.test(text)) return [{ Id: nextSoId++ }];
  if (/OUTPUT inserted\.Id/i.test(text)) return [{ Id: nextSoId++ }];
  return [];
});

let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so']]); });
test.after(async () => { await app.close(); });

const order = (pieces) => ({
  soPrefix: 'I', custId: '1141', custName: 'ร้านสุวรรณภัณฑ์', truckPlate: 'กพ70-1111', deliveryDate: '2026-10-07', creditDays: 30,
  lines: [{
    goodId: '28000', goodCode: 'P-1', goodName: 'เสื้อยืดแขนยาว ตรารถเกษตร',
    qtyTon: pieces, qtyBag: pieces * 20, pieceQty: pieces, masterQty: pieces, childQty: 0,
    pricePerTon: 0, netPricePerTon: 0, isGiveaway: true, giveawayApprovalStatus: 'PENDING',
  }],
});

test('U-7/U-8: saving a bill whose giveaway exceeds the quota is refused before any insert', async () => {
  state.remaining = 100;
  const before = db.calls.length;
  const r = await app.call('POST', '/api/so', { body: order(250), user: { sub: 34, role: 'SALES' } });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'GIVEAWAY_OVER_QUOTA');
  assert.equal(r.body.problems[0].requested, 250);
  assert.equal(db.calls.slice(before).filter(c => /INSERT INTO wf\.SalesOrder/.test(c.text)).length, 0);
});

test('U-5: a giveaway within quota is stored as pieces (QtyTon 0, MasterQty 0, QtyBag = pieces)', async () => {
  state.remaining = 300;
  const before = db.calls.length;
  await app.call('POST', '/api/so', { body: order(250), user: { sub: 34, role: 'SALES' } });
  const lineInsert = db.calls.slice(before).find(c => /INSERT INTO wf\.SalesOrderLine/.test(c.text));
  assert.ok(lineInsert, 'line inserted');
  assert.equal(Number(lineInsert.inputs.qtyTon), 0);
  assert.equal(Number(lineInsert.inputs.masterQty), 0);
  assert.equal(Number(lineInsert.inputs.qtyBag), 250, 'pieces, not pieces × BagPerTon');
  assert.equal(Number(lineInsert.inputs.isGiveaway), 1);
});

test('UAT SO-20: a rebate discount sent by SALES is ignored; ADMIN may set it (same roles as the bill editor)', async () => {
  state.remaining = 300;
  const withRebate = { ...order(10), rebateDiscountAmt: 500 };
  let before = db.calls.length;
  await app.call('POST', '/api/so', { body: withRebate, user: { sub: 34, role: 'SALES' } });
  const salesInsert = db.calls.slice(before).find(c => /INSERT INTO wf\.SalesOrder\s*\(/.test(c.text));
  assert.equal(Number(salesInsert.inputs.rebateDiscountAmt), 0);
  before = db.calls.length;
  await app.call('POST', '/api/so', { body: { ...withRebate, salesUserId: 34 }, user: { sub: 1, role: 'ADMIN' } });
  const adminInsert = db.calls.slice(before).find(c => /INSERT INTO wf\.SalesOrder\s*\(/.test(c.text));
  assert.equal(Number(adminInsert.inputs.rebateDiscountAmt), 500);
});
