'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { recoverResetAttempt } = require('../services/rebate-reset-recover');
const { digestTargets } = require('../services/rebate-reset-fence');

function fixture() {
  const env={ DB_MODE:'onprem', ONPREM_TARGET_KIND:'production', ONPREM_DB_NAME:'dbwins_worldfert9',
    ONPREM_SWITCHABLE_DATABASES:'dbwins_worldfert9,dbwins_worldfert2', REBATE_RESET_DATABASES:'dbwins_worldfert9,dbwins_worldfert2' };
  const tupleResolver=(_env,_op,database)=>({database,expectedServerName:'R740-SRV\\SQL2008'});
  const targets=['dbwins_worldfert9','dbwins_worldfert2'].map(name=>({name,database:name,expectedServerName:'R740-SRV\\SQL2008'}));
  const digest=digestTargets(targets), resetId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', resetAt=new Date('2026-11-13T12:00:00Z');
  const state={ coordinator:{EnvironmentKind:'production',PrimaryDatabase:'dbwins_worldfert9',ManifestDigest:digest,Generation:0,Phase:'PREPARING',ResetId:null,LastResetAtUtc:null},
    attempt:{EnvironmentKind:'production',ResetId:resetId,ManifestDigest:digest,PreviousGeneration:0,PreviousResetId:null,PreviousResetAtUtc:null,
      NewGeneration:1,ResetAtUtc:resetAt,IdentityActorId:1,IdentityEffectiveId:2,Phase:'PREPARING'},
    targets:targets.map(t=>({DatabaseName:t.database,ServerName:t.expectedServerName,ReceiptVerifiedAtUtc:null})), participants:{}, failTarget:null, failMark:false };
  const sql={ NVarChar:x=>x, VarChar:x=>x, DateTime2:'datetime', Int:'int', BigInt:'bigint', Bit:'bit', MAX:-1 };
  const execute=async(text,p)=>{
    if (/SELECT DB_NAME/.test(text)) return { recordset:[{DatabaseName:'dbwins_worldfert9',ServerName:'R740-SRV\\SQL2008'}] };
    if (/sp_getapplock/.test(text)) return {recordset:[{LockResult:0}]};
    if (/SELECT EnvironmentKind,PrimaryDatabase/.test(text)) return {recordset:[state.coordinator]};
    if (/SELECT \* FROM wf.RebateResetAttempt/.test(text)) return {recordset:[state.attempt]};
    if (/SELECT DatabaseName,ServerName,ReceiptVerifiedAtUtc/.test(text)) return {recordset:state.targets};
    if (/UPDATE wf.RebateResetAttempt SET Phase='APPLYING'/.test(text)) {state.attempt.Phase='APPLYING';return {rowsAffected:[1]};}
    if (/UPDATE wf.RebateResetCoordinator SET Phase='APPLYING'/.test(text)) {state.coordinator.Phase='APPLYING';return {rowsAffected:[1]};}
    if (/UPDATE wf.RebateResetAttemptTarget SET BusinessActorId/.test(text)) {
      const target=state.targets.find(t=>t.DatabaseName===p.database && t.ServerName===p.server);
      if (!target || target.BusinessActorId != null || target.BusinessEffectiveId != null) return {rowsAffected:[0]};
      target.BusinessActorId=p.actor; target.BusinessEffectiveId=p.effective; return {rowsAffected:[1]};
    }
    if (/UPDATE wf.RebateResetAttemptTarget SET/.test(text)) {
      if (state.failMark) {state.failMark=false;throw Error('mark unavailable');}
      const target=state.targets.find(t=>t.DatabaseName===p.database && t.ServerName===p.server);
      if (!target) return {rowsAffected:[0]}; target.ReceiptVerifiedAtUtc=new Date('2026-11-13T12:01:00Z');return {rowsAffected:[1]};
    }
    if (/UPDATE wf.RebateResetAttempt SET Phase='COMPLETE'/.test(text)) {state.attempt.Phase='COMPLETE';return {rowsAffected:[1]};}
    if (/UPDATE wf.RebateResetCoordinator SET Phase='READY'/.test(text)) {Object.assign(state.coordinator,{Phase:'READY',Generation:p.generation,ResetId:p.resetId,LastResetAtUtc:p.resetAt});return {rowsAffected:[1]};}
    throw Error('Unexpected SQL');
  };
  const tx=()=>({request:()=>{const p={};return {input(k,_t,v){p[k]=v;return this;},query(text){return execute(text,p);}};}});
  let currentTarget;
  const db={sql,rebateFenceTransaction:async fn=>{const before=structuredClone(state);try{return await fn(tx());}catch(e){Object.assign(state,before);throw e;}},
    runWithTarget:async(_target,fn,name)=>{currentTarget=name;return fn();},wfTransaction:async fn=>fn(tx())};
  const options={env,db,tupleResolver,preflight:async()=>({ready:true}),
    resolveBusinessIdentity:async({target})=>({businessActorId:target.name==='dbwins_worldfert9'?1:11,businessEffectiveId:target.name==='dbwins_worldfert9'?2:12}),
    applyParticipant:async(_query,input)=>{
    assert.equal(input.target.database,currentTarget);
    assert.equal(input.businessActorId,currentTarget==='dbwins_worldfert9'?1:11);
    if (state.failTarget===currentTarget) throw Error('participant unavailable');
    if (!state.participants[currentTarget]) state.participants[currentTarget]={resetId:input.next.resetId,applications:1};
    else assert.equal(state.participants[currentTarget].resetId,input.next.resetId);
  }};
  return {state,options,resetId,run:()=>recoverResetAttempt(resetId,options)};
}

