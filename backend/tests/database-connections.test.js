'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const store = require('../services/database-connection-store');
const { createService, defaults, approved } = require('../services/database-connections');
const { onpremTuple, onpremConnectionConfig } = require('../onprem-target');
const PRIMARY = 'dbwins_worldfert9_test', SECOND = 'dbwins_worldfert2_test';
const secret = "  ทดสอบ$&'\\}x  ";

function fixture(t, probe = async () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saleapp-connection-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = {
    ONPREM_DB_SERVER:'sql.example.test', ONPREM_DB_PORT:'1433', ONPREM_DB_NAME:PRIMARY,
    ONPREM_DB_USER:'wf_app_test', ONPREM_DB_PASSWORD:'baseline-test-only',
    ONPREM_MIGRATOR_USER:'wf_migrator_test', ONPREM_MIGRATOR_PASSWORD:'migration-test-only',
    ONPREM_EXPECTED_SERVERNAME:'TEST-SQL\\TEST', ONPREM_PRODUCT_VERSION_PREFIX:'10.50.',
    ONPREM_SWITCHABLE_DATABASES:SECOND,
    ONPREM_CONNECTION_STORE_FILE:path.join(dir,'connections.enc'),
    ONPREM_CONNECTION_KEY_FILE:path.join(dir,'key.bin'),
  };
  store.initialize(env);
  return { env, service:createService(env,probe), profile:{...defaults(PRIMARY,env),password:secret} };
}

test('credentials are encrypted on disk and never included in list/audit output', async t => {
  const {env,service,profile}=fixture(t);
  await service.save(PRIMARY,profile,0,'admin-test');
  assert.equal(store.read(env).profiles[PRIMARY].draft.password,secret);
  assert.ok(!fs.readFileSync(env.ONPREM_CONNECTION_STORE_FILE,'utf8').includes(secret));
  const result=service.list();
  assert.equal(result.profiles[0].draft.passwordSet,true);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!Object.hasOwn(result.profiles[0].draft,'password'));
  assert.deepEqual(Object.keys(result.audit[0]).sort(),['action','actor','at','name','revision']);
});

test('draft edits and successful test do not activate or replace a running connection', async t => {
  const {env,service,profile}=fixture(t);
  const before=onpremTuple(env);
  await service.save(PRIMARY,profile,0,'admin');
  await service.test(PRIMARY,1,'admin');
  assert.equal(store.read(env).profiles[PRIMARY].active,undefined);
  assert.deepEqual(onpremTuple(env),before);
  await service.activate(PRIMARY,1,'IT');
  assert.deepEqual(onpremTuple(env),before,'old process keeps its snapshot, including pools created later');
  const script="const t=require('./onprem-target').onpremTuple(process.env);process.stdout.write(JSON.stringify({login:t.login,passwordMatches:t.password===process.env.TEST_EXPECTED}));";
  const restarted=spawnSync(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'..'),env:{...process.env,...env,TEST_EXPECTED:secret},encoding:'utf8'});
  assert.equal(restarted.status,0,restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout),{login:profile.username,passwordMatches:true});
});

test('blank password retains saved value and a new draft requires a password', async t => {
  const {env,service,profile}=fixture(t);
  await assert.rejects(service.save(PRIMARY,{...profile,password:''},0,'a'),{code:'CONNECTION_PASSWORD_REQUIRED'});
  await service.save(PRIMARY,profile,0,'a');
  await service.save(PRIMARY,{...profile,password:''},1,'a');
  assert.equal(store.read(env).profiles[PRIMARY].draft.password,secret);
});

test('stale revisions and differently cased names cannot fork or overwrite a profile', async t => {
  const {env,service,profile}=fixture(t);
  await service.save(PRIMARY.toUpperCase(),profile,0,'a');
  await assert.rejects(service.save(PRIMARY,profile,0,'b'),{code:'CONNECTION_STALE'});
  assert.deepEqual(Object.keys(store.read(env).profiles),[PRIMARY]);
  await assert.rejects(service.save(' '+PRIMARY,profile,1,'a'),{code:'CONNECTION_DATABASE_NOT_ALLOWED'});
});

test('changing a draft during its network test invalidates that test result', async t => {
  let release; const pending=new Promise(resolve=>{release=resolve;});
  const {env,service,profile}=fixture(t,()=>pending);
  await service.save(PRIMARY,profile,0,'a');
  const testing=service.test(PRIMARY,1,'a');
  await service.save(PRIMARY,{...profile,username:'other_app'},1,'b');
  release();
  await assert.rejects(testing,{code:'CONNECTION_STALE'});
  assert.equal(store.read(env).profiles[PRIMARY].tested,null);
});

