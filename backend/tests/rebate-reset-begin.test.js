'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { beginResetAttempt } = require('../services/rebate-reset-begin');
const { digestTargets } = require('../services/rebate-reset-fence');

function fixture() {
  const env = { DB_MODE:'onprem', ONPREM_TARGET_KIND:'production', ONPREM_DB_NAME:'dbwins_worldfert9',
    ONPREM_SWITCHABLE_DATABASES:'dbwins_worldfert9,dbwins_worldfert2', REBATE_RESET_DATABASES:'dbwins_worldfert9,dbwins_worldfert2' };
  const tupleResolver = (_env, _op, database) => ({ database, expectedServerName:'R740-SRV\\SQL2008' });
  const targets = ['dbwins_worldfert9','dbwins_worldfert2'].map(name => ({ name, database:name, expectedServerName:'R740-SRV\\SQL2008' }));
  const state = { coordinator: { EnvironmentKind:'production', PrimaryDatabase:'dbwins_worldfert9', ManifestDigest:digestTargets(targets),
    Generation:0, Phase:'READY', ResetId:null, LastResetAtUtc:null }, attempts:[], targets:[], lock:0, failTarget:false,
    actual:{ DatabaseName:'dbwins_worldfert9', ServerName:'R740-SRV\\SQL2008' } };
  const execute = async (text, p) => {
    if (/SELECT DB_NAME/.test(text)) return { recordset:[state.actual] };
    if (/sp_getapplock/.test(text)) { assert.match(text, /LockMode='Exclusive'/); return { recordset:[{ LockResult:state.lock }] }; }
    if (/SELECT EnvironmentKind,PrimaryDatabase/.test(text)) return { recordset:[state.coordinator] };
    if (/SELECT \* FROM wf.RebateResetAttempt WITH/.test(text)) {
      const a=state.attempts.find(x=>x.resetId===p.resetId);
      return {recordset:a?[{ManifestDigest:a.digest,IdentityActorId:a.actor,IdentityEffectiveId:a.effective,
        Phase:a.phase||'PREPARING',NewGeneration:a.newGeneration,ResetAtUtc:a.resetAt}]:[]};
    }
    if (/SELECT DatabaseName,ServerName,BusinessActorId/.test(text)) return {recordset:state.targets
      .filter(t=>t.resetId===p.resetId).map(t=>({DatabaseName:t.database,ServerName:t.server,
        BusinessActorId:t.businessActor,BusinessEffectiveId:t.businessEffective}))};
    if (/SELECT GETUTCDATE/.test(text)) return { recordset:[{ ResetAtUtc:new Date('2026-11-13T12:00:00Z') }] };
    if (/INSERT wf.RebateResetAttempt\(/.test(text)) { state.attempts.push({ ...p }); return {}; }
    if (/INSERT wf.RebateResetAttemptTarget/.test(text)) { if (state.failTarget && state.targets.length) throw Error('target insert failure'); state.targets.push({ ...p }); return {}; }
    if (/UPDATE wf.RebateResetCoordinator/.test(text)) { state.coordinator.Phase='PREPARING'; return { rowsAffected:[1] }; }
    throw Error('Unexpected query');
  };
  const sql = { NVarChar: x => x, VarChar: x => x, DateTime2:'datetime', Int:'int', BigInt:'bigint', Bit:'bit', MAX:-1 };
  let pending = Promise.resolve();
  const db = { sql, rebateFenceTransaction: (fn, primary) => {
    assert.equal(primary, env.ONPREM_DB_NAME);
    const run = async () => { const before = structuredClone(state);
      const tx = { request: () => { const p = {}; return { input(k,_t,v) { p[k]=v; return this; }, query(text) { return execute(text,p); } }; } };
      try { return await fn(tx); } catch (error) { Object.assign(state,before); throw error; } };
    const result=pending.then(run,run); pending=result.catch(()=>{}); return result;
  } };
  const options = { env, db, tupleResolver, preflight:async()=>({ ready:true }),
    resolveBusinessIdentity:async({target})=>target.name==='dbwins_worldfert9'
      ? {businessActorId:1,businessEffectiveId:2} : {businessActorId:11,businessEffectiveId:12},
    newId:()=> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
  return { state, options, run:(requestId)=>beginResetAttempt({ actorId:1, effectiveId:2, requestId },options) };
}

test('begin persists one epoch and the full target manifest before closing the coordinator', async () => {
  const f=fixture(), result=await f.run();
  assert.equal(result.generation,1); assert.equal(result.targetCount,2);
  assert.equal(f.state.coordinator.Phase,'PREPARING');
  assert.equal(f.state.attempts.length,1); assert.equal(f.state.targets.length,2);
  assert.ok(f.state.targets.every(t=>t.resetId===result.resetId));
  assert.deepEqual(f.state.targets.map(t=>[t.businessActor,t.businessEffective]),[[1,2],[11,12]]);
});
test('unmapped secondary identity does not close the coordinator', async () => {
  const f=fixture(); f.options.resolveBusinessIdentity=async({target})=>target.name==='dbwins_worldfert9'
    ? {businessActorId:1,businessEffectiveId:2} : null;
  const before=structuredClone(f.state);
  await assert.rejects(f.run(),{code:'REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE'});
  assert.deepEqual(f.state,before);
});
test('concurrent confirmations yield only one attempt', async () => {
  const f=fixture(); const results=await Promise.allSettled([f.run(),f.run()]);
  assert.deepEqual(results.map(r=>r.status).sort(),['fulfilled','rejected']);
  assert.equal(f.state.attempts.length,1); assert.equal(f.state.targets.length,2);
});
test('a retried or concurrent request ID reuses the same reset instead of resetting twice',async()=>{
  const f=fixture(),id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const [first,second]=await Promise.all([f.run(id),f.run(id)]);
  assert.equal(first.resetId,id);assert.equal(second.resetId,id);assert.equal(second.replayed,true);
  assert.equal(f.state.attempts.length,1);assert.equal(f.state.targets.length,2);
  f.state.attempts[0].phase='COMPLETE';
  assert.equal((await f.run(id)).complete,true);
});
test('a retry with changed business identity is rejected',async()=>{
  const f=fixture(),id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';await f.run(id);
  f.options.resolveBusinessIdentity=async()=>({businessActorId:99,businessEffectiveId:2});
  await assert.rejects(f.run(id),{code:'REBATE_RESET_REQUEST_CONFLICT'});
  assert.equal(f.state.attempts.length,1);
});
test('incomplete preflight, wrong target, lock failure or changed manifest do not start', async () => {
  for (const mutate of [f=>f.options.preflight=async()=>({ready:false}), f=>f.state.actual.DatabaseName='dbwins_worldfert9_uat',
    f=>f.state.lock=-1, f=>f.state.coordinator.ManifestDigest='b'.repeat(64)]) {
    const f=fixture(); mutate(f); const before=structuredClone(f.state);
    await assert.rejects(f.run()); assert.deepEqual(f.state,before);
  }
});
test('failure while persisting targets rolls the journal and coordinator back', async () => {
  const f=fixture(); f.state.failTarget=true; const before=structuredClone(f.state);
  await assert.rejects(f.run(),/target insert failure/); assert.deepEqual(f.state,before);
});
