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
 HAS_PERMS_BY_NAME('wf.CouponBridgeEffectiveSettlement','OBJECT','SELECT') AS BridgeViewSelect`;
const unavailable=()=>Object.assign(Error('ไม่สามารถตรวจโครงสร้าง bridge ตั๋วได้'),{code:'COUPON_BRIDGE_SCHEMA_UNAVAILABLE',status:503});
function available(row){
 const flag=v=>[0,1,'0','1'].includes(v)?Number(v):null;
 const objects=['BridgeLedger','BridgePermit','BridgeLine','BridgeReturn','BridgeView'].map(k=>flag(row?.[k]));
 if(objects.every(v=>v===0)&&flag(row?.BridgeSchemaSelect)===1)return false;
 if(objects.every(v=>v===1)&&['BridgePermitSelect','BridgeLineSelect','BridgeReturnSelect','BridgeViewSelect'].every(k=>flag(row?.[k])===1))return true;
 throw unavailable();
}
module.exports={fields,available,unavailable};
