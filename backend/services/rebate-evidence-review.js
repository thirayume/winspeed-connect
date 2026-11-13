'use strict';

// Prepared transaction service only: deliberately not mounted as an HTTP API.
// The queue ingestion, reset coordinator and shipped-lot ledger must be ready
// and tested together before exposing this operation.
const db = require('../db');
const { transactionQuery } = require('./rebate-sql');
const { withRebateOperationFence } = require('./rebate-reset-fence');
const { acquireRebateParticipantFence } = require('./rebate-participant-fence');
const { lockShipmentSource } = require('./rebate-shipment-source');
const { reviewEvidence } = require('./rebate-evidence-policy');
const { approvalIdentity } = require('./approval-identity');
const { businessIds, actorPerspective } = require('./business-identity');
const { hasPermission } = require('./role-capabilities');
const { getVisibleScope, inScope } = require('./visible-scope');

function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
function positive(n) { return Number.isSafeInteger(n) && n > 0; }
function tonsMilli(value) {
  const text = String(value ?? '');
  if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/.test(text)) fail('REBATE_EVIDENCE_TONNAGE_INVALID');
  const [whole, fraction = ''] = text.split('.');
  const result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (result <= 0n) fail('REBATE_EVIDENCE_TONNAGE_INVALID');
  return result;
}

// The only automatic interpretation implemented so far is an exact native
// tonne unit. Everything else remains in the review queue: do not infer bag
// weights or use a fallback unit. A physical-shipment verification is still a
// separate reviewer decision.
async function resolveVerifiedTon(query, source) {
  if (!source || !Array.isArray(source.issues) || source.issues.length || !positive(source.goodUnitId)) {
    fail('REBATE_EVIDENCE_SOURCE_INCOMPLETE');
  }
  const units = (await query(`SELECT GoodUnitID,GoodUnitCode,GoodUnitName FROM dbo.EMGoodUnit WITH(UPDLOCK,HOLDLOCK)
    WHERE GoodUnitID=@unitId`, { unitId: source.goodUnitId })).recordset || [];
  const unit = units[0];
  if (units.length !== 1 || Number(unit.GoodUnitID) !== source.goodUnitId ||
      String(unit.GoodUnitCode || '').trim() !== 'ตัน' || String(unit.GoodUnitName || '').trim() !== 'ตัน') {
    fail('REBATE_EVIDENCE_UNIT_MAPPING_UNAVAILABLE', 503);
  }
  tonsMilli(source.quantity);
  return source.quantity;
}

