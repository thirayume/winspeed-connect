'use strict';

// Unreleased recovery can affect opening balances, so this gate is independent
// of the display cutoff. A reviewed release switches balance calculations to
// the effective settlement view while retaining the original ledger.
const ORIGINAL_SETTLEMENT = 'wf.CouponReservationSettlement';
const EFFECTIVE_SETTLEMENT = 'wf.CouponEffectiveSettlement';
const bridgeSchema=require('./coupon-bridge-schema');
function unavailable() {
  return Object.assign(new Error('ไม่สามารถตรวจข้อมูลการคืนยอดตั๋วได้ กรุณาติดต่อผู้ดูแล'),
    {code:'COUPON_RECOVERY_SCHEMA_UNAVAILABLE',status:503});
}
async function resolveRecoverySupport(query) {
  let metadata;
  try {
    metadata=(await query(`SELECT 'COUPON_RECOVERY_READINESS_V1' AS RecoverySchemaState,
      (SELECT COUNT(*) FROM wf.SchemaMigration WITH (HOLDLOCK) WHERE FileName='231_coupon_native_recovery_ledger.sql') AS Ledger231,
      CASE WHEN OBJECT_ID('wf.CouponNativeRecovery','U') IS NULL THEN 0 ELSE 1 END AS RecoveryVisible,
      HAS_PERMS_BY_NAME('wf','SCHEMA','SELECT') AS SchemaSelect,
      HAS_PERMS_BY_NAME('wf.CouponNativeRecovery','OBJECT','SELECT') AS RecoverySelect,
      (SELECT COUNT(*) FROM wf.SchemaMigration WITH (HOLDLOCK) WHERE FileName='232_coupon_native_edit_hold.sql') AS Ledger232,
      CASE WHEN OBJECT_ID('wf.CouponNativeEditHold','U') IS NULL THEN 0 ELSE 1 END AS EditHoldVisible,
      HAS_PERMS_BY_NAME('wf.CouponNativeEditHold','OBJECT','SELECT') AS EditHoldSelect,
      ${bridgeSchema.fields}`))?.recordset?.[0];
  } catch (_) { throw unavailable(); }
  if (!metadata || metadata.RecoverySchemaState !== 'COUPON_RECOVERY_READINESS_V1') throw unavailable();
  const flag = value => value === 0 || value === 1 || value === '0' || value === '1' ? Number(value) : null;
  const ledger=flag(metadata.Ledger231), visible=flag(metadata.RecoveryVisible);
  const editLedger=flag(metadata.Ledger232), editVisible=flag(metadata.EditHoldVisible);
  const schemaSelect=flag(metadata.SchemaSelect);
  const legacyRecovery=ledger===0 && visible===0 && schemaSelect===1;
  const currentRecovery=ledger===1 && visible===1 && flag(metadata.RecoverySelect)===1;
  const legacyEdit=editLedger===0 && editVisible===0 && schemaSelect===1;
  const currentEdit=editLedger===1 && editVisible===1 && flag(metadata.EditHoldSelect)===1;
  if ((!legacyRecovery && !currentRecovery) || (!legacyEdit && !currentEdit) ||
      (currentEdit && !currentRecovery)) throw unavailable();
  const bridge=bridgeSchema.available(metadata);
  if(bridge&&(!currentRecovery||!currentEdit))throw unavailable();
  return { currentRecovery, currentEdit, bridge };
}

