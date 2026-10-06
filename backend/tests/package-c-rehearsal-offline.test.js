'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runPlan } = require('../scripts/rehearsal-plan.cjs');
const { runCompile } = require('../scripts/rehearsal-compile.cjs');
const { runApply } = require('../scripts/rehearsal-apply.cjs');
const { runBaseline } = require('../scripts/rehearsal-baseline.cjs');
const { runVerifyInvariants } = require('../scripts/rehearsal-verify-invariants.cjs');
const { runConcurrency } = require('../scripts/rehearsal-concurrency.cjs');
const { runRollbackFailure } = require('../scripts/rehearsal-rollback-failure.cjs');
const { runSql2022Regression } = require('../scripts/rehearsal-sql2022-regression.cjs');
const { main: oracle, compareOracleReceipts } = require('../scripts/rehearsal-sql2008-oracle.cjs');
const { main } = require('../scripts/rehearsal-migration-lifecycle.cjs');
const { createRehearsalMockPool } = require('../scripts/rehearsal-test-helper.cjs');
const backupSha256='a'.repeat(64);
async function injected(fn, opts={}, handlers={}) {
  const keys={ALLOW_LIVE_REHEARSAL:'true',REHEARSAL_APPROVED_PROFILE:'local_rehearsal',
    LOCAL_REHEARSAL_SERVER:'AMYOU-YOGA7\\V2008R2',LOCAL_REHEARSAL_DB:'dbwins_worldfert9_rehearsal',
    LOCAL_REHEARSAL_USER:'wf_uat_migrator',LOCAL_REHEARSAL_PASSWORD:'test-only',
    LOCAL_REHEARSAL_CONNECTION_STRING:'',COUPON_NATIVE_POSTING_ENABLED:'false'};
  const old=Object.fromEntries(Object.keys(keys).map(k=>[k,process.env[k]]));
  Object.assign(process.env,keys);
  const pool=createRehearsalMockPool('local_rehearsal',handlers);
  try { return {result:await fn({mode:'live',driverFactory:()=>pool,...opts}),pool}; }
  finally {for(const [k,v] of Object.entries(old)) if(v===undefined) delete process.env[k];else process.env[k]=v;}
}
test('missing explicit mode and arbitrary pool cannot bypass authorization',async()=>{
  await assert.rejects(runPlan({}),/Explicit mode/);
  await assert.rejects(runPlan({mode:'mock',pool:{}}),/injection/);
  await assert.rejects(runPlan({mode:'mock',driverFactory:()=>{throw Error('must not call');}}),/Mock mode/);
});
test('live requires approval before driver call',async()=>{
  const old=process.env.ALLOW_LIVE_REHEARSAL;delete process.env.ALLOW_LIVE_REHEARSAL;
  try{await assert.rejects(runPlan({mode:'live',driverFactory:()=>{throw Error('driver called');}}),/BLOCKED/);}
  finally{if(old!==undefined)process.env.ALLOW_LIVE_REHEARSAL=old;}
});
test('unknown steps and all are rejected',async()=>{
  await assert.rejects(main({mode:'mock',step:'typo'}),/Unknown step/);
  await assert.rejects(main({mode:'mock',step:'all'}),/Unknown step/);
});
test('canonical plan includes active files, excludes 074 and global exclusions',async()=>{
  const r=await runPlan({mode:'mock'});
  assert.ok(r.totalPlanned>100);assert.equal(r.planFiles.includes('074_fix_winspeed_legacy_raiserror.sql'),false);
  assert.ok(r.excludedFiles.length>1);assert.equal(r.evidence,'OFFLINE_MOCK_ONLY');
});
test('live path injected driver never claims engine evidence and closes',async()=>{
  const {result,pool}=await injected(runPlan);
  assert.equal(result.evidence,'OFFLINE_INJECTED_DRIVER');
  assert.equal(pool.events.at(-1).kind,'close');
  assert.equal(pool.executedQueries.some(t=>/^\s*(CREATE|INSERT|UPDATE|ALTER|DROP)/i.test(t)),false);
});
test('wrong target closes before any data or migration query',async()=>{
  let captured;
  await assert.rejects(injected(runPlan,{}, {targetRecord:{dbName:'dbwins_worldfert9'},query:t=>{captured=t;}}),/MISMATCH|SAFETY/);
  assert.match(captured,/@@SERVERNAME/);
});
test('canonical compile covers standard and override files on one transaction',async()=>{
  const {result,pool}=await injected(runCompile);
  assert.ok(result.totalFilesCompiled>46);
  const batches=pool.events.filter(e=>e.kind==='batch');
  assert.equal(batches[0].text,'SET NOEXEC ON;');
  assert.equal(batches.at(-1).text,'SET NOEXEC OFF;');
  assert.ok(batches.every(e=>e.transaction));
  assert.equal(pool.events.at(-2).kind,'rollback');
  assert.equal(result.dynamicExecution,'NOT_RUN');
});
test('compile failure resets session, rolls back, closes',async()=>{
  const events=[];
  await assert.rejects(injected(runCompile,{}, {batch:t=>{events.push(t);if(t!=='SET NOEXEC ON;'&&t!=='SET NOEXEC OFF;')throw Error('compile fault');}}),/compile fault/);
  assert.equal(events.at(-1),'SET NOEXEC OFF;');
});
test('apply records real runner ledger through mock driver',async()=>{
  const r=await runApply({mode:'mock'});
  assert.ok(r.totalApplied>100);assert.equal(r.evidence,'OFFLINE_MOCK_ONLY');
});
test('baseline is required; no constant counts accepted',async()=>{
  await assert.rejects(runVerifyInvariants({mode:'mock'}),/baseline required/);
  await assert.rejects(runBaseline({mode:'mock'}),/SHA256/);
});
test('before/after compares canonical applied ledger and all dbo fixtures',async()=>{
  const opts={mode:'mock',backupSha256,mockHandlers:{applied:true}};
  const before=(await runBaseline(opts)).baseline;
  const r=await runVerifyInvariants({...opts,baseline:before});
  assert.equal(r.allPassed,true);assert.equal(r.checks.length,8);
});
test('target and backup mismatch fail closed',async()=>{
  const opts={mode:'mock',backupSha256,mockHandlers:{applied:true}};
  const before=(await runBaseline(opts)).baseline;before.backupSha256='b'.repeat(64);
  await assert.rejects(runVerifyInvariants({...opts,baseline:before}),/mismatch/);
});
test('same count changed dbo data fails digest comparison',async()=>{
  const opts={mode:'mock',backupSha256,mockHandlers:{applied:true}};
  const before=(await runBaseline(opts)).baseline;
  await assert.rejects(runVerifyInvariants({...opts,baseline:before,mockHandlers:{applied:true,query:t=>t.includes('AS RowXml FROM dbo.')?{recordset:[{Id:1,Amount:'99.00'}]}:undefined}}),/data multiset/);
});
test('changed trigger state fails even at same trigger count',async()=>{
  const opts={mode:'mock',backupSha256,mockHandlers:{applied:true}};
  const before=(await runBaseline(opts)).baseline;before.triggers[0].is_disabled=1;
  await assert.rejects(runVerifyInvariants({...opts,baseline:before}),/trigger definitions/);
});
test('historical indexes are preserved, not required absent',async()=>{
  const opts={mode:'mock',backupSha256,mockHandlers:{applied:true}};
  const before=(await runBaseline(opts)).baseline;
  assert.equal((await runVerifyInvariants({...opts,baseline:before})).allPassed,true);
  before.indexes=[];
  await assert.rejects(runVerifyInvariants({...opts,baseline:before}),/indexes preserved/);
});
test('low counter versus actual high-water fails',async()=>{
  const opts={mode:'mock',backupSha256,mockHandlers:{applied:true}};
  const before=(await runBaseline(opts)).baseline;
  await assert.rejects(runVerifyInvariants({...opts,baseline:before,mockHandlers:{applied:true,query:t=>/AS HighWater/.test(t)?{recordset:[{HighWater:'999999'}]}:undefined}}),/high-water/);
});
test('rollback exercises runner transaction and bootstrap failure contract',async()=>{
  const {result,pool}=await injected(runRollbackFailure,{}, {applied:true});
  assert.equal(result.allPassed,true);
  assert.ok(pool.events.some(e=>e.kind==='rollback'));
  assert.ok(pool.executedQueries.some(t=>/INSERT INTO wf.SchemaMigration/.test(t)));
});
test('rollback refuses to apply unrelated pending migrations',async()=>{
  await assert.rejects(runRollbackFailure({mode:'mock'}),/fully applied/);
});
test('concurrency calls actual sequence service for both sequences',async()=>{
  const {result,pool}=await injected(runConcurrency);
  assert.equal(result.results.length,2);
  for(const r of result.results){assert.equal(r.uniqueCount,25);assert.ok(r.next>r.abandoned);}
  assert.ok(pool.events.some(e=>e.params?.sequenceName==='WfRefSeq'));
  assert.ok(pool.events.some(e=>e.params?.sequenceName==='QuoteRefSeq'));
});
test('duplicate sequence results fail',async()=>{
  await assert.rejects(runConcurrency({mode:'mock',mockHandlers:{query:(_,p)=>p.sequenceName?{recordset:[{Seq:123}]}:undefined}}),/Duplicate/);
});
test('SQL2022 standard effective artifacts and native sequence metadata',async()=>{
  const r=await runSql2022Regression({mode:'mock'});
  assert.ok(r.totalPlanned>100);assert.equal(r.nativeSequences.length,2);
  assert.equal(r.runtimeParity,'NOT_RUN');
});
test('SQL2022 missing native sequence evidence fails',async()=>{
  await assert.rejects(runSql2022Regression({mode:'mock',mockHandlers:{query:t=>/FROM sys.sequences/.test(t)?{recordset:[]}:undefined}}),/Missing native sequence/);
});
test('numeric oracle transports 38 digits as strings on both profiles',async()=>{
  const a=await oracle({mode:'mock'}),b=await oracle({mode:'mock',profile:'remote_b'});
  assert.equal(a.success,true);assert.equal(a.fixtureHash,b.fixtureHash);
  assert.ok(a.rows.some(r=>typeof r.actual==='string'&&r.actual.length===38));
  assert.throws(()=>compareOracleReceipts(a,b),/Invalid paired/);
});
test('numeric oracle reports semantic mismatch instead of fabricated pass',async()=>{
  const r=await oracle({mode:'mock',mockHandlers:{query:t=>/oracle:/.test(t)?{recordset:[{ConvertedValStr:'wrong'}]}:undefined}});
  assert.equal(r.success,false);
});
test('numeric oracle rejects JS Number transport',async()=>{
  await assert.rejects(oracle({mode:'mock',mockHandlers:{query:t=>/oracle:/.test(t)?{recordset:[{ConvertedValStr:9007199254740992}]}:undefined}}),/Lossless/);
});



test('injected driver cannot bypass live apply baseline requirement', async () => {
  await assert.rejects(runApply({mode:'live',driverFactory:()=>{throw Error('must not connect');}}),/saved engine baseline/);
});
test('mock baseline cannot qualify for live invariant verification', async () => {
  const receipt=await runBaseline({mode:'mock',backupSha256});
  await assert.rejects(runVerifyInvariants({mode:'live',baseline:receipt,backupSha256,driverFactory:()=>{throw Error('must not connect');}}),/engine baseline receipt/);
});
