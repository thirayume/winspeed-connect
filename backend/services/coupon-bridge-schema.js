'use strict';
const fields=`
 (SELECT COUNT(*) FROM wf.SchemaMigration WITH(HOLDLOCK) WHERE FileName='270_coupon_bridge_contract.sql') AS BridgeLedger,
 CASE WHEN OBJECT_ID('wf.CouponBridgePermit','U') IS NULL THEN 0 ELSE 1 END AS BridgePermit,
 CASE WHEN OBJECT_ID('wf.CouponBridgeLine','U') IS NULL THEN 0 ELSE 1 END AS BridgeLine,
 CASE WHEN OBJECT_ID('wf.CouponBridgeReturn','U') IS NULL THEN 0 ELSE 1 END AS BridgeReturn,
 CASE WHEN OBJECT_ID('wf.CouponBridgeEffectiveSettlement','V') IS NULL THEN 0 ELSE 1 END AS BridgeView,
 HAS_PERMS_BY_NAME('wf','SCHEMA','SELECT') AS BridgeSchemaSelect,
 HAS_PERMS_BY_NAME('wf.CouponBridgePermit','OBJECT','SELECT') AS BridgePermitSelect,
 HAS_PERMS_BY_NAME('wf.CouponBridgeLine','OBJECT','SELECT') AS BridgeLineSelect,
 HAS_PERMS_BY_NAME('wf.CouponBridgeReturn','OBJECT','SELECT') AS BridgeReturnSelect,
 HAS_PERMS_BY_NAME('wf.CouponBridgeEffectiveSettlement','OBJECT','SELECT') AS BridgeViewSelect,
 (SELECT COUNT(*) FROM wf.SchemaMigration WITH(HOLDLOCK) WHERE FileName='284_native_116_connection_stage.sql') AS NativeStageLedger,
 (SELECT COUNT(*) FROM wf.SchemaMigration WITH(HOLDLOCK) WHERE FileName='285_native_116_audit_admission.sql') AS NativeAdmissionLedger,
 (SELECT COUNT(*) FROM wf.SchemaMigration WITH(HOLDLOCK) WHERE FileName='287_native_116_reviewed_recovery.sql') AS NativeRecoveryLedger,
 (SELECT COUNT(*) FROM wf.SchemaMigration WITH(HOLDLOCK) WHERE FileName='288_native_116_floor_set_options.sql') AS NativeSetOptionsLedger,
 (SELECT COUNT(*) FROM wf.SchemaMigration WITH(HOLDLOCK) WHERE FileName='289_native_116_retired_id_ranges.sql') AS NativeIdRangeLedger,
 CASE WHEN OBJECT_ID('wf.sp_Native116RecoverBefore','P') IS NULL THEN 0 ELSE 1 END AS NativeRecoveryVisible,
 HAS_PERMS_BY_NAME('wf.sp_Native116RecoverBefore','OBJECT','EXECUTE') AS NativeRecoveryExecute,
 CASE WHEN OBJECT_ID('wf.Native116Stage','U') IS NULL THEN 0 ELSE 1 END AS NativeStageVisible,
 CASE WHEN OBJECT_ID('wf.Native116StageCoupon','U') IS NULL THEN 0 ELSE 1 END AS NativeStageCouponVisible,
 CASE WHEN OBJECT_ID('wf.Native116AuditReceipt','U') IS NULL THEN 0 ELSE 1 END AS NativeStageReceiptVisible,
 HAS_PERMS_BY_NAME('wf.Native116Stage','OBJECT','SELECT') AS NativeStageSelect,
 HAS_PERMS_BY_NAME('wf.Native116StageCoupon','OBJECT','SELECT') AS NativeStageCouponSelect,
 HAS_PERMS_BY_NAME('wf.Native116AuditReceipt','OBJECT','SELECT') AS NativeStageReceiptSelect`;
const unavailable=()=>Object.assign(Error('ไม่สามารถตรวจโครงสร้าง bridge ตั๋วได้'),{code:'COUPON_BRIDGE_SCHEMA_UNAVAILABLE',status:503});
function available(row){
 const flag=v=>[0,1,'0','1'].includes(v)?Number(v):null;
 const objects=['BridgeLedger','BridgePermit','BridgeLine','BridgeReturn','BridgeView'].map(k=>flag(row?.[k]));
 if(objects.every(v=>v===0)&&flag(row?.BridgeSchemaSelect)===1)return false;
 if(objects.every(v=>v===1)&&['BridgePermitSelect','BridgeLineSelect','BridgeReturnSelect','BridgeViewSelect'].every(k=>flag(row?.[k])===1))return true;
 throw unavailable();
}
function directAvailable(row){
 const flag=v=>[0,1,'0','1'].includes(v)?Number(v):null;
 const objects=['NativeStageLedger','NativeAdmissionLedger','NativeRecoveryLedger','NativeSetOptionsLedger','NativeIdRangeLedger','NativeRecoveryVisible','NativeStageVisible','NativeStageCouponVisible','NativeStageReceiptVisible'].map(k=>flag(row?.[k]));
 if(objects.every(v=>v===0)&&flag(row?.BridgeSchemaSelect)===1)return false;
 if(objects.every(v=>v===1)&&['NativeStageSelect','NativeStageCouponSelect','NativeStageReceiptSelect','NativeRecoveryExecute'].every(k=>flag(row?.[k])===1)&&available(row))return true;
 throw unavailable();
}
module.exports={fields,available,directAvailable,unavailable};