test('activation requires a fresh test and re-probes before changing active state', async t => {
  let fail=false,calls=0;
  const {env,service,profile}=fixture(t,async()=>{calls++;if(fail)throw Error('test failure');});
  await service.save(PRIMARY,profile,0,'a');
  await assert.rejects(service.activate(PRIMARY,1,'IT'),{code:'CONNECTION_TEST_REQUIRED'});
  await service.test(PRIMARY,1,'a'); fail=true;
  await assert.rejects(service.activate(PRIMARY,1,'IT'),/test failure/);
  assert.equal(calls,2);assert.equal(store.read(env).profiles[PRIMARY].active,undefined);
  fail=false;
  await store.mutate(env,s=>{s.profiles[PRIMARY].tested.at='invalid-date';});
  await assert.rejects(service.activate(PRIMARY,1,'IT'),{code:'CONNECTION_TEST_REQUIRED'});
  await store.mutate(env,s=>{s.profiles[PRIMARY].tested.at=new Date(Date.now()-31*60000).toISOString();});
  await assert.rejects(service.activate(PRIMARY,1,'IT'),{code:'CONNECTION_TEST_REQUIRED'});
});

test('unapproved endpoint, database and TLS changes never reach the probe', async t => {
  let calls=0; const {service,profile}=fixture(t,async()=>{calls++;});
  let revision=0;
  for(const patch of [{server:'other.example.test'},{port:1434},{database:'dbwins_worldfert9'},{encrypt:false},{legacyTls:true}]){
    await service.save(PRIMARY,{...profile,...patch},revision++,'a');
    await assert.rejects(service.test(PRIMARY,revision,'a'),e=>['CONNECTION_DATABASE_NOT_ALLOWED','CONNECTION_TARGET_NOT_APPROVED'].includes(e.code));
  }
  assert.equal(calls,0);
});

test('separate target uses its own host, port and login while migration stays pinned', async t => {
  const {env,service}=fixture(t);
  const profile={...defaults(SECOND,env),server:'sql2.example.test',port:51433,username:'wf_second',password:secret,expectedServerName:'SECOND\\SQL'};
  env.ONPREM_PROFILE_ALLOWED_TARGETS=JSON.stringify([{name:SECOND,...profile,password:undefined,username:undefined}]);
  await service.save(SECOND,profile,0,'a');await service.test(SECOND,1,'a');await service.activate(SECOND,1,'IT');
  const cfg=onpremConnectionConfig(env,'runtime',false,SECOND);
  assert.equal(cfg.server,profile.server);assert.equal(cfg.port,51433);assert.equal(cfg.user,'wf_second');assert.equal(cfg.password,secret);
  const migration=onpremTuple(env,'migration',SECOND);
  assert.equal(migration.database,PRIMARY);assert.equal(migration.server,env.ONPREM_DB_SERVER);assert.equal(migration.login,'wf_migrator_test');
  assert.equal(env.ONPREM_DB_USER,'wf_app_test');
});

test('primary can be tested ahead of maintenance but requires matching deployment pins to activate', async t => {
  const {env,service,profile}=fixture(t);
  const next={...profile,server:'new-primary.example.test',expectedServerName:'NEW\\SQL'};
  env.ONPREM_PROFILE_ALLOWED_TARGETS=JSON.stringify([{name:PRIMARY,...next,password:undefined}]);
  await service.save(PRIMARY,next,0,'a');await service.test(PRIMARY,1,'a');
  await assert.rejects(service.activate(PRIMARY,1,'IT'),{code:'CONNECTION_PRIMARY_REQUIRES_DEPLOY_CONFIG'});
  env.ONPREM_DB_SERVER=next.server;env.ONPREM_EXPECTED_SERVERNAME=next.expectedServerName;
  await service.activate(PRIMARY,1,'IT');
  assert.equal(store.read(env).profiles[PRIMARY].active.revision,1);
});

test('rollback re-tests previous target and activation edits do not discard previous revision', async t => {
  const {env,service,profile}=fixture(t);
  await service.save(PRIMARY,profile,0,'a');await service.test(PRIMARY,1,'a');await service.activate(PRIMARY,1,'IT');
  await service.save(PRIMARY,{...profile,password:'second-test-password'},1,'a');
  await service.test(PRIMARY,2,'a');await service.activate(PRIMARY,2,'IT');await service.rollback(PRIMARY,'IT');
  assert.equal(store.read(env).profiles[PRIMARY].active.value.password,secret);
  await service.rollback(PRIMARY,'IT');
  assert.equal(store.read(env).profiles[PRIMARY].active,null);
});

test('repeated activation is idempotent and preserves the rollback revision', async t => {
  const {env,service,profile}=fixture(t);
  for(const revision of [1,2]){
    await service.save(PRIMARY,{...profile,password:'test-revision-'+revision},revision-1,'a');
    await service.test(PRIMARY,revision,'a');await service.activate(PRIMARY,revision,'IT');
  }
  assert.equal((await service.activate(PRIMARY,2,'IT')).alreadyActivated,true);
  assert.equal(store.read(env).profiles[PRIMARY].previous.revision,1);
});

