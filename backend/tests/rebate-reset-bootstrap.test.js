'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {bootstrapResetEnvironment}=require('../services/rebate-reset-bootstrap');
const {digestTargets}=require('../services/rebate-reset-fence');

function fixture(){
  const env={DB_MODE:'onprem',ONPREM_TARGET_KIND:'production',ONPREM_DB_NAME:'dbwins_worldfert9',
    ONPREM_SWITCHABLE_DATABASES:'dbwins_worldfert9,dbwins_worldfert2',REBATE_RESET_DATABASES:'dbwins_worldfert9,dbwins_worldfert2'};
  const tupleResolver=(_env,_op,database)=>({database,expectedServerName:'R740-SRV\\SQL2008'});
  const names=['dbwins_worldfert9','dbwins_worldfert2'];
  const targets=names.map(name=>({name,database:name,expectedServerName:'R740-SRV\\SQL2008'}));
  const state={journal:null,coordinator:null,targets:[],participants:{},history:{},attempts:[],failTarget:null,failMark:false};
  const sql={NVarChar:x=>x,VarChar:x=>x,DateTime2:'date',Int:'int',BigInt:'bigint',Bit:'bit',MAX:-1};
  let current=names[0];
  const execute=async(text,p)=>{
    if(/SELECT DB_NAME/.test(text))return {recordset:[{DatabaseName:current,ServerName:'R740-SRV\\SQL2008'}]};
    if(/sp_getapplock/.test(text))return {recordset:[{LockResult:0}]};
    if(/SELECT \* FROM wf.RebateResetBootstrap WITH/.test(text))return {recordset:state.journal?[state.journal]:[]};
    if(/SELECT \* FROM wf.RebateResetCoordinator WITH/.test(text))return {recordset:state.coordinator?[state.coordinator]:[]};
    if(/SELECT \* FROM wf.RebateResetBootstrapTarget/.test(text))return {recordset:state.targets};
    if(/SELECT TOP 1 ResetId FROM wf.RebateResetAttempt/.test(text))return {recordset:state.attempts};
    if(/INSERT wf.RebateResetBootstrap\(/.test(text)){state.journal={BootstrapId:p.bootstrapId,PrimaryDatabase:p.primary,
      ManifestDigest:p.digest,IdentityActorId:p.actor,IdentityEffectiveId:p.effective,Phase:'APPLYING'};return {rowsAffected:[1]};}
    if(/INSERT wf.RebateResetCoordinator\(/.test(text)){state.coordinator={PrimaryDatabase:p.primary,ManifestDigest:p.digest,
      EnvironmentKind:p.kind,Generation:0,Phase:'PREPARING',ResetId:null,LastResetAtUtc:null};return {rowsAffected:[1]};}
    if(/INSERT wf.RebateResetBootstrapTarget/.test(text)){state.targets.push({DatabaseName:p.database,ServerName:p.server,
      BusinessActorId:p.actorBusiness,BusinessEffectiveId:p.effectiveBusiness,VerifiedAtUtc:null});return {rowsAffected:[1]};}
    if(/SELECT \* FROM wf.RebateResetParticipant/.test(text))return {recordset:state.participants[current]?[state.participants[current]]:[]};
    if(/AS HasHistory/.test(text))return {recordset:[{HasHistory:state.history[current]?1:0}]};
    if(/INSERT wf.RebateResetParticipant/.test(text)){
      if(state.failTarget===current)throw Error('participant failed');
      state.participants[current]={EnvironmentKind:p.kind,ManifestDigest:p.digest,Generation:0,Phase:'READY',
        ResetId:null,LastResetAtUtc:null,BootstrapId:p.bootstrapId};return {rowsAffected:[1]};}
    if(/UPDATE wf.RebateResetBootstrapTarget/.test(text)){
      if(state.failMark){state.failMark=false;throw Error('mark failed');}
      const row=state.targets.find(t=>t.DatabaseName===p.database&&t.ServerName===p.server);
      if(!row)return {rowsAffected:[0]};row.VerifiedAtUtc=new Date();return {rowsAffected:[1]};}
    if(/UPDATE wf.RebateResetBootstrap SET Phase='COMPLETE'/.test(text)){state.journal.Phase='COMPLETE';return {rowsAffected:[1]};}
    if(/UPDATE wf.RebateResetCoordinator SET Phase='READY'/.test(text)){state.coordinator.Phase='READY';return {rowsAffected:[1]};}
    throw Error('unexpected SQL: '+text.slice(0,90));
  };
  const tx=()=>({request:()=>{const p={};return {input(k,_t,v){p[k]=v;return this;},query(text){return execute(text,p);}};}});
  const transaction=async fn=>{const before=structuredClone(state);try{return await fn(tx());}catch(e){Object.assign(state,before);throw e;}};
  const db={sql,rebateFenceTransaction:transaction,wfTransaction:transaction,
    runWithTarget:async(_mode,fn,name)=>{const old=current;current=name;try{return await fn();}finally{current=old;}},
    wfQuery:async()=>({recordset:[{DatabaseName:current,ServerName:'R740-SRV\\SQL2008',
      HasHistory:state.history[current]||state.participants[current]?1:0}]})};
  const options={env,db,tupleResolver,preflight:async()=>({ready:true}),newId:()=> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    resolveBusinessIdentity:async({target})=>target.name===names[0]?{businessActorId:1,businessEffectiveId:2}:{businessActorId:11,businessEffectiveId:12}};
  return {state,options,run:()=>bootstrapResetEnvironment({actorId:1,effectiveId:2},options),digest:digestTargets(targets)};
}

test('initializes every target, then opens the coordinator and replays safely',async()=>{
  const f=fixture();assert.deepEqual(await f.run(),{complete:true,replayed:false,targetCount:2});
  assert.equal(f.state.coordinator.Phase,'READY');assert.equal(f.state.journal.Phase,'COMPLETE');
  assert.equal(Object.keys(f.state.participants).length,2);
  assert.ok(f.state.targets.every(x=>x.VerifiedAtUtc));
  assert.deepEqual(await f.run(),{complete:true,replayed:true,targetCount:2});
});
test('an interrupted participant resumes without opening the coordinator or duplicating rows',async()=>{
  const f=fixture();f.state.failTarget='dbwins_worldfert2';await assert.rejects(f.run(),/participant failed/);
  assert.equal(f.state.coordinator.Phase,'PREPARING');assert.equal(Object.keys(f.state.participants).length,1);
  f.state.failTarget=null;assert.equal((await f.run()).complete,true);
  assert.equal(Object.keys(f.state.participants).length,2);
});
test('failure after participant commit can verify it on retry',async()=>{
  const f=fixture();f.state.failMark=true;await assert.rejects(f.run(),/mark failed/);
  assert.equal(f.state.coordinator.Phase,'PREPARING');assert.equal(Object.keys(f.state.participants).length,1);
  f.state.failMark=false;
  assert.equal((await f.run()).complete,true);
});
test('history in any target stops before closing the coordinator',async()=>{
  const f=fixture();f.state.history.dbwins_worldfert2=true;
  await assert.rejects(f.run(),{code:'REBATE_BOOTSTRAP_PRIOR_HISTORY'});
  assert.equal(f.state.coordinator,null);assert.equal(f.state.journal,null);
});
test('missing identity or incomplete schema stops before creating bootstrap state',async()=>{
  for(const mutate of [f=>f.options.preflight=async()=>({ready:false}),
    f=>f.options.resolveBusinessIdentity=async({target})=>target.name==='dbwins_worldfert2'?null:{businessActorId:1,businessEffectiveId:2}]){
    const f=fixture();mutate(f);await assert.rejects(f.run());
    assert.equal(f.state.coordinator,null);assert.equal(f.state.journal,null);assert.deepEqual(f.state.participants,{});
  }
});
test('existing reset journal is not silently treated as fresh after a restore',async()=>{
  const f=fixture();f.state.attempts.push({ResetId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'});
  await assert.rejects(f.run(),{code:'REBATE_BOOTSTRAP_EXISTING_STATE'});
  assert.equal(f.state.coordinator,null);assert.equal(f.state.journal,null);
});
test('a participant from an unrelated bootstrap is never adopted on resume',async()=>{
  const f=fixture();f.state.failTarget='dbwins_worldfert2';await assert.rejects(f.run(),/participant failed/);
  f.state.failTarget=null;f.state.participants.dbwins_worldfert9.BootstrapId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  await assert.rejects(f.run(),{code:'REBATE_BOOTSTRAP_PRIOR_HISTORY'});
  assert.equal(f.state.coordinator.Phase,'PREPARING');
});
test('changed mapped identities cannot resume a partial bootstrap',async()=>{
  const f=fixture();f.state.failTarget='dbwins_worldfert2';await assert.rejects(f.run(),/participant failed/);
  f.state.failTarget=null;f.options.resolveBusinessIdentity=async({target})=>target.name==='dbwins_worldfert9'
    ?{businessActorId:1,businessEffectiveId:2}:{businessActorId:99,businessEffectiveId:12};
  await assert.rejects(f.run(),{code:'REBATE_BOOTSTRAP_IDENTITY_UNAVAILABLE'});
  assert.equal(f.state.coordinator.Phase,'PREPARING');
});
