'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReadCache, scopedReadKey } = require('../services/read-cache');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };

test('sales pages use their filtered total without another database scan or exposing metadata',async()=>{
  const {readPageTotal}=require('../services/paged-orders');
  const source=[{Id:'12',FilteredTotal:'81',CustName:'Fixture'},{Id:'15',FilteredTotal:'81'}];
  const page=await readPageTotal(source,30,()=>{throw Error('unnecessary scan');});
  assert.deepEqual(page,{total:81,rows:[{Id:'12',CustName:'Fixture'},{Id:'15'}]});
  assert.equal(source[0].FilteredTotal,'81');
});

test('empty first page returns zero; an out-of-range page still reports the actual total',async()=>{
  const {readPageTotal}=require('../services/paged-orders');let countReads=0;
  const count=async()=>{countReads++;return 11;};
  assert.deepEqual(await readPageTotal([],0,count),{total:0,rows:[]});
  assert.equal(countReads,0);
  assert.deepEqual(await readPageTotal([],30,count),{total:11,rows:[]});
  assert.equal(countReads,1);
  await assert.rejects(readPageTotal([],30,async()=>{throw Error('database unavailable');}),/database unavailable/);
});

test('30 simultaneous cold reads of one database/scope execute SQL only once', async () => {
  const cache = createReadCache(); const gate = deferred(); let calls=0;
  const jobs=Array.from({length:30},()=>cache.get('uat:scope1',()=>{calls++;return gate.promise;}));
  await Promise.resolve(); assert.equal(calls,1);
  gate.resolve({total:12}); assert.equal((await Promise.all(jobs)).length,30);
  assert.deepEqual(await cache.get('uat:scope1',()=>{throw Error('cache miss');}),{total:12});
});
test('database and effective data scope never share entries',async()=>{
  const cache=createReadCache();
  const scopes=[{all:true},{all:false,userIds:[1],empIds:['A']},{all:false,userIds:[2],empIds:['B']}];
  const keys=['uat','prod'].flatMap(db=>scopes.map(s=>scopedReadKey('onprem',db,s)));
  assert.equal(new Set(keys).size,6);
  for(let i=0;i<keys.length;i++) assert.equal(await cache.get(keys[i],()=>i),i);
});
test('failed reads are not cached; force refresh still coalesces', async()=>{
  const cache=createReadCache(); await assert.rejects(cache.get('x',()=>Promise.reject(Error('offline'))));
  assert.equal(await cache.get('x',()=>1),1);
  let calls=0; const gate=deferred();
  const a=cache.get('x',()=>{calls++;return gate.promise;},{force:true});
  const b=cache.get('x',()=>{calls++;return 3;},{force:true});
  gate.resolve(2); assert.deepEqual(await Promise.all([a,b]),[2,2]); assert.equal(calls,1);
});
test('invalidation during a pending read cannot refill a newer generation',async()=>{
  const cache=createReadCache();const old=deferred();const a=cache.get('x',()=>old.promise);
  cache.clear(); assert.equal(await cache.get('x',()=>2),2);old.resolve(1);await a;
  assert.equal(await cache.get('x',()=>3),2);
});
test('telemetry tracks concurrent requests once without values or SQL',async()=>{
  const m=require('../services/performance-metrics');const a=m.startRequest(),b=m.startRequest();
  assert.equal(m.snapshot().activeRequests,2);a();a();b();assert.equal(m.snapshot().activeRequests,0);
  await m.measure('db.test',()=>Promise.resolve(1));assert.ok(m.snapshot().timings.find(r=>r.operation==='db.test'));
});
test('slow polling does not start another SQL round while a round is pending',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const gate=deferred();let calls=0;
  const sandbox={module:{exports:{}},console:{log(){},warn(){},error(){}},setInterval,clearInterval,
    require(name){if(name==='../db')return {query:()=>{calls++;return gate.promise;},wfQuery:()=>{calls++;return gate.promise;}};
      if(name==='./socket')return {broadcast(){}};
      if(name==='./pricebook-winspeed-sync')return {reconcileFromWinSpeed:async()=>({changed:false})};
      throw Error(name);}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/polling.js'),'utf8'),sandbox);
  const poll=sandbox.module.exports.pollOnce;
  const jobs=Array.from({length:20},()=>poll());assert.equal(calls,2);
  gate.resolve([]);await Promise.all(jobs);await poll();assert.equal(calls,4);
});