test('partially configured store never silently falls back to deployment credentials', t => {
  const {env}=fixture(t);
  assert.throws(()=>store.activeProfiles({...env,ONPREM_CONNECTION_KEY_FILE:''}),{code:'CONNECTION_STORE_INVALID'});
});

test('logical alias cannot bypass a physical database restriction, including Access As actor', async t => {
  const {env,service}=fixture(t);
  const profile={...defaults(SECOND,env),database:PRIMARY,password:secret};
  env.ONPREM_PROFILE_ALLOWED_TARGETS=JSON.stringify([{name:SECOND,...profile,password:undefined}]);
  await service.save(SECOND,profile,0,'a');await service.test(SECOND,1,'a');await service.activate(SECOND,1,'IT');
  const {canAccessDatabase}=require('../services/active-database');
  const themes={[PRIMARY]:{restrictedRoles:['ACCOUNTING']},[SECOND]:{restrictedRoles:[]}};
  assert.equal(canAccessDatabase(SECOND,{role:'SALES'},themes,env),false);
  assert.equal(canAccessDatabase(SECOND,{role:'ACCOUNTING'},themes,env),true);
  assert.equal(canAccessDatabase(SECOND,{role:'ACCOUNTING',isImpersonating:true,actorRoles:['SALES']},themes,env),false);
});

test('actual probe runs only identity/schema reads, closes pools, and redacts driver errors', async t => {
  const {env,profile}=fixture(t);
  const source=fs.readFileSync(path.resolve(__dirname,'../services/database-connections.js'),'utf8');
  const queries=[];let closed=0,bad=false,captured;
  const row={dbName:PRIMARY,serverName:env.ONPREM_EXPECTED_SERVERNAME,loginName:profile.username,originalLogin:profile.username,productVersion:'10.50.6000',netTransport:'TCP',isSysadmin:0,isSecurityadmin:0,isServeradmin:0,isSetupadmin:0,isProcessadmin:0,isDiskadmin:0,isDbcreator:0,isBulkadmin:0,hasProdAccess:0,otherUserDbCount:0,hasControlServer:0,isDbOwner:0,hasControlDatabase:0};
  class Pool {
    constructor(config){captured=config;} on(){} async connect(){if(bad)throw Error('driver password='+secret);}
    request(){return {query:async text=>{queries.push(text);return {recordset:[text.includes('AS ready')?{ready:1}:row]};}};}
    async close(){closed++;}
  }
  const mod={exports:{}};
  require('node:vm').runInNewContext(source,{module:mod,process,Buffer,require(id){
    if(id==='../db')return {createOnpremProbePool(settings,database){return new Pool({...onpremConnectionConfig(settings,'runtime',false,database),pool:{max:1}});}};
    if(id==='./database-connection-store')return store;
    if(id==='../onprem-target')return require('../onprem-target');
    throw Error('Unexpected module '+id);
  }});
  await mod.exports.probe(PRIMARY,profile,env);
  assert.equal(queries.length,2);assert.ok(queries.every(q=>/^\s*SELECT\b/.test(q)));
  assert.equal(captured.password,secret);assert.equal(captured.pool.max,1);assert.equal(closed,1);
  bad=true;
  await assert.rejects(mod.exports.probe(PRIMARY,profile,env),e=>e.code==='CONNECTION_TEST_FAILED'&&!e.message.includes(secret));
  assert.equal(closed,2);
});

test('corruption, wrong keys and simultaneous writes fail closed', async t => {
  const {env,service,profile}=fixture(t);
  const lock=env.ONPREM_CONNECTION_STORE_FILE+'.lock';fs.writeFileSync(lock,'');
  await assert.rejects(service.save(PRIMARY,profile,0,'a'),{code:'CONNECTION_STORE_BUSY'});fs.unlinkSync(lock);
  assert.throws(()=>store.initialize(env),{code:'CONNECTION_STORE_ALREADY_EXISTS'});
  fs.writeFileSync(env.ONPREM_CONNECTION_KEY_FILE,Buffer.alloc(32));
  assert.throws(()=>service.list(),{code:'CONNECTION_STORE_UNREADABLE'});
  assert.throws(()=>onpremTuple(env),{code:'CONNECTION_STORE_UNREADABLE'});
  assert.equal(onpremTuple(env,'migration').login,'wf_migrator_test','migration does not read runtime secrets');
});

test('unsafe SQL identifiers, sa and password injection are rejected', async t => {
  const {env,service,profile}=fixture(t);
  for(const patch of [{username:'SA'},{username:'app;Uid=sa'},{server:'https://example.test'},{port:0},{database:'db;Use=master'},{password:'bad\nsecret'}]) {
    await assert.rejects(service.save(PRIMARY,{...profile,...patch},0,'a'));
  }
  assert.throws(()=>approved(PRIMARY,profile,{...env,ONPREM_PROFILE_ALLOWED_TARGETS:'[null]'}),{code:'CONNECTION_TARGET_POLICY_INVALID'});
});
