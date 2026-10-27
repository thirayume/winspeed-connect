'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');h.installDbStub(()=>[],{activeUserIds:[22,99]});
const service=require('../services/initial-invoice'),calls=[];
service.initialInvoice=async cmd=>{calls.push(cmd);if(cmd.soid==='error')throw Error('private password');return {completed:false,operation:cmd.operation};};
let app;test.before(async()=>{app=await h.startApp([['/api/so','../../routes/so']]);});test.after(async()=>{await app.close();});
test('107 route excludes every role except ACCOUNTING including Admin and Manager',async()=>{
 for(const role of ['SALES','COUNTER_SALES','WAREHOUSE','APPROVER','WEIGHBRIDGE','MANAGER','C_LEVEL','ADMIN']){
  const before=calls.length;
  for(const [method,path] of [['GET','/preview'],['POST','']])assert.equal((await app.call(method,'/api/so/501/native-invoice'+path,{user:{sub:22,role},...(method==='POST'?{body:{}}:{})})).status,403);
  assert.equal(calls.length,before);
 }
});
test('ACCOUNTING preserves actual actor and accepts only request/date fields',async()=>{
 const r=await app.call('POST','/api/so/501/native-invoice',{user:{sub:22,role:'ACCOUNTING',actorSub:99,actorRole:'ADMIN'},body:{requestId:'uuid',fingerprint:'fp',invoiceDate:'2026-10-25',nativeDocuNo:'FORGED',stockId:1,approvedBy:1}});
 assert.equal(r.status,200);assert.equal(calls.at(-1).user.actorSub,99);assert.equal(calls.at(-1).invoiceDate,'2026-10-25');
 for(const key of ['nativeDocuNo','stockId','approvedBy'])assert.equal(calls.at(-1)[key],undefined);
});
test('107 requires authentication and returns no private error details',async()=>{
 assert.equal((await app.call('GET','/api/so/501/native-invoice/preview')).status,401);
 const r=await app.call('GET','/api/so/error/native-invoice/preview',{user:{sub:22,role:'ACCOUNTING'}});assert.equal(r.status,503);assert.deepEqual(r.body,{code:'IP_FAILED',message:'IP_FAILED'});
});
