'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateSettlementSnapshot,fingerprint}=require('../services/coupon-settlement-fence');
function fixture({lock=0,rows=[{Id:1,Qty:2}],policy='x'}={}){
  const calls=[];
  const tx={request(){const inputs={};return {input(k,t,v){inputs[k]=v;return this;},async query(text){calls.push({text,inputs});
    if(text.includes('sp_getapplock'))return {recordset:[{LockResult:lock}]};
    return {recordset:rows};
  }};}};
  return {tx,calls,expected:{couponId:4,snapshots:[{text:'SELECT Id,Qty FROM wf.CouponReservation WITH (NOLOCK) WHERE CouponId=@cid',inputs:{cid:{type:'int',value:4}},rows:[{Qty:2,Id:1}]}],policy:{mode:'x'},readPolicy:async()=>({mode:policy})}};
}
test('uses database transaction lock and locked reread before accepting same snapshot',async()=>{
  const f=fixture();await validateSettlementSnapshot(f.tx,f.expected);assert.equal(f.calls[0].inputs.resource,'WF_COUPON_SETTLE_4');assert.match(f.calls[0].text,/@LockOwner='Transaction'/);assert.match(f.calls[1].text,/WITH \(HOLDLOCK\)/);assert.equal(f.calls[1].inputs.cid,4);
  assert.equal(fingerprint([{a:1},{a:2}]),fingerprint([{a:2},{a:1}]));
});
test('changed reservation, changed policy and lock failure fail closed',async()=>{
  for(const opts of [{rows:[{Id:1,Qty:3}]},{policy:'changed'},{lock:-1},{lock:'invalid'}]){
    const f=fixture(opts);await assert.rejects(validateSettlementSnapshot(f.tx,f.expected),e=>['COUPON_SETTLEMENT_STALE','COUPON_SETTLEMENT_BUSY'].includes(e.code));
  }
});
