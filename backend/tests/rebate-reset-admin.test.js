'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {getResetStatus,executeReset}=require('../services/rebate-reset-admin');
const {digestTargets}=require('../services/rebate-reset-fence');
function fixture(){
  const env={DB_MODE:'onprem',ONPREM_TARGET_KIND:'uat',ONPREM_DB_NAME:'dbwins_worldfert9_uat',
    ONPREM_SWITCHABLE_DATABASES:'dbwins_worldfert9_uat',REBATE_RESET_DATABASES:'dbwins_worldfert9_uat',
    REBATE_POOL_103_ENABLED:'true',REBATE_CONVERSION_APPROVAL_ENABLED:'true',REBATE_RESET_ADMIN_ENABLED:'true',
    REBATE_RESET_FENCE_AUDIT_COMPLETE:'true'};
  const tupleResolver=(_e,_op,database)=>({database,expectedServerName:'R740-SRV\\SQL2008'});
  const name=env.ONPREM_DB_NAME,server='R740-SRV\\SQL2008';
  const digest=digestTargets([{name,database:name,expectedServerName:server}]);
  const input={confirmation:'RESET',requestId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',expectedEnvironment:'uat',
    expectedPrimaryDatabase:name,expectedManifestDigest:digest};
  const state={row:{CoordinatorPhase:null,BootstrapPhase:null},calls:[],attempt:null,failRecovery:false};
  const options={env,tupleResolver,db:{},preflight:async()=>({ready:true}),inspect:async()=>state.row,
    bootstrap:async identity=>{state.calls.push(['bootstrap',identity]);state.row={CoordinatorPhase:'READY',BootstrapPhase:'COMPLETE'};},
    begin:async identity=>{state.calls.push(['begin',identity]);if(!state.attempt)state.attempt={resetId:identity.requestId,generation:1};
      return {...state.attempt,complete:state.attempt.complete===true};},
    recover:async id=>{state.calls.push(['recover',id]);if(state.failRecovery)throw Object.assign(Error('unavailable'),{code:'FAILED'});
      state.attempt.complete=true;return {complete:true,replayed:false};}};
  return {env,input,state,options,user:{sub:1,role:'ADMIN'}};
}
test('disabled by default even for an administrator',async()=>{
  const f=fixture();delete f.env.REBATE_RESET_FENCE_AUDIT_COMPLETE;
  assert.deepEqual(await getResetStatus(f.user,f.options),{enabled:false});
  await assert.rejects(executeReset(f.user,f.input,f.options),{code:'REBATE_RESET_UNAVAILABLE'});
  assert.deepEqual(f.state.calls,[]);
});
test('initializes then resets the server-pinned environment once',async()=>{
  const f=fixture();const status=await getResetStatus(f.user,f.options);
  assert.equal(status.manifestDigest,f.input.expectedManifestDigest);assert.equal(status.databases.length,1);
  const result=await executeReset(f.user,f.input,f.options);
  assert.deepEqual(result,{requestId:f.input.requestId,complete:true,replayed:false,generation:1});
  assert.deepEqual(f.state.calls.map(c=>c[0]),['bootstrap','begin','recover']);
  const replay=await executeReset(f.user,f.input,f.options);
  assert.equal(replay.replayed,true);assert.equal(f.state.calls.filter(c=>c[0]==='recover').length,1);
});
test('interrupted attempt returns its ID and retry resumes that same attempt',async()=>{
  const f=fixture();f.state.failRecovery=true;
  await assert.rejects(executeReset(f.user,f.input,f.options),e=>e.code==='FAILED'&&e.resetRequestId===f.input.requestId);
  f.state.failRecovery=false;assert.equal((await executeReset(f.user,f.input,f.options)).complete,true);
  assert.equal(f.state.calls.filter(c=>c[0]==='bootstrap').length,1);
  assert.equal(f.state.calls.filter(c=>c[0]==='begin')[1][1].requestId,f.input.requestId);
});
test('requires both administrator identities, exact confirmation and unchanged target manifest',async()=>{
  const f=fixture();
  await assert.rejects(executeReset({sub:1,role:'SALES'},f.input,f.options),{code:'REBATE_RESET_ADMIN_REQUIRED'});
  await assert.rejects(executeReset({sub:2,actorId:1,isImpersonating:true,role:'ADMIN',actorRole:'SALES'},f.input,f.options),
    {code:'REBATE_RESET_ADMIN_REQUIRED'});
  await assert.rejects(executeReset(f.user,{...f.input,confirmation:'yes'},f.options),{code:'REBATE_RESET_CONFIRMATION_INVALID'});
  await assert.rejects(executeReset(f.user,{...f.input,expectedPrimaryDatabase:'dbwins_worldfert9'},f.options),{code:'REBATE_RESET_TARGET_CHANGED'});
  await assert.rejects(executeReset(f.user,{...f.input,expectedManifestDigest:'0'.repeat(64)},f.options),{code:'REBATE_RESET_TARGET_CHANGED'});
  assert.deepEqual(f.state.calls,[]);
});
