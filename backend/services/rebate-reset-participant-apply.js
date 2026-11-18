'use strict';

// Internal participant transaction primitive. Do not expose this directly:
// the coordinator must first persist a global non-READY phase under its
// exclusive lock, and every Rebate reader/writer must use both fences.
// The caller owns the SQL transaction and must roll back on every error.
const { LOCK } = require('./rebate-participant-fence');
const { epoch } = require('./rebate-reset-epoch');
function fail(code) { throw Object.assign(new Error(code), { code, status: 409 }); }
const clean = value => String(value || '').trim().toLowerCase();
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
function sameTime(a, b) { return a == null && b == null || a != null && b != null && new Date(a).getTime() === new Date(b).getTime(); }
function matches(row, value) {
  return row.Generation != null && Number(row.Generation) === value.generation && clean(row.ResetId) === clean(value.resetId) && sameTime(row.LastResetAtUtc, value.lastResetAtUtc);
}

async function applyResetParticipant(query, input = {}) {
  if (typeof query !== 'function' || !['uat', 'production'].includes(input.environment) ||
      !/^[a-f0-9]{64}$/.test(String(input.manifestDigest || '')) || !positive(input.actorId) || !positive(input.effectiveId) ||
      !input.target || !clean(input.target.database) || !clean(input.target.server)) fail('REBATE_RESET_INPUT_INVALID');
  const previous = epoch(input.previous), next = epoch(input.next);
  if (next.generation !== previous.generation + 1 || next.generation > 2147483647 ||
      (previous.lastResetAtUtc && next.lastResetAtUtc <= previous.lastResetAtUtc)) fail('REBATE_RESET_EPOCH_INVALID');
  const p = { environment: input.environment, digest: input.manifestDigest, actor: input.actorId, effective: input.effectiveId,
    resetId: next.resetId, resetAt: next.lastResetAtUtc, newGeneration: next.generation,
    oldGeneration: previous.generation, oldResetId: previous.resetId, oldResetAt: previous.lastResetAtUtc };
  const actual = (await query('SELECT DB_NAME() AS DatabaseName, CAST(@@SERVERNAME AS nvarchar(128)) AS ServerName', {})).recordset?.[0];
  if (!actual || clean(actual.DatabaseName) !== clean(input.target.database) || clean(actual.ServerName) !== clean(input.target.server)) fail('REBATE_RESET_TARGET_IDENTITY_MISMATCH');
  const lock = (await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
    @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`, { resource: LOCK })).recordset?.[0]?.LockResult;
  if (!Number.isInteger(lock) || lock < 0) fail('REBATE_RESET_PARTICIPANT_LOCK_UNAVAILABLE');
  const participant = (await query(`SELECT EnvironmentKind,ManifestDigest,Generation,Phase,ResetId,LastResetAtUtc
    FROM wf.RebateResetParticipant WITH(UPDLOCK,HOLDLOCK) WHERE EnvironmentKind=@environment`, p)).recordset?.[0];
  if (!participant || clean(participant.EnvironmentKind) !== input.environment || clean(participant.ManifestDigest) !== input.manifestDigest || participant.Phase !== 'READY') fail('REBATE_RESET_PARTICIPANT_MISMATCH');
  const receipt = (await query(`SELECT * FROM wf.RebateResetReceipt WITH(UPDLOCK,HOLDLOCK)
    WHERE EnvironmentKind=@environment AND ResetId=@resetId`, p)).recordset?.[0];
  if (receipt) {
    if (!matches(participant, next) || clean(receipt.ManifestDigest) !== input.manifestDigest ||
        Number(receipt.PreviousGeneration) !== previous.generation || clean(receipt.PreviousResetId) !== clean(previous.resetId) ||
        !sameTime(receipt.PreviousResetAtUtc, previous.lastResetAtUtc) || Number(receipt.NewGeneration) !== next.generation ||
        !sameTime(receipt.ResetAtUtc, next.lastResetAtUtc) || Number(receipt.IdentityActorId) !== input.actorId ||
        Number(receipt.IdentityEffectiveId) !== input.effectiveId || !Number.isSafeInteger(Number(receipt.CancelledClaimCount)) || Number(receipt.CancelledClaimCount) < 0) fail('REBATE_RESET_RECEIPT_CONFLICT');
    return { replayed: true, cancelledClaims: Number(receipt.CancelledClaimCount) };
  }
  if (!matches(participant, previous)) fail('REBATE_RESET_PARTICIPANT_MISMATCH');
  // An interrupted conversion request needs its own audited resolution before
  // reset; never delete a receipt or an already-issued ticket here.
  const incomplete = (await query(`SELECT TOP 1 RequestId FROM wf.RebateConversionRequest WITH(UPDLOCK,HOLDLOCK)
    WHERE ConversionId IS NULL OR CompletedAt IS NULL`, {})).recordset || [];
  if (incomplete.length) fail('REBATE_RESET_INCOMPLETE_CONVERSION');
  const unknown = (await query(`SELECT TOP 1 Id FROM wf.RebateClaim WITH(UPDLOCK,HOLDLOCK)
    WHERE Status IS NULL OR Status NOT IN (N'DRAFT',N'PENDING',N'TIER2_PENDING',N'TIER3_PENDING',N'TIER4_PENDING',
      N'APPROVED',N'REJECTED',N'CN_ISSUED',N'CANCELLED')`, {})).recordset || [];
  if (unknown.length) fail('REBATE_RESET_UNKNOWN_CLAIM_STATUS');
  await query(`INSERT wf.RebateResetReceipt(EnvironmentKind,ResetId,ManifestDigest,PreviousGeneration,PreviousResetId,
    PreviousResetAtUtc,NewGeneration,ResetAtUtc,IdentityActorId,IdentityEffectiveId,CancelledClaimCount)
    VALUES(@environment,@resetId,@digest,@oldGeneration,@oldResetId,@oldResetAt,@newGeneration,@resetAt,@actor,@effective,0)`, p);
  const result = await query(`DECLARE @cancelled TABLE(ClaimId int NOT NULL,PreviousStatus nvarchar(20) NOT NULL,PreviousTier int NULL);
    UPDATE wf.RebateClaim SET Status=N'CANCELLED'
    OUTPUT DELETED.Id,DELETED.Status,DELETED.CurrentTier INTO @cancelled(ClaimId,PreviousStatus,PreviousTier)
    WHERE Status IN (N'DRAFT',N'PENDING',N'TIER2_PENDING',N'TIER3_PENDING',N'TIER4_PENDING');
    INSERT wf.RebateResetClaimCancellation(EnvironmentKind,ResetId,ClaimId,PreviousStatus,PreviousTier)
      SELECT @environment,@resetId,ClaimId,PreviousStatus,PreviousTier FROM @cancelled;
    SELECT COUNT(*) AS CancelledClaimCount FROM @cancelled;`, p);
  const count = Number(result.recordset?.[0]?.CancelledClaimCount);
  if (!Number.isSafeInteger(count) || count < 0) fail('REBATE_RESET_RECEIPT_INVALID');
  const receiptUpdate = await query(`UPDATE wf.RebateResetReceipt SET CancelledClaimCount=@count
    WHERE EnvironmentKind=@environment AND ResetId=@resetId`, { ...p, count });
  if (Number(receiptUpdate.rowsAffected?.[0]) !== 1) fail('REBATE_RESET_RECEIPT_INVALID');
  const updated = await query(`UPDATE wf.RebateResetParticipant SET Generation=@newGeneration,ResetId=@resetId,
    LastResetAtUtc=@resetAt,UpdatedAtUtc=GETUTCDATE() WHERE EnvironmentKind=@environment AND Phase='READY'
    AND ManifestDigest=@digest AND Generation=@oldGeneration
    AND ((ResetId=@oldResetId) OR (ResetId IS NULL AND @oldResetId IS NULL))
    AND ((LastResetAtUtc=@oldResetAt) OR (LastResetAtUtc IS NULL AND @oldResetAt IS NULL))`, p);
  if (Number(updated.rowsAffected?.[0]) !== 1) fail('REBATE_RESET_PARTICIPANT_MISMATCH');
  return { replayed: false, cancelledClaims: count };
}
module.exports = { applyResetParticipant };
