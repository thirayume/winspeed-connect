'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {approvalIdentity,bothHaveRole,isSubmitter,bothQualifyForRegion}=require('../services/approval-identity');

test('multiple assigned roles are a union for the actual user',()=>{
  const u=approvalIdentity({sub:8,role:'SALES',roles:['SALES','C_LEVEL']});
  assert.equal(bothHaveRole(u,['C_LEVEL','ADMIN']),true);
  assert.equal(bothHaveRole(u,['ACCOUNTING']),false);
  assert.equal(u.actorId,8);assert.equal(u.effectiveId,8);
});
test('Access As requires both identities to satisfy the allowed-role set',()=>{
  const user=approvalIdentity({sub:8,actorSub:17,isImpersonating:true,role:'SALES',roles:['SALES','C_LEVEL'],actorRoles:['MANAGER']});
  assert.equal(bothHaveRole(user,['C_LEVEL','ADMIN']),false);
  assert.equal(bothHaveRole(user,['MANAGER','C_LEVEL']),true);
  assert.equal(user.actorId,17);assert.equal(user.effectiveId,8);
  assert.equal(bothHaveRole(approvalIdentity({...user,sub:8,actorSub:17,isImpersonating:true,roles:['C_LEVEL'],actorRoles:undefined}),['C_LEVEL']),false);
});
test('self-action checks both actual and effective identity and fails closed without IDs',()=>{
  const u=approvalIdentity({sub:8,actorSub:17,roles:['C_LEVEL'],actorRoles:['C_LEVEL']});
  assert.equal(isSubmitter(u,8),true);assert.equal(isSubmitter(u,17),true);assert.equal(isSubmitter(u,9),false);
  assert.throws(()=>approvalIdentity({role:'ADMIN'}),{code:'INVALID_APPROVAL_IDENTITY'});
});

test('regional authorization checks both identities independently', async()=>{
  const u=approvalIdentity({sub:8,actorSub:17,roles:['C_LEVEL'],actorRoles:['MANAGER']});
  const calls=[];
  const lookup=async id=>{ calls.push(id); return id===17; };
  assert.equal(await bothQualifyForRegion(u,['ADMIN','C_LEVEL'],lookup),true);
  assert.deepEqual(calls,[17]);
  assert.equal(await bothQualifyForRegion(u,['ADMIN','C_LEVEL'],async()=>false),false);
  const direct=approvalIdentity({sub:8,roles:['MANAGER']});
  const seen=[];
  assert.equal(await bothQualifyForRegion(direct,['ADMIN'],async id=>{seen.push(id);return true;}),true);
  assert.deepEqual(seen,[8]);
});