async function assertRecoveryReadiness(query, { pendingOnly = false } = {}) {
  const { currentRecovery, currentEdit, bridge } = await resolveRecoverySupport(query);
  if(bridge){
    let rows;
    try{rows=(await query(`SELECT TOP 1 1 AS PendingCouponBridge FROM wf.CouponBridgePermit WITH(HOLDLOCK)
      WHERE State IN('STARTED','COMPLETE') AND ReleasedAtUtc IS NULL`))?.recordset;}catch(_){throw unavailable();}
    if(!Array.isArray(rows))throw unavailable();
    if(rows.length)throw Object.assign(Error('ใบขนอยู่ระหว่างกู้คืนหรือตรวจปล่อยยอด'),{code:'COUPON_BRIDGE_REVIEW_REQUIRED',status:409});
  }
  let reviewedRelease = false;
  if (currentEdit) {
    let release;
    try {
      release = (await query(`SELECT 'COUPON_RELEASE_SCHEMA_V1' AS ReleaseSchemaState,
        (SELECT COUNT(*) FROM wf.SchemaMigration WITH (HOLDLOCK) WHERE FileName='236_coupon_recovery_reviewed_release.sql') AS Ledger236,
        CASE WHEN OBJECT_ID('wf.CouponEffectiveSettlement','V') IS NULL THEN 0 ELSE 1 END AS ViewVisible,
        HAS_PERMS_BY_NAME('wf.CouponEffectiveSettlement','OBJECT','SELECT') AS ViewSelect,
        HAS_PERMS_BY_NAME('wf.CouponNativeEditRelease','OBJECT','SELECT') AS ReleaseSelect`))?.recordset?.[0];
    } catch (_) { throw unavailable(); }
    if (release?.ReleaseSchemaState!=='COUPON_RELEASE_SCHEMA_V1') throw unavailable();
    reviewedRelease=release.Ledger236===1 && release.ViewVisible===1 && release.ViewSelect===1 && release.ReleaseSelect===1;
    if (!reviewedRelease && (release.Ledger236!==0 || release.ViewVisible!==0)) throw unavailable();
    let held;
    try { held=(await query(`SELECT TOP 1 1 AS PendingNativeEdit FROM wf.CouponNativeEditHold h WITH (HOLDLOCK)
      ${reviewedRelease ? 'WHERE NOT EXISTS (SELECT 1 FROM wf.CouponNativeEditRelease x WITH (HOLDLOCK) WHERE x.EditId=h.EditId)' : ''}`))?.recordset; }
    catch (_) { throw unavailable(); }
    if (!Array.isArray(held)) throw unavailable();
    if (held.length) throw Object.assign(new Error('พบใบขนที่มียอดตั๋วรอตรวจสอบ กรุณาติดต่อผู้ดูแลก่อนใช้หรือเปลี่ยนยอดตั๋ว'),
      {code:'COUPON_NATIVE_EDIT_HOLD_REVIEW_REQUIRED',status:409});
  }
  if(bridge&&!reviewedRelease)throw unavailable();
  const settlementSource=bridge?'wf.CouponBridgeEffectiveSettlement':reviewedRelease ? EFFECTIVE_SETTLEMENT : ORIGINAL_SETTLEMENT;
  if (pendingOnly || !currentRecovery) return settlementSource;
  let records;
  try { records=(await query(`SELECT TOP 1 1 AS RecoveryExists FROM wf.CouponNativeRecovery r WITH (HOLDLOCK)
    ${reviewedRelease ? `WHERE NOT EXISTS (SELECT 1 FROM wf.CouponNativeEditHold h WITH (HOLDLOCK)
      JOIN wf.CouponNativeEditRelease x WITH (HOLDLOCK) ON x.EditId=h.EditId
      WHERE h.AuthorizationLineId=r.AuthorizationLineId AND h.PlannedSettlementId=r.SettlementId
        AND r.RecoveryKey=CONVERT(varchar(36),h.EditId)+':'+CONVERT(varchar(20),r.SettlementId))` : ''}`))?.recordset; }
  catch (_) { throw unavailable(); }
  if (!Array.isArray(records)) throw unavailable();
  if (records.length) throw Object.assign(new Error('พบรายการคืนยอดที่ต้องตรวจสอบ กรุณาติดต่อผู้ดูแลก่อนใช้ตั๋ว'),
    {code:'COUPON_RECOVERY_REVIEW_REQUIRED',status:409});
  return settlementSource;
}
module.exports={assertRecoveryReadiness,resolveRecoverySupport};
