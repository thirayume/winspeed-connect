'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
h.installDbStub(({text})=>{
 if(/FROM dbo.WFCoupon/.test(text))return [{CouponID:501,CouponNo:'C6900001',GoodID:1094,GoodQty:1,RemaQty:0,GoodUnitName:'ตัน'}];
 if(/FROM dbo.WFRedemtionDT rd/.test(text))return [{RedemtionID:701,Listno:1,CouponID:501,CouponNo:'C6900001',RedeemedQty:1,RedemptionRemaQty:1,SOInvID:null,SOListNo:null,RedemptionDocuNo:'69000001',RedemptionDate:'2026-10-25',RedemptionType:116,RedemptionStatus:'N',RedemptionUnitName:'ตัน'}];
 throw Error('Unexpected query '+text.slice(0,80));
});
const {resolveNativeDocumentChain}=require('../services/native-document-resolver');
test('redemption trace preserves the native cut unit instead of dropping it from the API',async()=>{
 const result=await resolveNativeDocumentChain({reference:'C6900001',exactId:501,entityType:'COUPON'});
 assert.equal(result.resolved,true);const line=result.chain.redemptions[0].lines[0];assert.equal(line.unitName,'ตัน');assert.equal(line.redeemedQtyTon,1);
});