async function reviewShipmentEvidence(user, payload, overrides = {}) {
  const id = Number(payload?.id), expectedRevision = Number(payload?.expectedRevision);
  if (!positive(id) || !positive(expectedRevision) || !['VERIFY', 'REJECT'].includes(payload?.decision)) fail('REBATE_EVIDENCE_REQUEST_INVALID', 400);
  const identity = approvalIdentity(user);
  const actor = identity.impersonating ? { role: user.actorRole, roles: user.actorRoles,
    permissions: user.actorPermissions, disabledActions: user.actorDisabledActions } : user;
  if (!hasPermission(user, 'rebate.evidence.verify') || !hasPermission(actor, 'rebate.evidence.verify')) fail('REBATE_EVIDENCE_PERMISSION_REQUIRED', 403);
  const business = businessIds(user);
  if (!business.actor || !business.effective) fail('INVALID_APPROVAL_IDENTITY', 401);
  const runFence = overrides.runFence || ((fn) => withRebateOperationFence(fn));
  const runTx = overrides.runTx || (fn => db.wfTransaction(tx => fn(transactionQuery(tx, db.sql))));
  const participantFence = overrides.participantFence || acquireRebateParticipantFence;
  const readSource = overrides.readSource || lockShipmentSource;
  return runFence(async epoch => {
    if (!epoch.resetId || !epoch.lastResetAtUtc) fail('REBATE_RESET_NOT_COMPLETED');
    return runTx(async query => {
      await participantFence(query, epoch);
      // Discover immutable source keys first, then lock source before queue row
      // to maintain the common ingestion/review lock order.
      const key = (await query(`SELECT RedemptionId,RedemptionListNo FROM wf.RebateShipmentEvidence
        WHERE Id=@id AND EnvironmentKind=@environment AND ResetId=@resetId`,
      { id, environment: epoch.environment, resetId: epoch.resetId })).recordset?.[0];
      if (!key) fail('REBATE_EVIDENCE_NOT_FOUND', 404);
      const source = await readSource(query, { redemptionId: Number(key.RedemptionId), listNo: Number(key.RedemptionListNo) });
      if (overrides.authorizeSource) await overrides.authorizeSource(query, source);
      // Verify organizational scope of both real and effective identities in
      // the selected business DB. Unknown ownership remains admin-only.
      const scopeReader=overrides.getVisibleScope || getVisibleScope;
      const effectiveScope=await scopeReader(user,query),actorScope=await scopeReader(actorPerspective(user),query);
      if(!effectiveScope.all || !actorScope.all) {
        if(!positive(Number(source.sourceSOID))) fail('REBATE_EVIDENCE_NOT_FOUND',404);
        const owner=(await query(`SELECT EmpID FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK)
          WHERE SOID=@sourceSOID AND DocuType=104`,{sourceSOID:Number(source.sourceSOID)})).recordset?.[0];
        if(!owner || !inScope(effectiveScope,{empId:owner.EmpID}) || !inScope(actorScope,{empId:owner.EmpID}))
          fail('REBATE_EVIDENCE_NOT_FOUND',404);
      }
      const row = (await query(`SELECT *,GETUTCDATE() AS ServerNowUtc FROM wf.RebateShipmentEvidence WITH(UPDLOCK,HOLDLOCK)
        WHERE Id=@id AND EnvironmentKind=@environment AND ResetId=@resetId`,
      { id, environment: epoch.environment, resetId: epoch.resetId })).recordset?.[0];
      if (!row) fail('REBATE_EVIDENCE_NOT_FOUND', 404);
      if (Number(row.RedemptionId) !== source.redemptionId || Number(row.RedemptionListNo) !== source.redemptionListNo ||
          Number(row.Revision) !== expectedRevision) fail('REBATE_EVIDENCE_STALE');
      if (payload.decision === 'VERIFY') {
        // Never assume native GoodQty is tonnes or trust the stored value alone.
        // Resolve from the locked native unit, never from the browser.
        const authoritativeTon = await (overrides.resolveQuantityTon || resolveVerifiedTon)(query, source);
        if (tonsMilli(authoritativeTon) !== tonsMilli(row.QuantityTon)) fail('REBATE_EVIDENCE_TONNAGE_CHANGED');
      }
      const reviewer = { primaryId: identity.effectiveId, businessId: business.effective,
        actorPrimaryId: identity.actorId, actorBusinessId: business.actor };
      const result = reviewEvidence({ evidence: { status: row.Status, sourceFingerprint: String(row.SourceFingerprint || '').trim(),
        revision: Number(row.Revision), quantityTon: row.QuantityTon }, currentFingerprint: source.fingerprint,
      currentSourceIssues: source.issues, resetAtUtc: epoch.lastResetAtUtc, serverNowUtc: row.ServerNowUtc,
      occurredAtUtc: payload.occurredAtUtc, reason: payload.reason, reviewer, decision: payload.decision, mayVerify: true });
      const updated = await query(`UPDATE wf.RebateShipmentEvidence SET Status=@status,OccurredAtUtc=@occurred,
        ReviewReason=@reason,ReviewedByPrimaryId=@primaryId,ReviewedByBusinessId=@businessId,
        ReviewActorPrimaryId=@actorPrimaryId,ReviewActorBusinessId=@actorBusinessId,
        ReviewedAtUtc=GETUTCDATE(),UpdatedAtUtc=GETUTCDATE(),Revision=Revision+1
        WHERE Id=@id AND EnvironmentKind=@environment AND ResetId=@resetId AND Status='HELD' AND Revision=@revision
          AND SourceFingerprint=@fingerprint`, {
        id, environment: epoch.environment, resetId: epoch.resetId, revision: result.expectedRevision,
        fingerprint: source.fingerprint, status: result.status, occurred: result.occurredAtUtc || null,
        reason: result.reviewReason, ...reviewer,
      });
      if (Number(updated.rowsAffected?.[0]) !== 1) fail('REBATE_EVIDENCE_STALE');
      let accrual;
      if(payload.decision==='VERIFY' && process.env.REBATE_POOL_103_ENABLED==='true') {
        // Verification and credit must commit together. If the 103 snapshot
        // is missing or any source changed, the review transaction rolls back.
        const accrue=overrides.accrue || require('./rebate-shipment-accrual').accrueVerifiedShipment;
        accrual=await accrue(query,epoch,{redemptionId:source.redemptionId,listNo:source.redemptionListNo});
      }
      return { id, status: result.status, revision: result.expectedRevision + 1, ...(accrual ? {accrual} : {}) };
    });
  });
}

module.exports = { reviewShipmentEvidence, resolveVerifiedTon };
