'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./helpers/route-harness.cjs').installDbStub(()=>[]);
const {validateAndLockCouponReservations}=require('../services/coupon-service');
function setup({grant=true,sourceOwner='123',owner='123'}={}){
  const calls=[];
  const row={Id:12,CouponId:42,CouponNo:'C-TEST',GoodId:3,ReservedQty:1,Status:'RESERVED',BeneficiaryCustId:'456',OwnerCustId:owner,CreatedBy:8};
  const tx={request(){return {input(){return this;},async query(text){calls.push(text);
    if(text.includes('FROM wf.CouponReservation WITH'))return {recordset:[row]};
    if(text.includes('FROM dbo.WFCoupon c WITH (HOLDLOCK)'))return {recordset:[{OwnerCustId:sourceOwner,GoodID:3}]};
    if(text.includes('FROM wf.CouponBeneficiary WITH'))return {recordset:grant?[{Id:5}]:[]};
    throw Error('UNEXPECTED_QUERY');
  }}}};
  return {tx,calls,line:{couponReservationId:12,goodId:3,qtyTon:1,pricePerTon:100}};
}
test('bill bind accepts only a current grant matching actual ticket owner and product',async()=>{
  const f=setup();const result=await validateAndLockCouponReservations(f.tx,[f.line],'456');
  assert.equal(result.has(0),true);assert.equal(f.line.pricePerTon,0);
  assert.ok(f.calls.some(s=>s.includes('FROM wf.CouponBeneficiary WITH (UPDLOCK, ROWLOCK)')));
});
test('bill bind rejects a revoked grant, changed source owner, or missing owner before price mutation',async()=>{
  for(const opts of [{grant:false},{sourceOwner:'789'},{owner:null}]){
    const f=setup(opts);await assert.rejects(validateAndLockCouponReservations(f.tx,[f.line],'456'),e=>e.status===409);
    assert.equal(f.line.pricePerTon,100);assert.equal(f.line._couponReservationValidated,undefined);
  }
});
