'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runEvidenceDiscoveryPage}=require('../services/rebate-evidence-discovery-runner');
const epoch={environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',lastResetAtUtc:new Date('2026-11-14T05:00:00Z')};
function fixture(){
  const state={cursor:null,staged:0,failStage:false,stale:false};
  const query=async(text,p)=>{
    if(/SELECT Generation,LastRedemptionId/.test(text))return {recordset:state.cursor?[{...state.cursor}]:[]};
    if(/INSERT wf.RebateEvidenceDiscoveryCursor/.test(text)){state.cursor={Generation:1,LastRedemptionId:0,LastListNo:0,Revision:1};return {rowsAffected:[1]};}
    if(/UPDATE wf.RebateEvidenceDiscoveryCursor/.test(text)){
      if(state.stale||state.cursor.Revision!==p.revision)return {rowsAffected:[0]};
      state.cursor.LastRedemptionId=p.nextId;state.cursor.LastListNo=p.nextLine;state.cursor.Revision++;
      return {rowsAffected:[1]};
    }
    throw Error('unexpected query');
  };
  const deps={runFence:async fn=>fn(epoch),runTx:async fn=>fn(query),participantFence:async()=>{},
    discover:async(_q,{after})=>({scanned:1,candidates:[{redemptionId:after.redemptionId+1,listNo:1}],
      next:{redemptionId:after.redemptionId+1,listNo:1},cycleComplete:false}),
    stagePage:async page=>{state.staged++;if(state.failStage)throw Error('stage failed');
      return {staged:page.candidates.length,next:page.next,cycleComplete:page.cycleComplete};}};
  return {state,deps};
}
test('checkpoint advances only after staging and can resume next page',async()=>{
  const f=fixture();let r=await runEvidenceDiscoveryPage(f.deps);
  assert.equal(r.staged,1);assert.equal(f.state.cursor.LastRedemptionId,1);
  r=await runEvidenceDiscoveryPage(f.deps);
  assert.equal(r.staged,1);assert.equal(f.state.cursor.LastRedemptionId,2);assert.equal(f.state.cursor.Revision,3);
});
test('stage failure preserves checkpoint for replay; stale updates cannot overwrite a newer cursor',async()=>{
  const f=fixture();f.state.failStage=true;
  await assert.rejects(runEvidenceDiscoveryPage(f.deps),/stage failed/);
  assert.equal(f.state.cursor.LastRedemptionId,0);
  f.state.failStage=false;f.state.stale=true;
  await assert.rejects(runEvidenceDiscoveryPage(f.deps),{code:'REBATE_DISCOVERY_CURSOR_STALE'});
  assert.equal(f.state.cursor.LastRedemptionId,0);
  f.state.stale=false;await runEvidenceDiscoveryPage(f.deps);assert.equal(f.state.cursor.LastRedemptionId,1);
});
test('completed sweep resets cursor so backdated keys are checked next cycle',async()=>{
  const f=fixture();
  f.deps.discover=async()=>({scanned:0,candidates:[],next:{redemptionId:0,listNo:0},cycleComplete:true});
  const r=await runEvidenceDiscoveryPage(f.deps);
  assert.equal(r.cycleComplete,true);assert.equal(f.state.cursor.LastRedemptionId,0);
});
