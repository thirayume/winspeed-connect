'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');h.installDbStub(()=>[],{activeUserIds:[11,99]});
const calls=[];const service=require('../services/initial-delivery');
service.initialDelivery=async command=>{calls.push(command);if(command.soid==='error')throw new Error('private password');return {operation:command.operation,shipmentReady:false};};
let app;test.before(async()=>{app=await h.startApp([['/api/so','../../routes/so']]);});test.after(async()=>{await app.close();});
test('credit list and approve routes admit only ACCOUNTING; AI permission gives no credit permission',async()=>{
 for(const role of ['SALES','COUNTER_SALES','MANAGER','C_LEVEL','ADMIN','WAREHOUSE','APPROVER']){
  const before=calls.length,user={sub:11,role};
  assert.equal((await app.call('GET','/api/so/native-delivery/requests',{user})).status,403);
  assert.equal((await app.call('POST','/api/so/501/native-delivery/requests/key/approve',{user,body:{}})).status,403);assert.equal(calls.length,before);
 }
 const user={sub:11,role:'ACCOUNTING',actorSub:99,actorRole:'ADMIN'};
 assert.equal((await app.call('GET','/api/so/native-delivery/requests',{user})).status,200);assert.equal(calls.at(-1).operation,'list');
 assert.equal((await app.call('POST','/api/so/501/native-delivery/requests/key/approve',{user,body:{fingerprint:'fp',reason:'credit reason'}})).status,200);
 assert.equal(calls.at(-1).requestId,'key');assert.equal(calls.at(-1).user.actorSub,99);
});
test('request and apply route keep typed SOID, fingerprint and UUID; warehouse cannot create104',async()=>{
 for(const role of ['SALES','COUNTER_SALES','ACCOUNTING','MANAGER','C_LEVEL','ADMIN']){
  const user={sub:11,role};assert.equal((await app.call('GET','/api/so/501/native-delivery/preview',{user})).status,200);
  assert.equal((await app.call('POST','/api/so/501/native-delivery/requests',{user,body:{requestId:'uuid',fingerprint:'fp'}})).status,200);
  assert.equal(calls.at(-1).operation,'request');assert.equal(calls.at(-1).soid,'501');assert.equal(calls.at(-1).requestId,'uuid');
  assert.equal((await app.call('POST','/api/so/501/native-delivery',{user,body:{requestId:'uuid',fingerprint:'fp'}})).status,200);
 }
 for(const role of ['WAREHOUSE','WEIGHBRIDGE','APPROVER']){const before=calls.length;assert.equal((await app.call('POST','/api/so/501/native-delivery',{user:{sub:11,role},body:{}})).status,403);assert.equal(calls.length,before);}
});
test('authentication and public SQL error sanitization remain enforced',async()=>{
 const before=calls.length;assert.equal((await app.call('POST','/api/so/501/native-delivery',{body:{}})).status,401);assert.equal(calls.length,before);
 const r=await app.call('GET','/api/so/error/native-delivery/preview',{user:{sub:11,role:'SALES'}});
 assert.equal(r.status,503);assert.equal(r.body.code,'DO_FAILED');assert.ok(!JSON.stringify(r.body).includes('password'));
});
