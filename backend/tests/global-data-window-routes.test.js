'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const harness=require('./helpers/route-harness.cjs');
const {stub:db}=harness.installDbStub(()=>[],{activeUserIds:[1,2]});
const servicePath=require.resolve('../services/global-data-window-store');
let calls=0;
require.cache[servicePath]={id:servicePath,filename:servicePath,loaded:true,exports:{
  readGlobalDataWindow:async()=>({businessDate:'2026-01-01'}),
  saveGlobalDataWindow:async({value,expectedValue,actorId})=>{
    calls++;
    if(expectedValue!=='2026-01-01')throw Object.assign(Error('stale'),{code:'STALE_DATA_WINDOW',status:409});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))throw Object.assign(Error('invalid'),{code:'INVALID_DATA_WINDOW',status:400});
    assert.equal(actorId,1);return {value,changed:true};
  }
}};
let app; const base='/api/master/global-data-window',admin={sub:1,role:'ADMIN'};
test.before(async()=>{app=await harness.startApp([['/api/master','../../routes/master']]);});
test.after(async()=>{await app.close();});
test('requires authenticated permission and forbids acting as another user',async()=>{
  assert.equal((await app.call('GET',base)).status,401);
  assert.equal((await app.call('GET',base,{user:{sub:2,role:'SALES'}})).status,403);
  assert.equal((await app.call('PUT',base,{user:{...admin,actorSub:2},body:{startDate:'2026-01-01',expectedStartDate:'2026-01-01'}})).status,403);
  assert.equal(calls,0);
});
test('GET and update return only validated public values and stale updates fail',async()=>{
  assert.equal((await app.call('GET',base,{user:admin})).body.startDate,'2026-01-01');
  assert.equal((await app.call('PUT',base,{user:admin,body:{startDate:'2026-02-01',expectedStartDate:'2026-01-01'}})).status,200);
  assert.equal((await app.call('PUT',base,{user:admin,body:{startDate:'2026-02-01',expectedStartDate:'2025-01-01'}})).status,409);
  assert.equal((await app.call('PUT',base,{user:admin,body:{startDate:'invalid',expectedStartDate:'2026-01-01'}})).status,400);
});
test('a switched session must return to primary before changing the global policy',async()=>{
  const before={target:db.DEFAULT_TARGET,getDbName:db.getDbName,name:process.env.ONPREM_DB_NAME};
  try {
    db.DEFAULT_TARGET='onprem';db.getDbName=()=> 'dbwins_worldfert2';process.env.ONPREM_DB_NAME='dbwins_worldfert9_uat';
    const result=await app.call('PUT',base,{user:admin,body:{startDate:'2026-02-01',expectedStartDate:'2026-01-01'}});
    assert.equal(result.status,409);assert.match(result.body.message,/ฐานหลัก/);
  } finally {
    db.DEFAULT_TARGET=before.target;db.getDbName=before.getDbName;
    if(before.name===undefined)delete process.env.ONPREM_DB_NAME;else process.env.ONPREM_DB_NAME=before.name;
  }
});
