'use strict';

// Internal, one-time initialization. It does not reset balances. The primary
// coordinator stays PREPARING until every reviewed target has durably created
// and verified its own generation-zero participant. Never auto-call on a
// missing coordinator: a missing row can be evidence of a database restore.
const crypto = require('crypto');
const { resolvePhysicalResetTargets } = require('./rebate-reset-targets');
const { preflightResetTargets } = require('./rebate-reset-preflight');
const { digestTargets, LOCK } = require('./rebate-reset-fence');
const { LOCK: PARTICIPANT_LOCK } = require('./rebate-participant-fence');
const { transactionQuery } = require('./rebate-sql');
function fail(code) { throw Object.assign(new Error(code), { code, status:503 }); }
const clean = v => String(v || '').trim().toLowerCase();
const positive = v => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const validId = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

async function bootstrapResetEnvironment({actorId,effectiveId} = {}, options = {}) {
  if (!positive(actorId) || !positive(effectiveId)) fail('REBATE_BOOTSTRAP_IDENTITY_INVALID');
  const env=options.env||process.env, db=options.db||require('../db'), tupleResolver=options.tupleResolver;
  const targets=resolvePhysicalResetTargets(env,tupleResolver), digest=digestTargets(targets);
  const kind=clean(env.ONPREM_TARGET_KIND), primary=String(env.ONPREM_DB_NAME||'').trim();
  const primaryTarget=targets.find(t=>clean(t.name)===clean(primary));
  if (!primaryTarget) fail('REBATE_BOOTSTRAP_PRIMARY_INVALID');
  if (!(await (options.preflight||preflightResetTargets)({env,db,tupleResolver}))?.ready) fail('REBATE_BOOTSTRAP_PREFLIGHT_FAILED');
  const resolveIdentity=options.resolveBusinessIdentity||require('./rebate-reset-business-identity').resolveResetBusinessIdentity;
  const mappings=[];
  for (const target of targets) {
    const mapped=await resolveIdentity({actorId,effectiveId,primaryTarget,target,db});
    if (!positive(mapped?.businessActorId)||!positive(mapped?.businessEffectiveId)) fail('REBATE_BOOTSTRAP_IDENTITY_UNAVAILABLE');
    mappings.push(mapped);
  }
  const generated=String((options.newId||crypto.randomUUID)()).toLowerCase();
  if (!validId(generated)) fail('REBATE_BOOTSTRAP_INPUT_INVALID');

  async function coordinator(fn) {
    return db.rebateFenceTransaction(async tx=>{
      const query=transactionQuery(tx,db.sql);
      const actual=(await query('SELECT DB_NAME() AS DatabaseName, CAST(@@SERVERNAME AS nvarchar(128)) AS ServerName',{})).recordset?.[0];
      if (!actual||clean(actual.DatabaseName)!==clean(primaryTarget.database)||clean(actual.ServerName)!==clean(primaryTarget.expectedServerName))
        fail('REBATE_BOOTSTRAP_TARGET_MISMATCH');
      const lock=(await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
        @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`,{resource:LOCK})).recordset?.[0]?.LockResult;
      if (!Number.isInteger(lock)||lock<0) fail('REBATE_BOOTSTRAP_LOCK_UNAVAILABLE');
      const journal=(await query('SELECT * FROM wf.RebateResetBootstrap WITH(UPDLOCK,HOLDLOCK) WHERE EnvironmentKind=@kind',{kind})).recordset?.[0];
      const row=(await query('SELECT * FROM wf.RebateResetCoordinator WITH(UPDLOCK,HOLDLOCK) WHERE EnvironmentKind=@kind',{kind})).recordset?.[0];
      const recorded=journal ? (await query(`SELECT * FROM wf.RebateResetBootstrapTarget WITH(UPDLOCK,HOLDLOCK)
        WHERE EnvironmentKind=@kind AND BootstrapId=@bootstrapId`,{kind,bootstrapId:journal.BootstrapId})).recordset||[] : [];
      return fn({query,journal,row,recorded});
    },primary);
  }
  function checkRecorded(recorded) {
    if (recorded.length!==targets.length) fail('REBATE_BOOTSTRAP_MANIFEST_MISMATCH');
    for (let i=0;i<targets.length;i++) {
      const t=targets[i], m=mappings[i];
      const matches=recorded.filter(r=>clean(r.DatabaseName)===clean(t.database)&&clean(r.ServerName)===clean(t.expectedServerName));
      if(matches.length!==1||Number(matches[0].BusinessActorId)!==m.businessActorId||Number(matches[0].BusinessEffectiveId)!==m.businessEffectiveId)
        fail('REBATE_BOOTSTRAP_IDENTITY_UNAVAILABLE');
    }
  }
  const start=await coordinator(async s=>{
    if (!s.journal) {
      // Never turn a missing coordinator into a new installation if any reset
      // journal exists. That can be a partially restored production database.
      const existing=(await s.query('SELECT TOP 1 ResetId FROM wf.RebateResetAttempt WITH(UPDLOCK,HOLDLOCK) WHERE EnvironmentKind=@kind',{kind})).recordset||[];
      if (s.row||existing.length) fail('REBATE_BOOTSTRAP_EXISTING_STATE');
      // Check every target before changing the primary to PREPARING, then
      // repeat under each participant lock before inserting. A restored target
      // with history must never be mistaken for a fresh installation.
      for (const target of targets) {
        const result=await db.runWithTarget('onprem',()=>db.wfQuery(`SELECT DB_NAME() AS DatabaseName,
          CAST(@@SERVERNAME AS nvarchar(128)) AS ServerName,
          CASE WHEN EXISTS(SELECT 1 FROM wf.RebateResetParticipant) OR EXISTS(SELECT 1 FROM wf.RebateResetReceipt)
            OR EXISTS(SELECT 1 FROM wf.RebateShipmentAccrual) OR EXISTS(SELECT 1 FROM wf.RebateShipmentReservation)
            OR EXISTS(SELECT 1 FROM wf.RebateConversionApprovalRequest) THEN 1 ELSE 0 END AS HasHistory`),target.name);
        const state=result.recordset?.[0];
        if(!state||clean(state.DatabaseName)!==clean(target.database)||clean(state.ServerName)!==clean(target.expectedServerName))
          fail('REBATE_BOOTSTRAP_TARGET_MISMATCH');
        if(Number(state.HasHistory)!==0) fail('REBATE_BOOTSTRAP_PRIOR_HISTORY');
      }
      const p={kind,bootstrapId:generated,primary,digest,actor:actorId,effective:effectiveId};
      await s.query(`INSERT wf.RebateResetBootstrap(EnvironmentKind,BootstrapId,PrimaryDatabase,ManifestDigest,IdentityActorId,IdentityEffectiveId,Phase)
        VALUES(@kind,@bootstrapId,@primary,@digest,@actor,@effective,'APPLYING')`,p);
      await s.query(`INSERT wf.RebateResetCoordinator(EnvironmentKind,PrimaryDatabase,ManifestDigest,Generation,Phase)
        VALUES(@kind,@primary,@digest,0,'PREPARING')`,p);
      for(let i=0;i<targets.length;i++) await s.query(`INSERT wf.RebateResetBootstrapTarget
        (EnvironmentKind,BootstrapId,DatabaseName,ServerName,BusinessActorId,BusinessEffectiveId)
        VALUES(@kind,@bootstrapId,@database,@server,@actorBusiness,@effectiveBusiness)`,{
        ...p,database:targets[i].database,server:targets[i].expectedServerName,
        actorBusiness:mappings[i].businessActorId,effectiveBusiness:mappings[i].businessEffectiveId});
      return {bootstrapId:generated};
    }
    if (!s.row||!validId(s.journal.BootstrapId)||clean(s.journal.PrimaryDatabase)!==clean(primary)||
        clean(s.journal.ManifestDigest)!==digest||clean(s.row.PrimaryDatabase)!==clean(primary)||clean(s.row.ManifestDigest)!==digest||
        Number(s.journal.IdentityActorId)!==actorId||Number(s.journal.IdentityEffectiveId)!==effectiveId) fail('REBATE_BOOTSTRAP_EXISTING_STATE');
    checkRecorded(s.recorded);
    if(s.journal.Phase==='COMPLETE') {
      if(s.recorded.some(r=>!r.VerifiedAtUtc)) fail('REBATE_BOOTSTRAP_MANIFEST_MISMATCH');
      return {complete:true};
    }
    if(s.journal.Phase!=='APPLYING'||s.row.Phase!=='PREPARING'||Number(s.row.Generation)!==0||s.row.ResetId!=null||s.row.LastResetAtUtc!=null)
      fail('REBATE_BOOTSTRAP_EXISTING_STATE');
    return {bootstrapId:clean(s.journal.BootstrapId)};
  });
  if(start.complete) return {complete:true,replayed:true,targetCount:targets.length};
  for(let i=0;i<targets.length;i++) {
    const target=targets[i], mapped=await resolveIdentity({actorId,effectiveId,primaryTarget,target,db});
    if(mapped?.businessActorId!==mappings[i].businessActorId||mapped?.businessEffectiveId!==mappings[i].businessEffectiveId)
      fail('REBATE_BOOTSTRAP_IDENTITY_UNAVAILABLE');
    await db.runWithTarget('onprem',()=>db.wfTransaction(async tx=>{
      const query=transactionQuery(tx,db.sql);
      const actual=(await query('SELECT DB_NAME() AS DatabaseName, CAST(@@SERVERNAME AS nvarchar(128)) AS ServerName',{})).recordset?.[0];
      if(!actual||clean(actual.DatabaseName)!==clean(target.database)||clean(actual.ServerName)!==clean(target.expectedServerName)) fail('REBATE_BOOTSTRAP_TARGET_MISMATCH');
      const lock=(await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
        @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`,{resource:PARTICIPANT_LOCK})).recordset?.[0]?.LockResult;
      if(!Number.isInteger(lock)||lock<0) fail('REBATE_BOOTSTRAP_LOCK_UNAVAILABLE');
      const rows=(await query('SELECT * FROM wf.RebateResetParticipant WITH(UPDLOCK,HOLDLOCK)',{})).recordset||[];
      if(rows.length===0) {
        // Any prior epoch evidence means this might be a damaged/old restore.
        const history=(await query(`SELECT CASE WHEN EXISTS(SELECT 1 FROM wf.RebateResetReceipt)
          OR EXISTS(SELECT 1 FROM wf.RebateShipmentAccrual) OR EXISTS(SELECT 1 FROM wf.RebateShipmentReservation)
          OR EXISTS(SELECT 1 FROM wf.RebateConversionApprovalRequest) THEN 1 ELSE 0 END AS HasHistory`,{})).recordset?.[0];
        if(Number(history?.HasHistory)!==0) fail('REBATE_BOOTSTRAP_PRIOR_HISTORY');
        await query(`INSERT wf.RebateResetParticipant(EnvironmentKind,ManifestDigest,Generation,Phase,BootstrapId)
          VALUES(@kind,@digest,0,'READY',@bootstrapId)`,{kind,digest,bootstrapId:start.bootstrapId});
      } else if(rows.length!==1||clean(rows[0].EnvironmentKind)!==kind||clean(rows[0].ManifestDigest)!==digest||
        Number(rows[0].Generation)!==0||rows[0].Phase!=='READY'||rows[0].ResetId!=null||rows[0].LastResetAtUtc!=null||
        clean(rows[0].BootstrapId)!==start.bootstrapId) fail('REBATE_BOOTSTRAP_PRIOR_HISTORY');
    }),target.name);
    await coordinator(async s=>{
      if(!s.journal||clean(s.journal.BootstrapId)!==start.bootstrapId||s.journal.Phase!=='APPLYING'||s.row?.Phase!=='PREPARING') fail('REBATE_BOOTSTRAP_EXISTING_STATE');
      checkRecorded(s.recorded);
      const result=await s.query(`UPDATE wf.RebateResetBootstrapTarget SET VerifiedAtUtc=GETUTCDATE()
        WHERE EnvironmentKind=@kind AND BootstrapId=@bootstrapId AND DatabaseName=@database AND ServerName=@server`,{
        kind,bootstrapId:start.bootstrapId,database:target.database,server:target.expectedServerName});
      if(Number(result.rowsAffected?.[0])!==1) fail('REBATE_BOOTSTRAP_MANIFEST_MISMATCH');
    });
  }
  return coordinator(async s=>{
    if(!s.journal||clean(s.journal.BootstrapId)!==start.bootstrapId||s.journal.Phase!=='APPLYING'||s.row?.Phase!=='PREPARING') fail('REBATE_BOOTSTRAP_EXISTING_STATE');
    checkRecorded(s.recorded);
    if(s.recorded.some(r=>!r.VerifiedAtUtc)) fail('REBATE_BOOTSTRAP_INCOMPLETE');
    const p={kind,bootstrapId:start.bootstrapId,digest};
    const a=await s.query(`UPDATE wf.RebateResetBootstrap SET Phase='COMPLETE',CompletedAtUtc=GETUTCDATE()
      WHERE EnvironmentKind=@kind AND BootstrapId=@bootstrapId AND Phase='APPLYING'`,p);
    const c=await s.query(`UPDATE wf.RebateResetCoordinator SET Phase='READY',UpdatedAtUtc=GETUTCDATE()
      WHERE EnvironmentKind=@kind AND ManifestDigest=@digest AND Generation=0 AND Phase='PREPARING'`,p);
    if(Number(a.rowsAffected?.[0])!==1||Number(c.rowsAffected?.[0])!==1) fail('REBATE_BOOTSTRAP_EXISTING_STATE');
    return {complete:true,replayed:false,targetCount:targets.length};
  });
}
module.exports={bootstrapResetEnvironment};
