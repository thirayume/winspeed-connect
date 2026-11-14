'use strict';

// Internal coordinator primitive. Not an API: all existing Rebate reads/writes
// must use both fences and the participant recovery/finalization protocol must
// be finished before this can safely be called on a real environment.
const crypto = require('crypto');
const { resolvePhysicalResetTargets } = require('./rebate-reset-targets');
const { preflightResetTargets } = require('./rebate-reset-preflight');
const { digestTargets, LOCK } = require('./rebate-reset-fence');
const { epoch } = require('./rebate-reset-epoch');
const { transactionQuery } = require('./rebate-sql');
function fail(code) { throw Object.assign(new Error(code), { code, status: 503 }); }
const clean = value => String(value || '').trim().toLowerCase();
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const validId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));

async function beginResetAttempt({ actorId, effectiveId, requestId } = {}, options = {}) {
  if (!positive(actorId) || !positive(effectiveId)) fail('REBATE_RESET_IDENTITY_INVALID');
  if (requestId != null && !validId(requestId)) fail('REBATE_RESET_INPUT_INVALID');
  if (requestId != null) requestId=clean(requestId);
  const env = options.env || process.env, db = options.db || require('../db'), tupleResolver = options.tupleResolver;
  // Routes run unfenced while the Rebate Pool switch is off (rebate-route-fence.js),
  // so no reset may begin or resume in that state.
  if (env.REBATE_POOL_103_ENABLED !== 'true') fail('REBATE_POOL_103_UNAVAILABLE');
  const targets = resolvePhysicalResetTargets(env, tupleResolver);
  const digest = digestTargets(targets), kind = clean(env.ONPREM_TARGET_KIND), primary = String(env.ONPREM_DB_NAME || '').trim();
  const primaryTarget = targets.find(t => clean(t.name) === clean(primary));
  if (!primaryTarget) fail('REBATE_RESET_PRIMARY_INVALID');
  const preflight = await (options.preflight || preflightResetTargets)({ env, db, tupleResolver });
  if (!preflight?.ready) fail('REBATE_RESET_PREFLIGHT_FAILED');
  // Check and bind each database identity before closing the global fence.
  // Recovery rechecks these bindings before touching any participant.
  const resolveIdentity = options.resolveBusinessIdentity || require('./rebate-reset-business-identity').resolveResetBusinessIdentity;
  const mappings = [];
  for (const target of targets) {
    const mapped = await resolveIdentity({ actorId, effectiveId, primaryTarget, target, db });
    if (!positive(mapped?.businessActorId) || !positive(mapped?.businessEffectiveId))
      fail('REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE');
    mappings.push(mapped);
  }
  return db.rebateFenceTransaction(async tx => {
    const query = transactionQuery(tx, db.sql);
    const actual = (await query('SELECT DB_NAME() AS DatabaseName, CAST(@@SERVERNAME AS nvarchar(128)) AS ServerName', {})).recordset?.[0];
    if (!actual || clean(actual.DatabaseName) !== clean(primaryTarget.database) || clean(actual.ServerName) !== clean(primaryTarget.expectedServerName)) fail('REBATE_RESET_TARGET_IDENTITY_MISMATCH');
    const lock = (await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
      @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`, { resource: LOCK })).recordset?.[0]?.LockResult;
    if (!Number.isInteger(lock) || lock < 0) fail('REBATE_RESET_FENCE_UNAVAILABLE');
    const row = (await query(`SELECT EnvironmentKind,PrimaryDatabase,ManifestDigest,Generation,Phase,ResetId,LastResetAtUtc
      FROM wf.RebateResetCoordinator WITH(UPDLOCK,HOLDLOCK) WHERE EnvironmentKind=@kind`, { kind })).recordset?.[0];
    if (requestId) {
      const old=(await query(`SELECT * FROM wf.RebateResetAttempt WITH(UPDLOCK,HOLDLOCK)
        WHERE EnvironmentKind=@kind AND ResetId=@resetId`,{kind,resetId:requestId})).recordset?.[0];
      if(old) {
        if(!row||clean(row.EnvironmentKind)!==kind||clean(row.PrimaryDatabase)!==clean(primary)||clean(row.ManifestDigest)!==digest||
          clean(old.ManifestDigest)!==digest||Number(old.IdentityActorId)!==actorId||Number(old.IdentityEffectiveId)!==effectiveId||
          !['PREPARING','APPLYING','COMPLETE'].includes(old.Phase)) fail('REBATE_RESET_REQUEST_CONFLICT');
        const recorded=(await query(`SELECT DatabaseName,ServerName,BusinessActorId,BusinessEffectiveId
          FROM wf.RebateResetAttemptTarget WITH(UPDLOCK,HOLDLOCK) WHERE EnvironmentKind=@kind AND ResetId=@resetId`,
        {kind,resetId:requestId})).recordset||[];
        if(recorded.length!==targets.length) fail('REBATE_RESET_REQUEST_CONFLICT');
        for(let i=0;i<targets.length;i++) {
          const match=recorded.filter(r=>clean(r.DatabaseName)===clean(targets[i].database)&&clean(r.ServerName)===clean(targets[i].expectedServerName));
          if(match.length!==1||Number(match[0].BusinessActorId)!==mappings[i].businessActorId||
              Number(match[0].BusinessEffectiveId)!==mappings[i].businessEffectiveId) fail('REBATE_RESET_REQUEST_CONFLICT');
        }
        const prior=epoch({generation:Number(old.NewGeneration),resetId:requestId,lastResetAtUtc:old.ResetAtUtc});
        return {environment:kind,resetId:requestId,resetAtUtc:prior.lastResetAtUtc,generation:prior.generation,
          targetCount:targets.length,replayed:true,complete:old.Phase==='COMPLETE'};
      }
    }
    if (!row || row.Phase !== 'READY' || clean(row.EnvironmentKind) !== kind || clean(row.PrimaryDatabase) !== clean(primary) ||
        clean(row.ManifestDigest) !== digest || row.Generation == null || !Number.isSafeInteger(Number(row.Generation)) ||
        Number(row.Generation) < 0 || Number(row.Generation) >= 2147483647) fail('REBATE_RESET_COORDINATOR_MISMATCH');
    const previous = epoch({ generation: Number(row.Generation), resetId: row.ResetId, lastResetAtUtc: row.LastResetAtUtc });
    const now = (await query('SELECT GETUTCDATE() AS ResetAtUtc', {})).recordset?.[0]?.ResetAtUtc;
    const next = epoch({ generation: previous.generation + 1, resetId: requestId || (options.newId || crypto.randomUUID)(), lastResetAtUtc: now });
    if (previous.lastResetAtUtc && next.lastResetAtUtc <= previous.lastResetAtUtc) fail('REBATE_RESET_CLOCK_INVALID');
    const p = { kind, digest, actor: actorId, effective: effectiveId, resetId: next.resetId, resetAt: next.lastResetAtUtc,
      oldGeneration: previous.generation, oldResetId: previous.resetId, oldResetAt: previous.lastResetAtUtc, newGeneration: next.generation };
    await query(`INSERT wf.RebateResetAttempt(EnvironmentKind,ResetId,ManifestDigest,PreviousGeneration,PreviousResetId,
      PreviousResetAtUtc,NewGeneration,ResetAtUtc,IdentityActorId,IdentityEffectiveId,Phase)
      VALUES(@kind,@resetId,@digest,@oldGeneration,@oldResetId,@oldResetAt,@newGeneration,@resetAt,@actor,@effective,'PREPARING')`, p);
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i], mapped = mappings[i];
      await query(`INSERT wf.RebateResetAttemptTarget(EnvironmentKind,ResetId,DatabaseName,ServerName,BusinessActorId,BusinessEffectiveId)
        VALUES(@kind,@resetId,@database,@server,@businessActor,@businessEffective)`, { kind, resetId: next.resetId,
        database: target.database, server: target.expectedServerName, businessActor: mapped.businessActorId,
        businessEffective: mapped.businessEffectiveId });
    }
    const updated = await query(`UPDATE wf.RebateResetCoordinator SET Phase='PREPARING',StartedAtUtc=@resetAt,UpdatedAtUtc=GETUTCDATE()
      WHERE EnvironmentKind=@kind AND PrimaryDatabase=@primary AND ManifestDigest=@digest AND Phase='READY' AND Generation=@oldGeneration
      AND ((ResetId=@oldResetId) OR (ResetId IS NULL AND @oldResetId IS NULL))
      AND ((LastResetAtUtc=@oldResetAt) OR (LastResetAtUtc IS NULL AND @oldResetAt IS NULL))`, { ...p, primary });
    if (Number(updated.rowsAffected?.[0]) !== 1) fail('REBATE_RESET_COORDINATOR_MISMATCH');
    return { environment: kind, resetId: next.resetId, resetAtUtc: next.lastResetAtUtc, generation: next.generation, targetCount: targets.length };
  }, primary);
}
module.exports = { beginResetAttempt };
