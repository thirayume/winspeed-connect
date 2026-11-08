'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReportCatalog } = require('../services/report-catalog');
function fixture() {
  let database = 'uat', reads = 0, committed = [], fail = false;
  const db = {
    getTarget: () => 'onprem', getDbName: () => database,
    wfQuery: async () => { reads++; return { recordset: [{ SettingKey: 'REPORT_CFG_sales', SettingValue: JSON.stringify({ order: 0, enabled: database === 'prod' }) }] }; },
    wfTransaction: async fn => { const tx = []; const result = await fn(tx); committed.push(...tx); return result; },
    sql: { Int: 'int', MAX: 'max', NVarChar: x => x, Request: class {
      constructor(tx) { this.tx = tx; this.values = {}; }
      input(k,t,v) { this.values[k] = v; return this; }
      async query(text) { if (fail && this.values.k === 'REPORT_CFG_stock') throw new Error('WRITE_FAILED'); this.tx.push({text, values:this.values}); }
    } },
  };
  return { catalog: createReportCatalog(db,['sales','stock']), switchDb: v => database=v, fail: () => fail=true, get reads() {return reads;}, get committed(){return committed;} };
}
test('report settings cache is isolated by database and concurrent reads coalesce', async () => {
  const f=fixture();
  const results=await Promise.all(Array.from({length:20},()=>f.catalog.get()));
  assert.equal(f.reads,1); assert.equal(results[0].visibility.sales,false);
  f.switchDb('prod'); assert.equal((await f.catalog.get()).visibility.sales,true); assert.equal(f.reads,2);
  f.switchDb('uat'); assert.equal((await f.catalog.get()).visibility.sales,false); assert.equal(f.reads,2);
});
test('report settings reject unknown, duplicate, malformed and non-boolean values before writes', async () => {
  const f=fixture();
  for (const payload of [{}, {order:['sales','sales'],visibility:{}}, {order:['secret'],visibility:{}}, {order:[],visibility:{sales:'false'}}, {order:[],visibility:[]}]) {
    await assert.rejects(f.catalog.save(payload,1),{status:400});
  }
  assert.equal(f.committed.length,0);
});
test('report save is atomic and audits the actor; failed partial save cannot publish a cache entry', async () => {
  const f=fixture(); f.fail();
  await assert.rejects(f.catalog.save({order:['sales','stock'],visibility:{sales:false}},17),/WRITE_FAILED/);
  assert.equal(f.committed.length,0); await f.catalog.get(); assert.equal(f.reads,1);
  const ok=fixture(); await ok.catalog.get();
  await ok.catalog.save({order:['stock','sales'],visibility:{stock:false}},17);
  assert.equal(ok.committed.length,3); assert.equal(ok.committed[2].values.actor,17);
  assert.match(ok.committed[0].text,/HOLDLOCK/);
  await ok.catalog.get(); assert.equal(ok.reads,2);
});
test('database restrictions apply to union roles and to both Access As identities', () => {
  const {canAccessDatabase}=require('../services/active-database');
  const rd='dbwins_worldfert2';
  assert.equal(canAccessDatabase(rd,{role:'COUNTER_SALES'},{}),false);
  assert.equal(canAccessDatabase(rd,{roles:['SALES','C_LEVEL']},{}),true);
  assert.equal(canAccessDatabase(rd,{roles:['C_LEVEL'],isImpersonating:true,actorRoles:['SALES']},{}),false);
  assert.equal(canAccessDatabase(rd,{roles:['C_LEVEL'],isImpersonating:true,actorRoles:['ADMIN']},{}),true);
  assert.equal(canAccessDatabase('dbwins_worldfert9_uat',{roles:['SALES']},{}),true);
});

test('theme settings fit SQL 2008 columns, commit atomically, and read back complete values', async () => {
  const vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
  let rows=[],commits=0;
  const makeRequest = tx => {const inputs={};return {input(k,t,v){inputs[k]=v;return this;},async query(text){if(text.startsWith('SELECT'))return {recordset:rows};assert.ok(inputs.k.length<=50);assert.ok(inputs.v.length<=200);tx.rows.push({SettingKey:inputs.k,SettingValue:inputs.v});return {};}};};
  const pool={request:()=>makeRequest(null)};
  const db={pools:()=>({ready:Promise.resolve(),ownerPool:pool}),sql:{NVarChar:n=>n,Transaction:class {constructor(){this.rows=[];}async begin(){}async commit(){rows=this.rows;commits++;}async rollback(){}},Request:function(tx){return makeRequest(tx);}}};
  const filename=path.join(__dirname,'../services/active-database.js');
  const mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module:mod,require:name=>name==='../db'?db:require(path.resolve(path.dirname(filename),name)),process,Date,Map,Set,JSON,Object,Array,String,Number,Error});
  const api=mod.exports;
  const env={DB_MODE:'onprem',ONPREM_DB_NAME:'dbwins_worldfert9_uat',ONPREM_SWITCHABLE_DATABASES:'dbwins_worldfert9_uat'};
  const cfg={color:'green',label:'UAT',badge:'UAT',description:'x'.repeat(200),restrictedRoles:['ADMIN','ACCOUNTING']};
  const saved=await api.setDatabaseThemes({dbwins_worldfert9_uat:cfg},env);
  assert.equal(saved.dbwins_worldfert9_uat.description,cfg.description);assert.equal(commits,1);assert.equal(rows.length,5);
  await assert.rejects(api.setDatabaseThemes({dbwins_worldfert9_uat:{...cfg,description:'x'.repeat(201)}},env),{status:400});
  assert.equal(commits,1);
});
