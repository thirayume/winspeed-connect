'use strict';

// The HTTP adapter may call these only after the reset fence audit and UAT
// have passed. Flags default off. All physical targets come from reviewed
// server configuration, never from the request body or selected session DB.
const {approvalIdentity,bothHaveRole}=require('./approval-identity');
const {resolvePhysicalResetTargets}=require('./rebate-reset-targets');
const {digestTargets}=require('./rebate-reset-fence');
const {preflightResetTargets}=require('./rebate-reset-preflight');
const {bootstrapResetEnvironment}=require('./rebate-reset-bootstrap');
const {beginResetAttempt}=require('./rebate-reset-begin');
const {recoverResetAttempt}=require('./rebate-reset-recover');
function fail(code,status=503){throw Object.assign(Error(code),{code,status});}
const clean=v=>String(v||'').trim().toLowerCase();
const validId=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||''));
function authorize(user){
  const identity=approvalIdentity(user);
  if(!bothHaveRole(identity,['ADMIN']))fail('REBATE_RESET_ADMIN_REQUIRED',403);
  return identity;
}
function enabled(env){return env.REBATE_POOL_103_ENABLED==='true'&&env.REBATE_CONVERSION_APPROVAL_ENABLED==='true'&&
  env.REBATE_RESET_ADMIN_ENABLED==='true'&&env.REBATE_RESET_FENCE_AUDIT_COMPLETE==='true';}
function targetInfo(env,tupleResolver){
  const targets=resolvePhysicalResetTargets(env,tupleResolver),kind=clean(env.ONPREM_TARGET_KIND),primary=String(env.ONPREM_DB_NAME||'').trim();
  const target=targets.find(t=>clean(t.name)===clean(primary));
  if(!target)fail('REBATE_RESET_PRIMARY_INVALID');
  return {kind,primary,target,targets,digest:digestTargets(targets)};
}
async function inspect(info,db){
  const result=await db.runWithTarget('onprem',()=>db.wfQuery(`SELECT DB_NAME() AS DatabaseName,
    CAST(@@SERVERNAME AS nvarchar(128)) AS ServerName,
    (SELECT Phase FROM wf.RebateResetCoordinator WHERE EnvironmentKind=@kind) AS CoordinatorPhase,
    (SELECT Phase FROM wf.RebateResetBootstrap WHERE EnvironmentKind=@kind) AS BootstrapPhase,
    a.ResetId AS ActiveResetId,a.IdentityActorId AS ActiveActorId,a.IdentityEffectiveId AS ActiveEffectiveId
    FROM (SELECT 1 AS n) AS anchor OUTER APPLY (SELECT TOP 1 ResetId,IdentityActorId,IdentityEffectiveId
      FROM wf.RebateResetAttempt WHERE EnvironmentKind=@kind AND Phase IN ('PREPARING','APPLYING')
      ORDER BY ResetAtUtc DESC,ResetId DESC) AS a`,
  {kind:{type:db.sql.VarChar(16),value:info.kind}}),info.primary);
  const row=result.recordset?.[0];
  if(!row||clean(row.DatabaseName)!==clean(info.target.database)||clean(row.ServerName)!==clean(info.target.expectedServerName))
    fail('REBATE_RESET_TARGET_IDENTITY_MISMATCH');
  return row;
}
async function getResetStatus(user,options={}){
  const identity=authorize(user);const env=options.env||process.env;
  if(!enabled(env))return {enabled:false};
  const info=targetInfo(env,options.tupleResolver),db=options.db||require('../db');
  const preflight=await (options.preflight||preflightResetTargets)({env,db,tupleResolver:options.tupleResolver});
  if(!preflight?.ready)fail('REBATE_RESET_PREFLIGHT_FAILED');
  const row=await (options.inspect||inspect)(info,db);
  return {enabled:true,environment:info.kind,primaryDatabase:info.primary,manifestDigest:info.digest,
    databases:info.targets.map(t=>({database:t.database,server:t.expectedServerName})),
    coordinatorPhase:row.CoordinatorPhase||null,bootstrapPhase:row.BootstrapPhase||null,
    activeRequestId:row.ActiveResetId&&Number(row.ActiveActorId)===identity.actorId&&Number(row.ActiveEffectiveId)===identity.effectiveId
      ? String(row.ActiveResetId).toLowerCase():null,
    recoveryOwnedByAnotherAdmin:Boolean(row.ActiveResetId)&&
      (Number(row.ActiveActorId)!==identity.actorId||Number(row.ActiveEffectiveId)!==identity.effectiveId)};
}
async function executeReset(user,input={},options={}){
  const identity=authorize(user),env=options.env||process.env;
  if(!enabled(env))fail('REBATE_RESET_UNAVAILABLE');
  if(input.confirmation!=='RESET' || !validId(input.requestId))fail('REBATE_RESET_CONFIRMATION_INVALID',400);
  const db=options.db||require('../db'),info=targetInfo(env,options.tupleResolver);
  if(clean(input.expectedEnvironment)!==info.kind||clean(input.expectedPrimaryDatabase)!==clean(info.primary)||
     clean(input.expectedManifestDigest)!==info.digest)fail('REBATE_RESET_TARGET_CHANGED',409);
  const preflight=await (options.preflight||preflightResetTargets)({env,db,tupleResolver:options.tupleResolver});
  if(!preflight?.ready)fail('REBATE_RESET_PREFLIGHT_FAILED');
  const row=await (options.inspect||inspect)(info,db);
  const serviceOptions={...options,env,db};
  if(!row.CoordinatorPhase&&!row.BootstrapPhase || row.BootstrapPhase==='APPLYING') {
    await (options.bootstrap||bootstrapResetEnvironment)({actorId:identity.actorId,effectiveId:identity.effectiveId},serviceOptions);
  } else if(!row.CoordinatorPhase||row.BootstrapPhase!=='COMPLETE') fail('REBATE_BOOTSTRAP_EXISTING_STATE');
  const attempt=await (options.begin||beginResetAttempt)({actorId:identity.actorId,effectiveId:identity.effectiveId,
    requestId:clean(input.requestId)},serviceOptions);
  if(attempt.complete)return {requestId:attempt.resetId,complete:true,replayed:true,generation:attempt.generation};
  try {
    const result=await (options.recover||recoverResetAttempt)(attempt.resetId,serviceOptions);
    return {requestId:attempt.resetId,complete:result.complete===true,replayed:result.replayed===true,generation:attempt.generation};
  } catch(e) {
    // The caller retains this id and can retry the same attempt, never start a
    // second epoch after an interrupted response.
    e.resetRequestId=attempt.resetId;throw e;
  }
}
module.exports={getResetStatus,executeReset,enabled};
