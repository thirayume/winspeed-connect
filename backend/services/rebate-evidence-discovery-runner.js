'use strict';
// Internal bounded runner, not scheduled yet. Each page is replayable: stage
// first under per-item fences, then compare-and-swap the persisted cursor.
const {discoverEvidencePage,stageEvidencePage}=require('./rebate-evidence-discovery');
const {withRebateOperationFence}=require('./rebate-reset-fence');
const {acquireRebateParticipantFence}=require('./rebate-participant-fence');
const {transactionQuery}=require('./rebate-sql');
function fail(code,status=409){throw Object.assign(Error(code),{code,status});}
const valid=n=>Number.isSafeInteger(n)&&n>=0&&n<=2147483647;
async function runEvidenceDiscoveryPage(overrides={}){
  const db=overrides.db||require('../db');
  const fence=overrides.runFence||((fn)=>withRebateOperationFence(fn));
  const runTx=overrides.runTx||(fn=>db.wfTransaction(tx=>fn(transactionQuery(tx,db.sql))));
  const participant=overrides.participantFence||acquireRebateParticipantFence;
  const discover=overrides.discover||discoverEvidencePage,stage=overrides.stagePage||stageEvidencePage;
  const snapshot=await fence(epoch=>runTx(async query=>{
    await participant(query,epoch);
    if(!epoch.resetId||!epoch.lastResetAtUtc||!Number.isSafeInteger(epoch.generation)||epoch.generation<1)
      fail('REBATE_RESET_NOT_COMPLETED');
    const p={environment:epoch.environment,resetId:epoch.resetId,generation:epoch.generation};
    const rows=(await query(`SELECT Generation,LastRedemptionId,LastListNo,Revision
      FROM wf.RebateEvidenceDiscoveryCursor WITH(UPDLOCK,HOLDLOCK)
      WHERE EnvironmentKind=@environment AND ResetId=@resetId`,p)).recordset||[];
    if(rows.length>1)fail('REBATE_DISCOVERY_CURSOR_INVALID');
    if(!rows.length) {
      await query(`INSERT wf.RebateEvidenceDiscoveryCursor(EnvironmentKind,ResetId,Generation)
        VALUES(@environment,@resetId,@generation)`,p);
      rows.push({Generation:epoch.generation,LastRedemptionId:0,LastListNo:0,Revision:1});
    }
    const cursor=rows[0],after={redemptionId:Number(cursor.LastRedemptionId),listNo:Number(cursor.LastListNo)};
    if(Number(cursor.Generation)!==epoch.generation||!valid(after.redemptionId)||!valid(after.listNo)||
       !valid(Number(cursor.Revision))||Number(cursor.Revision)<1)fail('REBATE_DISCOVERY_CURSOR_INVALID');
    const page=await discover(query,{epoch,after,limit:overrides.limit||20});
    return {epoch,revision:Number(cursor.Revision),after,page};
  }));
  const result=await stage(snapshot.page,snapshot.epoch);
  await fence(epoch=>runTx(async query=>{
    await participant(query,epoch);
    if(epoch.environment!==snapshot.epoch.environment||epoch.generation!==snapshot.epoch.generation||
       String(epoch.resetId).toLowerCase()!==String(snapshot.epoch.resetId).toLowerCase())fail('REBATE_RESET_EPOCH_CHANGED');
    const next=result.cycleComplete?{redemptionId:0,listNo:0}:result.next;
    if(!next||!valid(next.redemptionId)||!valid(next.listNo))fail('REBATE_DISCOVERY_CURSOR_INVALID');
    const p={environment:epoch.environment,resetId:epoch.resetId,generation:epoch.generation,
      oldId:snapshot.after.redemptionId,oldLine:snapshot.after.listNo,revision:snapshot.revision,
      nextId:next.redemptionId,nextLine:next.listNo,cycled:result.cycleComplete?1:0};
    const update=await query(`UPDATE wf.RebateEvidenceDiscoveryCursor SET LastRedemptionId=@nextId,LastListNo=@nextLine,
      Revision=Revision+1,CompletedCycles=CompletedCycles+@cycled,UpdatedAtUtc=GETUTCDATE()
      WHERE EnvironmentKind=@environment AND ResetId=@resetId AND Generation=@generation AND Revision=@revision
        AND LastRedemptionId=@oldId AND LastListNo=@oldLine`,p);
    if(Number(update.rowsAffected?.[0])!==1)fail('REBATE_DISCOVERY_CURSOR_STALE');
  }));
  return {scanned:snapshot.page.scanned,staged:result.staged,cycleComplete:result.cycleComplete};
}
module.exports={runEvidenceDiscoveryPage};
