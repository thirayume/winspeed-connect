'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const harness=require('./helpers/route-harness.cjs');
harness.installDbStub(()=>[],{activeUserIds:[11,99]});
const store=require('../services/database-connection-store');
const {defaults}=require('../services/database-connections');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'saleapp-profile-route-test-'));
Object.assign(process.env,{
  DB_MODE: '',
  ONPREM_DB_NAME:'dbwins_worldfert9_test',ONPREM_SWITCHABLE_DATABASES:'dbwins_worldfert2_test',
  ONPREM_DB_SERVER:'sql.example.test',ONPREM_DB_PORT:'1433',ONPREM_DB_USER:'test_app',
  ONPREM_EXPECTED_SERVERNAME:'SQL\\TEST',ONPREM_PRODUCT_VERSION_PREFIX:'10.50.',
  ONPREM_CONNECTION_STORE_FILE:path.join(dir,'profiles.enc'),ONPREM_CONNECTION_KEY_FILE:path.join(dir,'key.bin'),
});
store.initialize(process.env);
const base='/api/database-connections',name=process.env.ONPREM_DB_NAME;
const admin={sub:11,role:'ADMIN'},profile={...defaults(name,process.env),password:'ROUTE_TEST_SECRET_ONLY'};
let app;
test.before(async()=>{app=await harness.startApp([[base,'../../routes/database-connections']]);});
test.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});

test('requires authentication and actual ADMIN with system permission; Access As is denied',async()=>{
  assert.equal((await app.call('GET',base)).status,401);
  for(const user of [{sub:11,role:'SALES'},{sub:11,role:'ACCOUNTING'},{...admin,actorSub:99}]){
    for(const method of ['GET','PUT','POST']){
      const url=method==='GET'?base:base+'/'+name+(method==='POST'?'/test':'');
      assert.equal((await app.call(method,url,{user,body:method==='GET'?undefined:{profile,revision:0}})).status,403);
    }
  }
  assert.equal((await app.call('GET',base,{user:admin})).status,200);
  const guard=require('../routes/database-connections').managementGuard;
  let status;guard({user:{...admin,permissions:[]}}, {status(v){status=v;return this;},json(){}},()=>assert.fail('permission denied'));
  assert.equal(status,403);
});

test('save returns only revision; GET is sanitized and stale saves preserve current draft',async()=>{
  const result=await app.call('PUT',base+'/'+name,{user:admin,body:{profile,revision:0}});
  assert.equal(result.status,200);assert.deepEqual(result.body,{revision:1});
  const list=await app.call('GET',base,{user:admin});
  assert.equal(list.body.profiles[0].draft.passwordSet,true);
  assert.ok(!JSON.stringify(list.body).includes(profile.password));
  assert.equal((await app.call('PUT',base+'/'+name,{user:admin,body:{profile:{...profile,password:'wrong-stale'},revision:0}})).status,409);
  assert.equal(store.read(process.env).profiles[name].draft.password,profile.password);
});

test('web has no activation endpoint and cannot probe an unapproved server',async()=>{
  assert.equal((await app.call('POST',base+'/'+name+'/activate',{user:admin,body:{revision:1}})).status,404);
  const changed={...profile,server:'unapproved.example.test'};
  assert.equal((await app.call('PUT',base+'/'+name,{user:admin,body:{profile:changed,revision:1}})).status,200);
  const tested=await app.call('POST',base+'/'+name+'/test',{user:admin,body:{revision:2}});
  assert.equal(tested.status,403);assert.equal(tested.body.code,'CONNECTION_TARGET_NOT_APPROVED');
  assert.equal(store.read(process.env).profiles[name].active,undefined);
});
