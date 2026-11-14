'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){
  let committed={},events=[],fail=false;
  const request=tx=>{const inputs={};return {input(k,t,v){inputs[k]=v;return this;},async query(sql){
    if(sql.startsWith('SELECT SettingValue'))return {recordset:committed[inputs.k]?[{SettingValue:committed[inputs.k]}]:[]};
    if(sql.startsWith('SELECT SettingKey'))return {recordset:Object.entries(committed).map(([SettingKey,SettingValue])=>({SettingKey,SettingValue}))};
    if(sql.includes('INSERT INTO wf.AdminChangeAudit')){if(fail)throw Error('AUDIT_FAILED');tx.events.push({...inputs});return {rowsAffected:[1]};}
    if(sql.includes('MERGE wf.SystemSetting')){tx.values[inputs.k]=inputs.v;return {rowsAffected:[1]};}
    throw Error('UNEXPECTED_SQL');
  }};};
  const pool={request:()=>request(null)};
  const db={pools:()=>({ready:Promise.resolve(),ownerPool:pool}),sql:{Int:'int',MAX:'max',NVarChar:n=>n,VarChar:n=>n,Transaction:class{constructor(){this.values={...committed};this.events=[];}async begin(){}async commit(){committed=this.values;events.push(...this.events);}async rollback(){}},Request:function(tx){return request(tx);}}};
  const file=path.join(__dirname,'../services/active-database.js'),mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:mod,require:name=>name==='../db'?db:require(path.resolve(path.dirname(file),name)),process,Date,Map,Set,JSON,Object,Array,String,Number,Error});
  return {api:mod.exports,fail:()=>fail=true,get committed(){return committed;},get events(){return events;}};
}
const env={DB_MODE:'onprem',ONPREM_DB_NAME:'dbwins_worldfert9_uat',ONPREM_SWITCHABLE_DATABASES:'dbwins_worldfert9_uat,dbwins_worldfert2'};
const user={sub:7,actorSub:9};
test('system database commits the selected value and both identities with audit',async()=>{
  const f=fixture();await f.api.setSystemActiveDatabase('dbwins_worldfert2',env,user);
  assert.equal(f.committed.ACTIVE_DATABASE,'dbwins_worldfert2');assert.equal(f.events[0].actor,9);assert.equal(JSON.parse(f.events[0].detail).effectiveUserId,7);
});
test('audit failure rolls system database and all theme fields back',async()=>{
  const f=fixture();f.fail();await assert.rejects(f.api.setSystemActiveDatabase('dbwins_worldfert2',env,user),/AUDIT_FAILED/);assert.deepEqual(f.committed,{});
  await assert.rejects(f.api.setDatabaseThemes({dbwins_worldfert2:{color:'yellow',label:'RD',badge:'RD',description:'x',restrictedRoles:['ACCOUNTING']}},env,user),/AUDIT_FAILED/);
  assert.deepEqual(f.committed,{});assert.deepEqual(f.events,[]);
});
test('invalid identity refuses to commit settings',async()=>{
  const f=fixture();await assert.rejects(f.api.setSystemActiveDatabase('dbwins_worldfert2',env,{}),{status:403});assert.deepEqual(f.committed,{});
});
