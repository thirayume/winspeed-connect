'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_START_DATE, isValidStartDate, boundaries } = require('../services/data-window');
const { createReader, KEY } = require('../services/global-data-window-store');

test('business-date and UTC boundaries represent midnight in Bangkok', () => {
  const b = boundaries(DEFAULT_START_DATE);
  assert.equal(b.businessDate, '2026-01-01');
  assert.equal(b.bangkokLocal, '2026-01-01 00:00:00');
  assert.equal(b.utcInstant.toISOString(), '2025-12-31T17:00:00.000Z');
  assert.equal(new Date(b.utcInstant.getTime() - 1).toISOString(), '2025-12-31T16:59:59.999Z');
});

test('reader uses a single primary source, rejects invalid stored values and does not hide DB failures', async () => {
  const calls=[];
  const reader=createReader({readPrimary:async key=>{calls.push(key);return null;}});
  assert.equal((await reader()).businessDate,'2026-01-01');
  assert.deepEqual(calls,[KEY]);
  assert.equal((await createReader({readPrimary:async()=> '2027-02-01'})()).businessDate,'2027-02-01');
  await assert.rejects(createReader({readPrimary:async()=> '2026-02-29'})(),{code:'INVALID_GLOBAL_DATA_START_DATE'});
  await assert.rejects(createReader({readPrimary:async()=>{throw Error('primary offline');}})(),/primary offline/);
});

test('on-prem reader selects the configured primary pool even if the session switched database', async () => {
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../services/global-data-window-store.js'),'utf8');
  let chosen,parameter,query;
  const request={input(name,type,value){parameter={name,type,value};return this;},async query(text){query=text;return {recordset:[{SettingValue:'2026-01-01'}]};}};
  const db={DEFAULT_TARGET:'onprem',getTarget:()=> 'remote_b',getDbName:()=> 'dbwins_worldfert2',sql:{NVarChar:()=> 'nvarchar'},pools(target,name){chosen={target,name};return {ready:Promise.resolve(),ownerPool:{request:()=>request}};}};
  const module={exports:{}};
  vm.runInNewContext(source,{module,process:{env:{ONPREM_DB_NAME:'dbwins_worldfert9_uat'}},require(id){
    if(id==='../db')return db;
    if(id==='./data-window')return require('../services/data-window');
    throw Error(id);
  }});
  assert.equal((await module.exports.readGlobalDataWindow()).businessDate,'2026-01-01');
  assert.equal(chosen.name,'dbwins_worldfert9_uat');
  assert.equal(parameter.value,KEY);
  assert.match(query,/WHERE SettingKey = @key/);
});

test('saving targets primary, uses optimistic concurrency and audits only successful changes', async () => {
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../services/global-data-window-store.js'),'utf8');
  let current='2026-01-01',chosen; const queries=[];
  const tx={request(){const args={};return {input(k,_t,v){args[k]=v;return this;},async query(text){
    queries.push({text,args});
    if(text.includes('SELECT SettingValue'))return {recordset:[{SettingValue:current}]};
    if(text.includes('MERGE wf.SystemSetting'))current=args.value;
    return {recordset:[]};
  }};}};
  const db={DEFAULT_TARGET:'onprem',getTarget:()=> 'remote_b',sql:{NVarChar:()=> 'nvarchar',Int:'int',MAX:-1},
    runWithTarget(target,fn,name){chosen={target,name};return fn();},wfTransaction:fn=>fn(tx)};
  const mod={exports:{}};
  vm.runInNewContext(source,{module:mod,process:{env:{ONPREM_DB_NAME:'dbwins_worldfert9_uat'}},require(id){
    if(id==='../db')return db;
    if(id==='./data-window')return require('../services/data-window');
    throw Error(id);
  }});
  assert.equal((await mod.exports.saveGlobalDataWindow({value:'2026-02-01',expectedValue:'2026-01-01',actorId:5})).changed,true);
  assert.equal(chosen.name,'dbwins_worldfert9_uat');assert.equal(current,'2026-02-01');
  assert.equal(queries.filter(q=>q.text.includes('INSERT wf.AdminChangeAudit')).length,1);
  await assert.rejects(mod.exports.saveGlobalDataWindow({value:'2026-03-01',expectedValue:'2026-01-01',actorId:5}),{code:'STALE_DATA_WINDOW'});
  assert.equal(current,'2026-02-01');
  assert.equal(queries.filter(q=>q.text.includes('INSERT wf.AdminChangeAudit')).length,1);
  await assert.rejects(mod.exports.saveGlobalDataWindow({value:'2026-02-29',expectedValue:'2026-02-01',actorId:5}),{code:'INVALID_DATA_WINDOW'});
});

test('date validation rejects malformed and impossible dates before any SQL query', () => {
  for (const value of ['', '2026-02-29', '2026-13-01', '2026-00-01', '2026-1-1', '2026-01-01T00:00:00', '1752-12-31', null]) {
    assert.equal(isValidStartDate(value), false);
    assert.throws(() => boundaries(value), {code:'INVALID_DATA_START_DATE'});
  }
  assert.equal(isValidStartDate('2024-02-29'), true);
  assert.equal(isValidStartDate('2026-01-01'), true);
});