test('a failed participant keeps the coordinator closed and resume finishes the same epoch once', async()=>{
  const f=fixture();f.state.failTarget='dbwins_worldfert2';
  await assert.rejects(f.run(),/participant unavailable/);
  assert.equal(f.state.coordinator.Phase,'APPLYING'); assert.equal(f.state.participants.dbwins_worldfert9.applications,1);
  f.state.failTarget=null; assert.deepEqual(await f.run(),{complete:true,replayed:false,targetCount:2});
  assert.equal(f.state.coordinator.Phase,'READY');assert.equal(f.state.coordinator.Generation,1);
  assert.equal(f.state.participants.dbwins_worldfert9.applications,1);
  assert.deepEqual(await f.run(),{complete:true,replayed:true,targetCount:2});
});
test('failure after participant commit can replay its receipt without applying twice',async()=>{
  const f=fixture();f.state.failMark=true;await assert.rejects(f.run(),/mark unavailable/);
  assert.equal(f.state.coordinator.Phase,'APPLYING');assert.equal(f.state.participants.dbwins_worldfert9.applications,1);
  f.state.failMark=false;await f.run();assert.equal(f.state.participants.dbwins_worldfert9.applications,1);
});
test('a changed cross-database identity cannot resume an existing reset attempt',async()=>{
  const f=fixture(); f.state.failTarget='dbwins_worldfert2'; await assert.rejects(f.run(),/participant unavailable/);
  f.state.failTarget=null;
  f.options.resolveBusinessIdentity=async({target})=>({businessActorId:target.name==='dbwins_worldfert9'?1:99,
    businessEffectiveId:target.name==='dbwins_worldfert9'?2:12});
  await assert.rejects(f.run(),{code:'REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE'});
  assert.equal(f.state.coordinator.Phase,'APPLYING');
});
test('missing identity in any target is detected before binding or applying',async()=>{
  const f=fixture();
  f.options.resolveBusinessIdentity=async({target})=>target.name==='dbwins_worldfert9'
    ? {businessActorId:1,businessEffectiveId:2} : null;
  await assert.rejects(f.run(),{code:'REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE'});
  assert.equal(f.state.coordinator.Phase,'PREPARING');
  assert.deepEqual(f.state.participants,{});
  assert.ok(f.state.targets.every(t=>t.BusinessActorId==null && t.BusinessEffectiveId==null));
});
test('changed target journal or digest cannot complete an attempt',async()=>{
  for(const mutate of [f=>f.state.targets.pop(),f=>f.state.targets[1].ServerName='other',f=>f.state.attempt.ManifestDigest='b'.repeat(64)]){
    const f=fixture();mutate(f);await assert.rejects(f.run());assert.equal(f.state.coordinator.Phase,'PREPARING');
  }
});
