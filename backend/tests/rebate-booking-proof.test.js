'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyBookingPricing } = require('../services/rebate-booking-proof');
const { fingerprintRebateDecision } = require('../services/rebate-price-authority');
const { calculateOrderPricingAndRebate } = require('../services/rebate-calculator-service');
const decision = { draftId: 23, lineNo: 1, revision: 3, goodId: 17, saleDate: '2026-04-02', quantity: '1.000',
  sellingPrice: '17750.00', isCashDiscount: false,
  source: { database: 'UAT', server: 'TEST\\SQL', setPriceId: 9, listNo: 1, goodId: 17, saleDate: '2026-04-02', beginDate: '2026-01-01', endDate: '2026-12-31', basePrice: '18000.00' },
  calculation: calculateOrderPricingAndRebate(18000,17750,1,false) };
decision.fingerprint = fingerprintRebateDecision(decision);
const line = { SOID: 52, DocuType: '103', SaleDate: '2026-04-02', ListNo: 1, GoodID: 17, GoodQty2: '1.000', GoodPrice2: '18000.00', DatabaseName: 'UAT', ServerName: 'TEST\\SQL' };
function fixture(rows) { const calls=[]; return { calls, query: async (sql,inputs) => { calls.push({sql,inputs}); return {recordset:rows}; } }; }
test('103 proof reads locked native rows and matches the exact price decision', async () => {
  const f = fixture([line]);
  assert.deepEqual(await verifyBookingPricing(f.query,{bookingId:52,decisions:[decision]}),{bookingId:52,matched:1});
  assert.match(f.calls[0].sql,/SOHD h WITH\(UPDLOCK,HOLDLOCK\)/);
  assert.match(f.calls[0].sql,/SODT d WITH\(UPDLOCK,HOLDLOCK\)/);
  assert.deepEqual(f.calls[0].inputs,{bookingId:52});
});
test('missing, duplicated or changed native source fails without accepting a proof', async () => {
  for (const rows of [[],[line,line],[line,{...line,ListNo:2}],[{...line,GoodID:18}],[{...line,GoodQty2:'1.001'}],
    [{...line,GoodPrice2:'17999.99'}],[{...line,SaleDate:'2026-04-03'}],
    [{...line,DatabaseName:'OTHER'}],[{...line,ServerName:'OTHER'}]]) {
    await assert.rejects(verifyBookingPricing(fixture(rows).query,{bookingId:52,decisions:[decision]}),{code:'REBATE_BOOKING_PROOF_MISMATCH'});
  }
  await assert.rejects(verifyBookingPricing(fixture([line]).query,{bookingId:52,decisions:[decision,decision]}),{code:'REBATE_BOOKING_PROOF_INVALID'});
  await assert.rejects(verifyBookingPricing(fixture([line]).query,{bookingId:52,decisions:[{...decision,quantity:'2.000'}]}),{code:'REBATE_BOOKING_PROOF_INVALID'});
  await assert.rejects(verifyBookingPricing(fixture([line]).query,{bookingId:52,decisions:[{...decision,calculation:{...decision.calculation,requiresManagerApproval:false}}]}),{code:'REBATE_BOOKING_PROOF_INVALID'});
});
