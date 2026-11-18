'use strict';

// Absence is valid only when both the migration and the visible table are
// absent. Permission or migration/schema inconsistencies are never treated as
// an empty evidence queue.
async function nativeCutEvidenceAvailable(query) {
 let row;
 try {
  row=(await query(`SELECT 'NATIVE_CUT_EVIDENCE_SCHEMA_V1' AS EvidenceSchemaState,
    (SELECT COUNT(*) FROM wf.SchemaMigration WITH (HOLDLOCK) WHERE FileName='223_coupon_native_cut_evidence.sql') AS Ledger223,
    CASE WHEN OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NULL THEN 0 ELSE 1 END AS EvidenceVisible,
    HAS_PERMS_BY_NAME('wf','SCHEMA','SELECT') AS SchemaSelect,
    HAS_PERMS_BY_NAME('wf.CouponNativeCutEvidence','OBJECT','SELECT') AS EvidenceSelect`))?.recordset?.[0];
 } catch (_) { throw unavailable(); }
 if(!row||row.EvidenceSchemaState!=='NATIVE_CUT_EVIDENCE_SCHEMA_V1')throw unavailable();
 // Number(null) is zero. A missing or malformed metadata value must never be
 // interpreted as proof that migration and evidence are both absent.
 const flag=value=>value===0||value===1||value==='0'||value==='1'?Number(value):null;
 const ledger=flag(row.Ledger223),visible=flag(row.EvidenceVisible);
 if(ledger===0&&visible===0&&flag(row.SchemaSelect)===1)return false;
 if(ledger===1&&visible===1&&flag(row.EvidenceSelect)===1)return true;
 throw unavailable();
}
function unavailable(){return Object.assign(new Error('ไม่สามารถตรวจหลักฐานการตัดตั๋วได้ กรุณาติดต่อผู้ดูแล'),
 {code:'COUPON_NATIVE_EVIDENCE_SCHEMA_UNAVAILABLE',status:503});}
module.exports={nativeCutEvidenceAvailable};
