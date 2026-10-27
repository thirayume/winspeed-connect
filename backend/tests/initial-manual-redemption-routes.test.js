'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');h.installDbStub(()=>[],{activeUserIds:[11,99]});
const service=require('../services/initial-manual-redemption'),calls=[];
service.initialManualRedemption=async cmd=>{calls.push(cmd);if(cmd.soid==='error')throw Error('private password');return {operation:cmd.operation,physicalShipmentVerified:false};};
let app;test.before(async()=>{app=await h.startApp([['/api/so','../../routes/so']]);});test.after(async()=>{await app.close();});
test('manual116 route boundary excludes Sales, counter, generic approver and scale roles',async()=>{
 for(const role of ['SALES','COUNTER_SALES','APPROVER','WEIGHBRIDGE']){
  const user={sub:11,role},before=calls.length;
  for(const [method,path] of [['GET','/preview'],['POST','/requests'],['POST','/requests/key/approve'],['POST','']])assert.equal((await app.call(method,'/api/so/501/native-redemption'+path,{user,...(method==='POST'?{body:{}}:{})})).status,403);
  assert.equal(calls.length,before);
 }
});
test('operational actors preserve actual/effective identities and cannot provide native IDs or approver IDs',async()=>{
 for(const role of ['WAREHOUSE','ACCOUNTING','MANAGER','C_LEVEL','ADMIN']){
  const user={sub:11,role,actorSub:99,actorRole:'ADMIN'};
  const r=await app.call('POST','/api/so/501/native-redemption/requests',{user,body:{requestId:'uuid',fingerprint:'fp',reason:'reason',receiver:'UAT2 TEST',plate:'UAT2-TEST',approvedBy:1,nativeDocuNo:'FORGED'}});
  assert.equal(r.status,200);assert.equal(calls.at(-1).soid,'501');assert.equal(calls.at(-1).user.actorSub,99);
  assert.equal(calls.at(-1).approvedBy,undefined);assert.equal(calls.at(-1).nativeDocuNo,undefined);
 }
});
test('unauthenticated requests and private errors do not leak diagnostics',async()=>{
 assert.equal((await app.call('POST','/api/so/501/native-redemption',{body:{}})).status,401);
 const r=await app.call('GET','/api/so/error/native-redemption/preview',{user:{sub:11,role:'WAREHOUSE'}});
 assert.equal(r.status,503);assert.deepEqual(r.body,{code:'MR_FAILED',message:'MR_FAILED'});
});
