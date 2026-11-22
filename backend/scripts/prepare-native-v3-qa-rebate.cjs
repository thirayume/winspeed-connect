'use strict';
// Explicit clone preparation, not a production repair or reset. Keep old reset
// journals/receipts immutable; rebind only the current clone's fence manifest.
const fs=require('fs'),assert=require('node:assert/strict');
const {assertQaProfile,assertQaAccess}=require('./native-v3-qa-profile.cjs');
const {resolvePhysicalResetTargets}=require('../services/rebate-reset-targets');
const {digestTargets}=require('../services/rebate-reset-fence');
const {transactionQuery}=require('../services/rebate-sql');
const profile=assertQaProfile();
if(!profile.rebate||process.env.QA_REBATE_REBASE!=='CONFIRM_QA_CLONE')throw Error('QA_REBASE_EXPLICIT_CONFIRMATION_REQUIRED');
const db=require('../db');
async function run(){
 await db.pools().ready;await assertQaAccess(db.wfQuery);
 const actor=JSON.parse(fs.readFileSync('/review-state/bootstrap.json','utf8'));
 assert.equal(actor.database,profile.database);
 const targets=resolvePhysicalResetTargets(),digest=digestTargets(targets);
 assert.equal(targets.length,1);assert.equal(targets[0].database,profile.database);
 const prepare=async tx=>{
  const q=transactionQuery(tx,db.sql);
  const locked=await q(`DECLARE @a int,@b int;
   EXEC @a=sp_getapplock @Resource='WF_REBATE_RESET_V1',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
   EXEC @b=sp_getapplock @Resource='WF_REBATE_PARTICIPANT_V1',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
   SELECT @a AS A,@b AS B;`,{});
  assert(locked.recordset[0].A>=0&&locked.recordset[0].B>=0);
  const rows=(await q(`SELECT c.PrimaryDatabase,c.ManifestDigest,c.Generation,c.ResetId,c.LastResetAtUtc,c.Phase,
   p.ManifestDigest AS ParticipantDigest,p.Generation AS ParticipantGeneration,p.ResetId AS ParticipantResetId,
   p.LastResetAtUtc AS ParticipantAt,p.Phase AS ParticipantPhase FROM wf.RebateResetCoordinator c WITH(UPDLOCK,HOLDLOCK)
   JOIN wf.RebateResetParticipant p WITH(UPDLOCK,HOLDLOCK) ON p.EnvironmentKind=c.EnvironmentKind
   WHERE c.EnvironmentKind='uat'`,{})).recordset;
  assert.equal(rows.length,1);const row=rows[0];
  assert.equal(row.Phase,'READY');assert.equal(row.ParticipantPhase,'READY');
  assert.equal(row.ManifestDigest,row.ParticipantDigest);assert.equal(row.Generation,row.ParticipantGeneration);
  assert.equal(String(row.ResetId).toLowerCase(),String(row.ParticipantResetId).toLowerCase());
  assert.equal(new Date(row.LastResetAtUtc).getTime(),new Date(row.ParticipantAt).getTime());
  if(row.PrimaryDatabase===profile.database&&row.ManifestDigest===digest)return;
  assert.equal(row.PrimaryDatabase,'dbwins_worldfert9_uat','Only the reviewed UAT clone origin may be rebound');
  assert.equal((await q("SELECT COUNT(*) AS N FROM wf.RebateShipmentAccrual WITH(HOLDLOCK) WHERE EnvironmentKind='uat'",{})).recordset[0].N,0,
   'A clone with existing shipment credits needs separate review, never automatic rebinding');
  assert.equal((await q("SELECT COUNT(*) AS N FROM wf.RebateResetAttempt WITH(HOLDLOCK) WHERE Phase<>'COMPLETE'",{})).recordset[0].N,0);
  assert.equal((await q("SELECT COUNT(*) AS N FROM wf.AppUser WITH(HOLDLOCK) WHERE Id=@u AND IsActive=1 AND Role='ADMIN'",{u:actor.userId})).recordset[0].N,1);
  await q(`UPDATE wf.RebateResetCoordinator SET PrimaryDatabase=@database,ManifestDigest=@digest,UpdatedAtUtc=GETUTCDATE()
   WHERE EnvironmentKind='uat' AND PrimaryDatabase='dbwins_worldfert9_uat' AND ManifestDigest=@before;
   IF @@ROWCOUNT<>1 RAISERROR('QA_REBASE_COORDINATOR_CHANGED',16,1);
   UPDATE wf.RebateResetParticipant SET ManifestDigest=@digest,UpdatedAtUtc=GETUTCDATE()
   WHERE EnvironmentKind='uat' AND ManifestDigest=@before;
   IF @@ROWCOUNT<>1 RAISERROR('QA_REBASE_PARTICIPANT_CHANGED',16,1);`,{database:profile.database,digest,before:row.ManifestDigest});
  await q(`INSERT wf.ChangeEvent(EntityType,EntityId,Action,BeforeJson,AfterJson,ReasonCode,ReasonText,UserId,ActorUserId)
   VALUES('QA_CLONE_FENCE',DB_NAME(),'REBIND',@before,@after,'QA_ONLY',
    'Owner-authorized isolated Rebate-on rehearsal; balances, tickets and old reset history unchanged',@u,@u)`,
   {before:JSON.stringify({database:row.PrimaryDatabase,digest:row.ManifestDigest,generation:row.Generation}),
    after:JSON.stringify({database:profile.database,digest,generation:row.Generation}),u:String(actor.userId)});
 };
 if(process.env.QA_REBATE_REBASE_ROLLBACK==='true'){
  const sentinel=Error('QA_REBASE_EXPECTED_ROLLBACK');
  try{await db.wfTransaction(async tx=>{await prepare(tx);throw sentinel;},
   {isolationLevel:db.sql.ISOLATION_LEVEL.SERIALIZABLE});}
  catch(e){if(e!==sentinel)throw e;}
  console.log('QA_REBATE_MANIFEST_REBASE_OUTER_ROLLBACK=PASS');return;
 }
 await db.wfTransaction(prepare,{isolationLevel:db.sql.ISOLATION_LEVEL.SERIALIZABLE});
 await require('../services/rebate-reset-fence').withRebateOperationFence(epoch=>db.wfTransaction(tx=>
  require('../services/rebate-participant-fence').acquireRebateParticipantFence(transactionQuery(tx,db.sql),epoch)));
 console.log('QA_REBATE_SINGLE_DATABASE_FENCES_VERIFIED_NO_BALANCE_RESET');
}
run().catch(e=>{console.error('QA_REBATE_PREPARE_FAILED '+e.message);process.exitCode=1;}).finally(()=>db.closeAll());
