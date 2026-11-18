'use strict';

// Internal ledger prerequisite, not an HTTP endpoint and not an accrual.
// Call only inside the business transaction under the global reset fence.
// Lock native source before the evidence row, matching intake/review ordering.
const { lockShipmentSource } = require('./rebate-shipment-source');
const { resolveVerifiedTon } = require('./rebate-evidence-review');
const { acquireRebateParticipantFence } = require('./rebate-participant-fence');
const { parseEvidenceInstant } = require('./rebate-evidence-policy');

function fail(code) { throw Object.assign(new Error(code), { code, status: 409 }); }
function positiveId(n) { return Number.isSafeInteger(n) && n > 0 && n <= 2147483647; }
function milliseconds(v) {
  try { return parseEvidenceInstant(v); }
  catch (_) { fail('REBATE_EVIDENCE_TIME_INVALID'); }
}
function milliTon(value) {
  const s = String(value ?? '');
  if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/.test(s)) fail('REBATE_EVIDENCE_TONNAGE_INVALID');
  const [whole, fraction = ''] = s.split('.');
  const amount = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (amount <= 0n) fail('REBATE_EVIDENCE_TONNAGE_INVALID');
  return amount;
}

async function lockVerifiedShipment(query, epoch, { redemptionId, listNo } = {}, overrides = {}) {
  if (typeof query !== 'function' || !positiveId(redemptionId) || !positiveId(listNo) ||
      !['uat', 'production'].includes(epoch?.environment) || !Number.isSafeInteger(epoch?.generation) || epoch.generation < 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(epoch.resetId || '')) ||
      !epoch.lastResetAtUtc) fail('REBATE_EVIDENCE_EPOCH_INVALID');
  await (overrides.participantFence || acquireRebateParticipantFence)(query, epoch);
  const source = await (overrides.readSource || lockShipmentSource)(query, { redemptionId, listNo });
  const rows = (await query(`SELECT *,GETUTCDATE() AS ServerNowUtc FROM wf.RebateShipmentEvidence WITH(UPDLOCK,HOLDLOCK)
    WHERE EnvironmentKind=@environment AND ResetId=@resetId AND RedemptionId=@redemptionId AND RedemptionListNo=@listNo`,
  { environment: epoch.environment, resetId: epoch.resetId, redemptionId, listNo })).recordset || [];
  if (rows.length !== 1) fail('REBATE_EVIDENCE_NOT_FOUND');
  const row = rows[0];
  // AUTO_VERIFIED is reserved; no automatic verification contract exists yet.
  if (row.Status !== 'MANUALLY_VERIFIED') fail('REBATE_EVIDENCE_NOT_VERIFIED');
  if (!source || source.redemptionId !== redemptionId || source.redemptionListNo !== listNo ||
      !Array.isArray(source.issues) || source.issues.length || !/^[a-f0-9]{64}$/.test(String(source.fingerprint || '')) ||
      String(row.SourceFingerprint || '').trim() !== source.fingerprint) fail('REBATE_EVIDENCE_SOURCE_CHANGED');
  for (const [field, key] of [['CouponId','couponId'], ['SourceSOID','sourceSOID'], ['SourceListNo','sourceListNo'], ['GoodId','goodId']]) {
    if (!positiveId(source[key]) || Number(row[field]) !== source[key]) fail('REBATE_EVIDENCE_SOURCE_CHANGED');
  }
  if (milliseconds(row.OccurredAtUtc) <= milliseconds(epoch.lastResetAtUtc) ||
      milliseconds(row.OccurredAtUtc) > milliseconds(row.ServerNowUtc)) fail('REBATE_EVIDENCE_TIME_INVALID');
  if (!['ReviewedByPrimaryId','ReviewedByBusinessId','ReviewActorPrimaryId','ReviewActorBusinessId'].every(k => positiveId(Number(row[k]))) ||
      !String(row.ReviewReason || '').trim() || !row.ReviewedAtUtc) fail('REBATE_EVIDENCE_REVIEW_INVALID');
  const ton = await (overrides.resolveQuantityTon || resolveVerifiedTon)(query, source);
  if (milliTon(ton) !== milliTon(row.QuantityTon)) fail('REBATE_EVIDENCE_TONNAGE_CHANGED');
  const id = Number(row.Id), revision = Number(row.Revision);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(revision) || revision <= 0) fail('REBATE_EVIDENCE_INVALID');
  return { evidenceId: id, revision, redemptionId, redemptionListNo: listNo, sourceSOID: source.sourceSOID,
    sourceListNo: source.sourceListNo, couponId: source.couponId, goodId: source.goodId,
    quantityTon: String(ton), occurredAtUtc: new Date(milliseconds(row.OccurredAtUtc)) };
}

module.exports = { lockVerifiedShipment };
