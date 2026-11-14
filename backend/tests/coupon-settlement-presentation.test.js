'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
const db=h.installDbStub(()=>[]);
const {presentSettlement}=require('../services/coupon-settlement-presentation');
const window=require('../services/data-window').boundaries('2026-01-01');
const result={settledCount:2,processedCoupons:1,
  settlements:[{reservationId:11,redemptionId:1,redemptionDocuNo:'OLD',matchedQty:1,carrierDocuNo:'SECRET'},
    {reservationId:12,redemptionId:2,redemptionDocuNo:'CURRENT',matchedQty:2,carrierDocuNo:'SECRET'}],
  ambiguous:[{redemptionId:3,redemptionDocuNo:'UNKNOWN',reason:'AMBIGUOUS'}],
  unmatched:[{redemptionId:2,docuNo:'CURRENT',docuDate:'2026-01-01',goodQty:1,reason:'NO_CANDIDATE',
    candidateReservations:[{id:12,carrierSoId:'10',carrierDocuNo:'OLD-SOURCE',confirmDate:'2025-01-01',plate:'secret',reservedQty:2,remainingReservedQty:1}]}]};
test('settlement response hides old or undated cuts while preserving full accounting counts',async()=>{
  let query;
  const output=await presentSettlement(result,window,async(text,inputs)=>{query={text,inputs};return {recordset:[{RedemtionID:2}]};});
  assert.equal(output.settledCount,2);assert.equal(output.settlements.length,1);assert.equal(output.settlements[0].redemptionDocuNo,'CURRENT');
  assert.equal(output.ambiguous.length,0);assert.equal(output.unmatched.length,1);
  assert.deepEqual(output.unmatched[0].candidateReservations,[{id:12,reservedQty:2,remainingReservedQty:1}]);
  assert.doesNotMatch(JSON.stringify(output),/OLD-SOURCE|SECRET|UNKNOWN/);
  assert.match(query.text,/DocuDate>=@start/);assert.equal(query.inputs.start.value,'2026-01-01');
});
test('SQL failure omits all document details but reports previously committed counts',async()=>{
  const output=await presentSettlement(result,window,async()=>{throw Error('DB_DOWN');});
  assert.equal(output.settledCount,2);assert.deepEqual(output.settlements,[]);assert.deepEqual(output.unmatched,[]);assert.ok(output.note);
  assert.doesNotMatch(JSON.stringify(output),/CURRENT|OLD|SECRET|UNKNOWN/);
});
