'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
h.installDbStub(()=>[],{activeUserIds:h.TEST_USERS});
const path=require.resolve('../services/rebate-reset-admin');require(path);
let fail=false,calls=[];
require.cache[path].exports={getResetStatus:async user=>{calls.push(['status',user.sub]);return {enabled:false};},
  executeReset:async(user,body)=>{calls.push(['execute',user.sub,body]);if(fail)throw Object.assign(Error('private diagnostic'),
    {code:'REBATE_RESET_RETRY',status:503,resetRequestId:body.requestId});return {complete:true,requestId:body.requestId};}};
let app;test.before(async()=>{app=await h.startApp([['/api/rebate-pool','../../routes/rebate-pool']]);});
test.after(async()=>{await app.close();});
test('only administrators may inspect or execute reset',async()=>{
  calls=[];
  for(const method of ['GET','POST']){
    const r=await app.call(method,'/api/rebate-pool/admin/reset',{
      user:{sub:1,role:'SALES'},...(method==='POST'?{body:{}}:{})});
    assert.equal(r.status,403);
  }
  assert.equal(calls.length,0);
  const r=await app.call('GET','/api/rebate-pool/admin/reset',{user:{sub:2,role:'ADMIN'}});
  assert.equal(r.status,200);assert.equal(r.body.enabled,false);
});
test('failed reset returns the retry ID without internal diagnostics',async()=>{
  fail=true;try{
    const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const r=await app.call('POST','/api/rebate-pool/admin/reset',{user:{sub:2,role:'ADMIN'},body:{requestId:id}});
    assert.equal(r.status,503);assert.equal(r.body.requestId,id);assert.equal(r.body.code,'REBATE_RESET_RETRY');
    assert.ok(!JSON.stringify(r.body).includes('private diagnostic'));
  }finally{fail=false;}
});
