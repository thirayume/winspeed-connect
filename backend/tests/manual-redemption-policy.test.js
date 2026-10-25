'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mayCreate,decision}=require('../services/manual-redemption-policy');
test('only Warehouse and Account create manual exceptions',()=>{
 for(const role of ['WAREHOUSE','ACCOUNTING'])assert.equal(mayCreate(role),true);
 for(const role of ['SALES','COUNTER_SALES','WEIGHBRIDGE','MANAGER','C_LEVEL','ADMIN',null])assert.equal(mayCreate(role),false);
});
test('Warehouse and Account self-approve only as the same actual person',()=>{
 for(const role of ['WAREHOUSE','ACCOUNTING']){
  assert.deepEqual(decision({role,actorId:69,requesterActorId:69}),{allowed:true,selfApproval:true});
  assert.deepEqual(decision({role,actorId:70,requesterActorId:69}),{allowed:false,selfApproval:false});
 }
});
test('manager roles approve another person and their own authorized request',()=>{
 for(const role of ['MANAGER','C_LEVEL','ADMIN']){
  assert.equal(decision({role,actorId:71,requesterActorId:69}).allowed,true);
  assert.deepEqual(decision({role,actorId:71,requesterActorId:71}),{allowed:true,selfApproval:true});
 }
});
test('matching actual IDs alone never grants Sales or scale roles approval',()=>{
 for(const role of ['SALES','COUNTER_SALES','APPROVER','WEIGHBRIDGE',null])assert.equal(decision({role,actorId:67,requesterActorId:67}).allowed,false);
 for(const actorId of [null,undefined,0,NaN,'69'])assert.equal(decision({role:'WAREHOUSE',actorId,requesterActorId:actorId}).allowed,false);
});
test('Access As uses actual actor equality, not effective user equality',()=>{
 assert.equal(decision({role:'WAREHOUSE',actorId:71,requesterActorId:71}).allowed,true);
 assert.equal(decision({role:'WAREHOUSE',actorId:70,requesterActorId:69}).allowed,false);
});
