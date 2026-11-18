'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createWorker}=require('../services/rebate-evidence-discovery-worker');
test('worker stays off unless both feature flags are on and background workers are allowed',()=>{
  for(const env of [{},{REBATE_POOL_103_ENABLED:'true'},
    {REBATE_POOL_103_ENABLED:'true',REBATE_EVIDENCE_DISCOVERY_ENABLED:'true',DISABLE_BACKGROUND_WORKERS:'true'}]){
    let scheduled=0;
    const w=createWorker({env,targets:()=>[{name:'test'}],interval:()=>{scheduled++;return {unref(){}};}});
    assert.equal(w.start(),false);assert.equal(scheduled,0);
  }
});
test('pinned targets are scanned sequentially and overlapping ticks are skipped',async()=>{
  let release;const blocked=new Promise(resolve=>{release=resolve;});const seen=[];
  const w=createWorker({env:{REBATE_POOL_103_ENABLED:'true',REBATE_EVIDENCE_DISCOVERY_ENABLED:'true'},
    targets:()=>[{name:'A'},{name:'B'}],db:{runWithTarget:async(_kind,fn,name)=>{seen.push(name);return fn();}},
    runPage:async()=>{if(seen.length===1)await blocked;return {scanned:1};},
    interval:()=>({unref(){}})});
  assert.equal(w.start(),true);
  const first=w.runOnce();await Promise.resolve();
  assert.deepEqual(await w.runOnce(),{skipped:true});release();
  assert.deepEqual(await first,{skipped:false,targets:2});assert.deepEqual(seen,['A','B']);
});
test('unreviewed target manifest fails before any timer is scheduled',()=>{
  let scheduled=0;
  const w=createWorker({env:{REBATE_POOL_103_ENABLED:'true',REBATE_EVIDENCE_DISCOVERY_ENABLED:'true'},
    targets:()=>{throw Error('manifest invalid');},interval:()=>{scheduled++;return {};}});
  assert.throws(()=>w.start(),/manifest invalid/);assert.equal(scheduled,0);
});
test('invalid worker limits fail closed; configured bounds reach the page runner',async()=>{
  const env={REBATE_POOL_103_ENABLED:'true',REBATE_EVIDENCE_DISCOVERY_ENABLED:'true',REBATE_DISCOVERY_PAGE_SIZE:'101'};
  const bad=createWorker({env,targets:()=>[{name:'A'}],interval:()=>({unref(){}})});
  assert.throws(()=>bad.start(),{code:'REBATE_DISCOVERY_SETTINGS_INVALID'});
  env.REBATE_DISCOVERY_PAGE_SIZE='25';env.REBATE_DISCOVERY_INTERVAL_MS='5000';
  let delay,limit;
  const w=createWorker({env,targets:()=>[{name:'A'}],db:{runWithTarget:async(_kind,fn)=>fn()},
    runPage:async opts=>{limit=opts.limit;},interval:(_fn,ms)=>{delay=ms;return {unref(){}};}});
  assert.equal(w.start(),true);await w.runOnce();assert.equal(delay,5000);assert.equal(limit,25);
});
