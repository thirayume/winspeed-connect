'use strict';

// Internal recovery protocol; not exposed to HTTP. Activation remains unsafe
// until all Rebate paths use both fences and the shipped-balance ledger exists.
// Each target commits independently. Failure leaves the global phase closed;
// retries use the same immutable attempt and idempotent participant receipts.
const { resolvePhysicalResetTargets } = require('./rebate-reset-targets');
const { preflightResetTargets } = require('./rebate-reset-preflight');
const { digestTargets, LOCK } = require('./rebate-reset-fence');
const { applyResetParticipant } = require('./rebate-reset-participant-apply');
const { transactionQuery } = require('./rebate-sql');
const { epoch } = require('./rebate-reset-epoch');
function fail(code) { throw Object.assign(new Error(code), { code, status: 503 }); }
const clean = v => String(v || '').trim().toLowerCase();
const validId = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const instant = v => v == null ? null : new Date(v).getTime();

async function recoverResetAttempt(resetId, options = {}) {
  if (!validId(resetId)) fail('REBATE_RESET_INPUT_INVALID');
  resetId = clean(resetId);
  const env = options.env || process.env, db = options.db || require('../db'), tupleResolver = options.tupleResolver;
  const targets = resolvePhysicalResetTargets(env, tupleResolver), digest = digestTargets(targets);
  const kind = clean(env.ONPREM_TARGET_KIND), primary = String(env.ONPREM_DB_NAME || '').trim();
  const primaryTarget = targets.find(t => clean(t.name) === clean(primary));
  if (!primaryTarget) fail('REBATE_RESET_PRIMARY_INVALID');
  if (!(await (options.preflight || preflightResetTargets)({ env, db, tupleResolver }))?.ready) fail('REBATE_RESET_PREFLIGHT_FAILED');

  // Re-read the journal every time under the same coordinator lock. Never
  // accept target names, reset times, or actor identities from the caller.
  async function coordinator(fn) {
    return db.rebateFenceTransaction(async tx => {
      const query = transactionQuery(tx, db.sql);
      const actual = (await query('SELECT DB_NAME() AS DatabaseName, CAST(@@SERVERNAME AS nvarchar(128)) AS ServerName', {})).recordset?.[0];
      if (!actual || clean(actual.DatabaseName) !== clean(primaryTarget.database) || clean(actual.ServerName) !== clean(primaryTarget.expectedServerName)) fail('REBATE_RESET_TARGET_IDENTITY_MISMATCH');
      const lock = (await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
        @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`, { resource: LOCK })).recordset?.[0]?.LockResult;
      if (!Number.isInteger(lock) || lock < 0) fail('REBATE_RESET_FENCE_UNAVAILABLE');
      const row = (await query(`SELECT EnvironmentKind,PrimaryDatabase,ManifestDigest,Generation,Phase,ResetId,LastResetAtUtc
        FROM wf.RebateResetCoordinator WITH(UPDLOCK,HOLDLOCK) WHERE EnvironmentKind=@kind`, { kind })).recordset?.[0];
      const attempt = (await query(`SELECT * FROM wf.RebateResetAttempt WITH(UPDLOCK,HOLDLOCK)
        WHERE EnvironmentKind=@kind AND ResetId=@resetId`, { kind, resetId })).recordset?.[0];
      const recorded = (await query(`SELECT DatabaseName,ServerName,ReceiptVerifiedAtUtc,BusinessActorId,BusinessEffectiveId FROM wf.RebateResetAttemptTarget WITH(UPDLOCK,HOLDLOCK)
        WHERE EnvironmentKind=@kind AND ResetId=@resetId`, { kind, resetId })).recordset || [];
      if (!row || !attempt || clean(row.EnvironmentKind) !== kind || clean(row.PrimaryDatabase) !== clean(primary) ||
          clean(row.ManifestDigest) !== digest || clean(attempt.ManifestDigest) !== digest || clean(attempt.EnvironmentKind) !== kind ||
          clean(attempt.ResetId) !== resetId || row.Generation == null || attempt.PreviousGeneration == null || attempt.NewGeneration == null ||
          !Number.isSafeInteger(Number(attempt.IdentityActorId)) || Number(attempt.IdentityActorId) < 1 ||
          !Number.isSafeInteger(Number(attempt.IdentityEffectiveId)) || Number(attempt.IdentityEffectiveId) < 1) fail('REBATE_RESET_COORDINATOR_MISMATCH');
      const previous = epoch({ generation:Number(attempt.PreviousGeneration), resetId:attempt.PreviousResetId, lastResetAtUtc:attempt.PreviousResetAtUtc });
      const next = epoch({ generation:Number(attempt.NewGeneration), resetId:attempt.ResetId, lastResetAtUtc:attempt.ResetAtUtc });
      if (next.generation !== previous.generation + 1 || (previous.lastResetAtUtc && next.lastResetAtUtc <= previous.lastResetAtUtc)) fail('REBATE_RESET_EPOCH_INVALID');
      const recordedKeys = recorded.map(t => `${clean(t.DatabaseName)}\0${clean(t.ServerName)}`).sort();
      const expectedKeys = targets.map(t => `${clean(t.database)}\0${clean(t.expectedServerName)}`).sort();
      if (JSON.stringify(recordedKeys) !== JSON.stringify(expectedKeys)) fail('REBATE_RESET_MANIFEST_MISMATCH');
      const complete = row.Phase === 'READY' && attempt.Phase === 'COMPLETE' && Number(row.Generation) === next.generation &&
        clean(row.ResetId) === next.resetId && instant(row.LastResetAtUtc) === next.lastResetAtUtc.getTime();
      if (!complete && (!['PREPARING','APPLYING'].includes(row.Phase) || !['PREPARING','APPLYING'].includes(attempt.Phase) ||
          Number(row.Generation) !== previous.generation || clean(row.ResetId) !== clean(previous.resetId) ||
          instant(row.LastResetAtUtc) !== instant(previous.lastResetAtUtc))) fail('REBATE_RESET_COORDINATOR_MISMATCH');
      return fn({ query, row, attempt, recorded, previous, next, complete });
    }, primary);
  }

  const initial = await coordinator(async s => {
    if (s.complete) return { complete:true };
    if (s.row.Phase !== s.attempt.Phase) fail('REBATE_RESET_COORDINATOR_MISMATCH');
    return { complete:false, previous:s.previous, next:s.next, actorId:Number(s.attempt.IdentityActorId), effectiveId:Number(s.attempt.IdentityEffectiveId) };
  });
  if (initial.complete) return { complete:true, replayed:true, targetCount:targets.length };

  const resolveIdentity = options.resolveBusinessIdentity || require('./rebate-reset-business-identity').resolveResetBusinessIdentity;
  async function mappingFor(target) {
    const mapped = await resolveIdentity({
      actorId: initial.actorId, effectiveId: initial.effectiveId, primaryTarget, target, db,
    });
    if (!Number.isSafeInteger(mapped?.businessActorId) || mapped.businessActorId < 1 || mapped.businessActorId > 2147483647 ||
        !Number.isSafeInteger(mapped?.businessEffectiveId) || mapped.businessEffectiveId < 1 || mapped.businessEffectiveId > 2147483647)
      fail('REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE');
    return mapped;
  }
  // Resolve every identity before entering APPLYING or writing a participant.
  const mappings = [];
  for (const target of targets) mappings.push(await mappingFor(target));
  const bound = await coordinator(async s => {
    if (s.complete) return { complete:true };
    if (s.row.Phase !== s.attempt.Phase) fail('REBATE_RESET_COORDINATOR_MISMATCH');
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i], mapped = mappings[i];
      const targetRow = s.recorded.find(r => clean(r.DatabaseName) === clean(target.database) && clean(r.ServerName) === clean(target.expectedServerName));
      if (!targetRow) fail('REBATE_RESET_MANIFEST_MISMATCH');
      if (targetRow.BusinessActorId == null && targetRow.BusinessEffectiveId == null) {
        const result = await s.query(`UPDATE wf.RebateResetAttemptTarget SET BusinessActorId=@actor,BusinessEffectiveId=@effective
          WHERE EnvironmentKind=@kind AND ResetId=@resetId AND DatabaseName=@database AND ServerName=@server
            AND BusinessActorId IS NULL AND BusinessEffectiveId IS NULL`,
        { kind, resetId, database: target.database, server: target.expectedServerName,
          actor: mapped.businessActorId, effective: mapped.businessEffectiveId });
        if (Number(result.rowsAffected?.[0]) !== 1) fail('REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE');
      } else if (Number(targetRow.BusinessActorId) !== mapped.businessActorId ||
          Number(targetRow.BusinessEffectiveId) !== mapped.businessEffectiveId) fail('REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE');
    }
    if (s.row.Phase === 'PREPARING') {
      const a = await s.query("UPDATE wf.RebateResetAttempt SET Phase='APPLYING' WHERE EnvironmentKind=@kind AND ResetId=@resetId AND Phase='PREPARING'", { kind, resetId });
      const c = await s.query("UPDATE wf.RebateResetCoordinator SET Phase='APPLYING',UpdatedAtUtc=GETUTCDATE() WHERE EnvironmentKind=@kind AND Phase='PREPARING'", { kind });
      if (Number(a.rowsAffected?.[0]) !== 1 || Number(c.rowsAffected?.[0]) !== 1) fail('REBATE_RESET_COORDINATOR_MISMATCH');
    } else if (s.row.Phase !== 'APPLYING') fail('REBATE_RESET_COORDINATOR_MISMATCH');
    return { complete:false };
  });
  if (bound.complete) return { complete:true, replayed:true, targetCount:targets.length };
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i], mapped = await mappingFor(target);
    if (mapped.businessActorId !== mappings[i].businessActorId || mapped.businessEffectiveId !== mappings[i].businessEffectiveId)
      fail('REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE');
    const input = { environment:kind, manifestDigest:digest, actorId:initial.actorId, effectiveId:initial.effectiveId,
      businessActorId:mapped.businessActorId, businessEffectiveId:mapped.businessEffectiveId,
      previous:initial.previous, next:initial.next, target:{ database:target.database, server:target.expectedServerName } };
    await db.runWithTarget('onprem', () => db.wfTransaction(tx =>
      (options.applyParticipant || applyResetParticipant)(transactionQuery(tx, db.sql), input)), target.name);
    await coordinator(async s => {
      if (s.complete) return;
      if (s.row.Phase !== 'APPLYING' || s.attempt.Phase !== 'APPLYING') fail('REBATE_RESET_COORDINATOR_MISMATCH');
      const result = await s.query(`UPDATE wf.RebateResetAttemptTarget SET ReceiptVerifiedAtUtc=GETUTCDATE()
        WHERE EnvironmentKind=@kind AND ResetId=@resetId AND DatabaseName=@database AND ServerName=@server`,
      { kind, resetId, database:target.database, server:target.expectedServerName });
      if (Number(result.rowsAffected?.[0]) !== 1) fail('REBATE_RESET_MANIFEST_MISMATCH');
    });
  }
  return coordinator(async s => {
    if (s.complete) return { complete:true, replayed:true, targetCount:targets.length };
    if (s.row.Phase !== 'APPLYING' || s.attempt.Phase !== 'APPLYING' || s.recorded.some(t => !t.ReceiptVerifiedAtUtc)) fail('REBATE_RESET_RECEIPTS_INCOMPLETE');
    const p = { kind, resetId, generation:s.next.generation, resetAt:s.next.lastResetAtUtc, previous:s.previous.generation, digest };
    const a = await s.query(`UPDATE wf.RebateResetAttempt SET Phase='COMPLETE',CompletedAtUtc=GETUTCDATE()
      WHERE EnvironmentKind=@kind AND ResetId=@resetId AND Phase='APPLYING'`, p);
    const c = await s.query(`UPDATE wf.RebateResetCoordinator SET Phase='READY',Generation=@generation,ResetId=@resetId,
      LastResetAtUtc=@resetAt,UpdatedAtUtc=GETUTCDATE() WHERE EnvironmentKind=@kind AND Phase='APPLYING'
      AND Generation=@previous AND ManifestDigest=@digest`, p);
    if (Number(a.rowsAffected?.[0]) !== 1 || Number(c.rowsAffected?.[0]) !== 1) fail('REBATE_RESET_COORDINATOR_MISMATCH');
    return { complete:true, replayed:false, targetCount:targets.length };
  });
}
module.exports = { recoverResetAttempt };
