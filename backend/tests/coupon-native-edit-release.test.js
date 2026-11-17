'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { releaseNativeEdit,resumeNativeEdit }=require('../services/coupon-native-edit-release');

const actor={sub:4,actorSub:9,role:'MANAGER',actorRole:'ADMIN',isImpersonating:true};
const input={actor,editId:'12345678-1234-1234-1234-123456789abc',reason:'ตรวจหลักฐานก่อนปล่อยยอด'};

function fixture({ visible=true, stale=false, failure }={}){
  const writes=[];
  const lines=[{CouponId:11,ReservationId:21},{CouponId:12,ReservationId:22}];
  let reads=0;
  const deps={
    currentActorId:()=>9,
    hasColumn:async()=>true,
    assertNativeHoldPrimary:async()=>{},
    assertBridge:async()=>{},
    couponVisible:async (_actor,id)=>visible||id!==12,
    reservationsVisible:async (_actor,ids)=>ids.length===2,
    wfTransaction:async execute=>{
      const tx={request(){
        const input={};
        return {input(name,_type,value){input[name]=value;return this;},async query(sql){
          if(sql.includes('AS Ready'))return {recordset:[{Ready:1}]};
          if(sql.includes('FROM wf.CouponNativeEditHold'))return {recordset:++reads===2&&stale?lines.slice(0,1):lines};
          if(sql.includes('FROM dbo.WFCoupon'))return {recordset:[{CouponID:input.cid}]};
          if(sql.includes('EXEC wf.sp_ReleaseCouponNativeEdit')||sql.includes('EXEC wf.sp_ResumeCouponNativeEdit')){
            if(failure)throw new Error(failure);
            writes.push(input);
          }
          return {recordset:[]};
        }};
      }};
      return execute(tx);
    },
  };
  return {deps,writes};
}

test('release executes only after locking and checking all lines in both user scopes',async()=>{
  const {deps,writes}=fixture();
  const result=await releaseNativeEdit(input,deps);
  assert.deepEqual(result,{editId:input.editId,released:true});
  assert.deepEqual(writes,[{editId:input.editId,effective:4,actor:9,reason:input.reason}]);
});

test('resume uses the scoped procedure and a changed native balance remains held', async () => {
  let {deps,writes}=fixture();
  assert.deepEqual(await resumeNativeEdit(input,deps),{editId:input.editId,resumed:true});
  assert.deepEqual(writes,[{editId:input.editId,effective:4,actor:9,reason:input.reason}]);
  ({deps,writes}=fixture({failure:'COUPON_EDIT_RESUME_BALANCE_CONFLICT'}));
  await assert.rejects(resumeNativeEdit(input,deps),{code:'COUPON_EDIT_RESUME_BALANCE_CONFLICT',status:409});
  assert.deepEqual(writes,[]);
});

test('release refuses mismatched scope, changed lines, and incomplete evidence',async()=>{
  for(const [options,code] of [
    [{visible:false},'COUPON_RECOVERY_RELEASE_NOT_FOUND'],
    [{stale:true},'COUPON_RECOVERY_RELEASE_SOURCE_CHANGED'],
    [{failure:'COUPON_RECOVERY_RELEASE_RECEIPT_INVALID'},'COUPON_RECOVERY_RELEASE_RECEIPT_INVALID'],
  ]){
    const {deps,writes}=fixture(options);
    await assert.rejects(releaseNativeEdit(input,deps),{code});
    assert.deepEqual(writes,[]);
  }
});
