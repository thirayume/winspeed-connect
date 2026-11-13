'use strict';

// Internal ingestion primitive, not scheduled or exposed by HTTP. Every item is
// held for human review. The caller must supply a known 116 line; discovery of
// missing-audit documents and the shipped-lot balance are separate prerequisites.
const db = require('../db');
const { transactionQuery } = require('./rebate-sql');
const { withRebateOperationFence } = require('./rebate-reset-fence');
const { acquireRebateParticipantFence } = require('./rebate-participant-fence');
const { lockShipmentSource } = require('./rebate-shipment-source');
const { resolveVerifiedTon } = require('./rebate-evidence-review');

function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
function positiveInt(value) { return Number.isSafeInteger(value) && value > 0 && value <= 2147483647; }
function validFingerprint(value) { return /^[a-f0-9]{64}$/.test(String(value || '')); }

async function stageShipmentEvidence({ redemptionId, listNo } = {}, overrides = {}) {
  if (!positiveInt(redemptionId) || !positiveInt(listNo)) fail('REBATE_SHIPMENT_SOURCE_INVALID', 400);
  const runFence = overrides.runFence || (fn => withRebateOperationFence(fn));
  const runTx = overrides.runTx || (fn => db.wfTransaction(tx => fn(transactionQuery(tx, db.sql))));
  const participantFence = overrides.participantFence || acquireRebateParticipantFence;
  const readSource = overrides.readSource || lockShipmentSource;
  const resolveQuantityTon = overrides.resolveQuantityTon || resolveVerifiedTon;
  return runFence(async epoch => {
    if (!epoch.resetId || !epoch.lastResetAtUtc) fail('REBATE_RESET_NOT_COMPLETED');
    return runTx(async query => {
      await participantFence(query, epoch);
      // This lock order matches evidence review: native source before queue row.
      const source = await readSource(query, { redemptionId, listNo });
      if (source.redemptionId !== redemptionId || source.redemptionListNo !== listNo ||
          !validFingerprint(source.fingerprint) || !Array.isArray(source.issues)) fail('REBATE_SHIPMENT_SOURCE_INVALID');
      let quantityTon = null;
      let holdReason = 'MANUAL_SHIPMENT_PROOF_REQUIRED';
      if (source.issues.length) holdReason = 'SOURCE_INCOMPLETE';
      else {
        try { quantityTon = await resolveQuantityTon(query, source); }
        catch (err) {
          if (!['REBATE_EVIDENCE_UNIT_MAPPING_UNAVAILABLE', 'REBATE_EVIDENCE_TONNAGE_INVALID', 'REBATE_EVIDENCE_SOURCE_INCOMPLETE'].includes(err?.code)) throw err;
          holdReason = 'UNIT_OR_QUANTITY_UNCONFIRMED';
        }
      }
      const key = { environment: epoch.environment, resetId: epoch.resetId, redemptionId, listNo };
      const rows = (await query(`SELECT Id,Status,Revision,SourceFingerprint FROM wf.RebateShipmentEvidence WITH(UPDLOCK,HOLDLOCK)
        WHERE EnvironmentKind=@environment AND ResetId=@resetId AND RedemptionId=@redemptionId AND RedemptionListNo=@listNo`, key)).recordset || [];
      if (rows.length > 1) fail('REBATE_EVIDENCE_DUPLICATE');
      if (rows.length) {
        if (String(rows[0].SourceFingerprint || '').trim() !== source.fingerprint) fail('REBATE_EVIDENCE_SOURCE_CHANGED');
        const id = Number(rows[0].Id), revision = Number(rows[0].Revision);
        if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(revision) || revision < 1) fail('REBATE_EVIDENCE_INVALID');
        return { id, status: rows[0].Status, revision, replayed: true };
      }
      const inserted = (await query(`INSERT INTO wf.RebateShipmentEvidence
        (EnvironmentKind,ResetId,RedemptionId,RedemptionListNo,CouponId,SourceSOID,SourceListNo,GoodId,QuantityTon,SourceFingerprint,Status,HoldReason)
        OUTPUT INSERTED.Id,INSERTED.Status,INSERTED.Revision
        VALUES (@environment,@resetId,@redemptionId,@listNo,@couponId,@sourceSOID,@sourceListNo,@goodId,CAST(@quantityTon AS decimal(18,3)),@fingerprint,'HELD',@holdReason)`, {
        ...key, couponId: source.couponId, sourceSOID: source.sourceSOID, sourceListNo: source.sourceListNo,
        goodId: source.goodId, quantityTon, fingerprint: source.fingerprint, holdReason,
      })).recordset?.[0];
      const id = Number(inserted?.Id), revision = Number(inserted?.Revision);
      if (!Number.isSafeInteger(id) || id < 1 || inserted?.Status !== 'HELD' || revision !== 1) fail('REBATE_EVIDENCE_RECEIPT_INVALID');
      return { id, status: 'HELD', revision, replayed: false };
    });
  });
}

module.exports = { stageShipmentEvidence };
