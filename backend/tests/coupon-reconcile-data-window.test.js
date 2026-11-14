'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
const reservations=[
  {Id:1,CouponId:42,CarrierSoId:'111',CarrierDocuNo:'OLD-SO',CarrierWithinWindow:0,ReservedQty:2,ConsumedQty:0,RemainingReservedQty:2,TripPlate:'OLD',ConfirmDate:'2025-12-01',CreatedAt:'2025-12-01'},
  {Id:2,CouponId:42,CarrierSoId:'222',CarrierDocuNo:'NEW-SO',CarrierWithinWindow:1,ReservedQty:3,ConsumedQty:0,RemainingReservedQty:3,TripPlate:'NEW',ConfirmDate:'2026-01-01',CreatedAt:'2026-01-01'},
  {Id:3,CouponId:42,CarrierSoId:'333',CarrierDocuNo:'UNKNOWN-SO',CarrierWithinWindow:0,ReservedQty:4,ConsumedQty:0,RemainingReservedQty:4,TripPlate:'UNKNOWN',ConfirmDate:'2025-01-01',CreatedAt:'2025-01-01'},
];
const cuts=[
  {RedemtionID:101,CouponID:42,GoodQty:2,DocuNo:'OLD-CUT',DocuDate:'2025-12-31',CarLicense:'OLD',CutWithinWindow:0},
  {RedemtionID:102,CouponID:42,GoodQty:3,DocuNo:'NEW-CUT',DocuDate:'2026-01-01',CarLicense:'NEW',CutWithinWindow:1},
  {RedemtionID:103,CouponID:42,GoodQty:4,DocuNo:'UNKNOWN-CUT',DocuDate:null,CarLicense:'UNKNOWN',CutWithinWindow:0},
];
const db=h.installDbStub(({text})=>{
  if(text.includes('COL_LENGTH'))return [{hasConsumedQty:1,hasTable:1}];
  if(text.includes('FROM dbo.WFCoupon WITH'))return [{CouponID:42,CouponNo:'C-OPEN',NativeRemaQty:12}];
  if(text.includes('FROM wf.CouponReservation cr'))return structuredClone(reservations);
  if(text.includes('FROM dbo.WFRedemtionDT rd'))return structuredClone(cuts);
  return [];
});
const service=require('../services/coupon-service');
test('reconcile preserves all balance arithmetic but hides old or undated documents',async()=>{
  const result=await service.reconcileCoupon(42,{settle:false,settlementPolicy:{}});
  assert.equal(result.nativeRemaQty,12);assert.equal(result.activeReservedQty,9);
  assert.equal(result.doubleCountedQty,9);assert.equal(result.adjustedAvailableQty,12);
  assert.equal(result.doubleCountedReservations.length,3);
  const byId=new Map(result.doubleCountedReservations.map(row=>[String(row.reservationId),row]));
  const old=byId.get('1'),current=byId.get('2'),unknown=byId.get('3');
  for(const row of [old,unknown]){assert.equal(row.carrierSoId,null);assert.equal(row.carrierDocuNo,null);assert.equal(row.matchingRedemptionId,null);assert.equal(row.matchingRedemptionDocuNo,null);assert.equal(row.carrierDocumentHidden,true);assert.equal(row.redemptionDocumentHidden,true);}
  assert.equal(current.carrierDocuNo,'NEW-SO');assert.equal(current.matchingRedemptionDocuNo,'NEW-CUT');
  const reservationQuery=db.calls.find(c=>c.text.includes('AS CarrierWithinWindow'));
  const cutQuery=db.calls.find(c=>c.text.includes('AS CutWithinWindow'));
  assert.equal(reservationQuery.inputs.globalStartDate,'2026-01-01');
  assert.equal(reservationQuery.inputs.globalStartUtc.toISOString(),'2025-12-31T17:00:00.000Z');
  assert.equal(cutQuery.inputs.globalStartDate,'2026-01-01');
});
test('unavailable authoritative cutoff fails before queries and before auto settlement',async()=>{
  const store=require('../services/global-data-window-store'),original=store.readGlobalDataWindow,before=db.calls.length;
  store.readGlobalDataWindow=async()=>{throw Error('WINDOW_UNAVAILABLE');};
  try{await assert.rejects(service.reconcileCoupon(42),/WINDOW_UNAVAILABLE/);assert.equal(db.calls.length,before);}finally{store.readGlobalDataWindow=original;}
});
test('ambiguous old cuts hide identifying detail and current cuts omit old carrier candidates',async()=>{
  const savedReservations=reservations.splice(0),savedCuts=cuts.splice(0);
  reservations.push(
    {Id:11,CouponId:42,CarrierWithinWindow:0,ReservedQty:2,RemainingReservedQty:2,TripPlate:'A',ConfirmDate:'2025-01-01',CreatedAt:'2025-01-01'},
    {Id:12,CouponId:42,CarrierWithinWindow:1,ReservedQty:2,RemainingReservedQty:2,TripPlate:'A',ConfirmDate:'2025-01-01',CreatedAt:'2025-01-01'}
  );
  try {
    cuts.push({RedemtionID:901,CouponID:42,GoodQty:5,DocuNo:'OLD-AMBIGUOUS',DocuDate:'2025-12-31',CarLicense:'A',CutWithinWindow:0});
    let result=await service.reconcileCoupon(42,{settle:false,settlementPolicy:{}});
    assert.deepEqual(result.ambiguousCuts,[{cutQty:5,reason:'MULTIPLE_CANDIDATE_RESERVATIONS',sourceDocumentHidden:true}]);
    cuts[0]={...cuts[0],RedemtionID:902,DocuNo:'NEW-AMBIGUOUS',DocuDate:'2026-01-01',CutWithinWindow:1};
    result=await service.reconcileCoupon(42,{settle:false,settlementPolicy:{}});
    assert.equal(result.ambiguousCuts[0].redemptionDocuNo,'NEW-AMBIGUOUS');
    assert.deepEqual(result.ambiguousCuts[0].candidateReservationIds,['12']);
    assert.equal(result.ambiguousCuts[0].carrierDocumentsHidden,true);
  } finally {reservations.splice(0,reservations.length,...savedReservations);cuts.splice(0,cuts.length,...savedCuts);}
});
