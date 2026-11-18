'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveResetBusinessIdentity}=require('../services/rebate-reset-business-identity');
const primaryTarget={name:'primary',database:'primary',expectedServerName:'SERVER1'};
const target={name:'secondary',database:'secondary',expectedServerName:'SERVER2'};
const args={actorId:1,effectiveId:2,primaryTarget,target,db:{}};
test('uses independently reviewed mappings for a secondary database',async()=>{
  const result=await resolveResetBusinessIdentity(args,{repository:{},resolve:async()=>({
    businessActorUserId:11,businessEffectiveUserId:12,identityServer:'SERVER1',businessServer:'SERVER2'})});
  assert.deepEqual(result,{businessActorId:11,businessEffectiveId:12});
  await assert.rejects(resolveResetBusinessIdentity(args,{repository:{},resolve:async()=>({
    businessActorUserId:11,businessEffectiveUserId:12,identityServer:'SERVER1',businessServer:'OTHER'})}),
    {code:'REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE'});
});
test('primary database uses its own active identities without guessing secondary IDs',async()=>{
  const repository={readUser:async(_db,id)=>({database:'primary',server:'SERVER1',user:{Id:id,IsActive:1}})};
  assert.deepEqual(await resolveResetBusinessIdentity({...args,target:primaryTarget},{repository}),{businessActorId:1,businessEffectiveId:2});
  repository.readUser=async(_db,id)=>({database:'primary',server:'SERVER1',user:{Id:id,IsActive:0}});
  await assert.rejects(resolveResetBusinessIdentity({...args,target:primaryTarget},{repository}),{code:'REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE'});
});
