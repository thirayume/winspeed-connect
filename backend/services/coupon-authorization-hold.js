'use strict';
const {sql}=require('../db');
const {assertRecoveryReadiness}=require('./coupon-recovery-readiness');
const bridgeSchema=require('./coupon-bridge-schema');

async function assertNoPendingEdit(tx) {
  await assertRecoveryReadiness(text=>tx.request().query(text),{pendingOnly:true});
}

// A database without migration 220 cannot have app-issued native cut
// authorizations. Never infer absence from metadata alone: check the ledger,
// schema visibility and object permissions together on the selected database.
async function authorizationHoldsAvailable(query,withBridge=false) {
  let row;
  try {
    row=(await query(`SELECT 'NATIVE_HOLD_SCHEMA_V1' AS NativeHoldSchemaState,
      (SELECT COUNT(*) FROM wf.SchemaMigration WITH (HOLDLOCK) WHERE FileName='220_coupon_native_authorization.sql') AS Ledger220,
      CASE WHEN OBJECT_ID('wf.CouponNativeCutAuthorization','U') IS NULL THEN 0 ELSE 1 END AS HeaderVisible,
      CASE WHEN OBJECT_ID('wf.CouponNativeCutAuthorizationLine','U') IS NULL THEN 0 ELSE 1 END AS LineVisible,
      HAS_PERMS_BY_NAME('wf','SCHEMA','SELECT') AS SchemaSelect,
      HAS_PERMS_BY_NAME('wf.CouponNativeCutAuthorization','OBJECT','SELECT') AS HeaderSelect,
      HAS_PERMS_BY_NAME('wf.CouponNativeCutAuthorizationLine','OBJECT','SELECT') AS LineSelect,
      ${bridgeSchema.fields}`))?.recordset?.[0];
  } catch (_) { throw unavailable(); }
  if (!row || row.NativeHoldSchemaState!=='NATIVE_HOLD_SCHEMA_V1') throw unavailable();
  // Null/missing metadata is unknown, not proof that no authorization exists.
  const flag=value=>value===0||value===1||value==='0'||value==='1'?Number(value):null;
  const ledger=flag(row.Ledger220),head=flag(row.HeaderVisible),line=flag(row.LineVisible);
  const bridge=bridgeSchema.available(row);
  if(ledger===0 && head===0 && line===0 && flag(row.SchemaSelect)===1&&!bridge)return withBridge?{auth:false,bridge}:false;
  if(ledger===1 && head===1 && line===1 && flag(row.HeaderSelect)===1 && flag(row.LineSelect)===1)return withBridge?{auth:true,bridge}:true;
  throw unavailable();
}

function unavailable(){return Object.assign(new Error('ไม่สามารถตรวจข้อมูลใบอนุญาตตัดตั๋วได้ กรุณาติดต่อผู้ดูแล'),{code:'COUPON_AUTH_HOLD_SCHEMA_UNAVAILABLE',status:503});}

async function resolveHoldPolicy(query) {
  const {auth,bridge}=await authorizationHoldsAvailable(query,true);
  const evidence=await require('./coupon-native-cut-evidence').nativeCutEvidenceAvailable(query);
  if(evidence&&!auth)throw unavailable();
  return {auth,evidence,bridge};
}

function heldAuthorizationPredicate(lineAlias,headerAlias,policy,locked=false){
  const normal=`${headerAlias}.State='ACTIVE'`;
  if(!policy?.evidence)return normal;
  const hints=locked?' WITH (UPDLOCK,HOLDLOCK)':'';
  // Even a closed authorization with durable native evidence remains held
  // until an explicit, audited recovery procedure proves how to resolve it.
  return `(${normal} OR EXISTS (SELECT 1 FROM wf.CouponNativeCutEvidence nce${hints} WHERE nce.AuthorizationLineId=${lineAlias}.Id))`;
}

// Only trusted code supplies the identifier; no user input is embedded in SQL.
// Locked variant is for a transaction already holding the native coupon row.
function heldReservationExpirySql(alias, available, locked=false) {
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(alias))throw new TypeError('invalid SQL alias');
  const normal=`${alias}.ExpiresAt IS NULL OR ${alias}.ExpiresAt>GETUTCDATE()`;
  const policy=typeof available==='object'&&available?available:{auth:Boolean(available),evidence:false};
  if(!policy.auth)return `(${normal})`;
  const hints=locked?' WITH (UPDLOCK,HOLDLOCK)':'';
  return `(${normal}${policy.bridge?` OR wf.fn_CouponBridgeReservationHeld(${alias}.Id)=1`:''} OR EXISTS (SELECT 1 FROM wf.CouponNativeCutAuthorizationLine ahl${hints}
    JOIN wf.CouponNativeCutAuthorization ah${hints} ON ah.Id=ahl.AuthorizationId
    WHERE ahl.ReservationId=${alias}.Id AND ${heldAuthorizationPredicate('ahl','ah',policy,locked)}))`;
}

function heldError(){return Object.assign(new Error('รายการจองมีใบอนุญาตตัดตั๋วที่ยังเปิดอยู่ กรุณาตรวจสอบก่อนเปลี่ยนแปลง'),{code:'COUPON_NATIVE_AUTH_RESERVATION_HELD',status:409});}
async function assertNoBridgeHold(tx,where,inputs,policy){
 if(!policy.bridge)return;
 const request=tx.request();for(const [key,type,value]of inputs)request.input(key,type,value);
 const rows=(await request.query(`SELECT TOP 1 1 AS BridgeHold FROM wf.CouponReservation cr WITH(UPDLOCK,HOLDLOCK)
  WHERE (${where}) AND wf.fn_CouponBridgeReservationHeld(cr.Id)=1`)).recordset;
 if(!Array.isArray(rows))throw unavailable();if(rows.length)throw heldError();
}
async function assertNoActiveAuthorization(tx, reservationId, available) {
  const id=Number(reservationId);
  if(!Number.isSafeInteger(id)||id<=0||id>2147483647)throw Object.assign(Error('COUPON_ID_INVALID'),{status:400});
  await assertNoPendingEdit(tx);
  const policy=available===undefined?await resolveHoldPolicy(text=>tx.request().query(text)):
    (typeof available==='object'&&available?available:{auth:Boolean(available),evidence:false});
  if(!policy.auth)return;
  await assertNoBridgeHold(tx,'cr.Id=@rid',[['rid',sql.Int,id]],policy);
  const locked=(await tx.request().input('rid',sql.Int,id).query(`SELECT Id FROM wf.CouponReservation WITH (UPDLOCK,HOLDLOCK) WHERE Id=@rid`)).recordset;
  if(!Array.isArray(locked))throw unavailable();
  if(locked.length!==1)throw Object.assign(new Error('ไม่พบรายการจองตั๋วที่ตรวจสอบได้'),{code:'COUPON_RESERVATION_CHANGED',status:409});
  const rows=(await tx.request().input('rid',sql.Int,id).query(`SELECT TOP 1 1 AS ActiveNativeAuthorization
    FROM wf.CouponNativeCutAuthorizationLine ahl WITH (UPDLOCK,HOLDLOCK)
    JOIN wf.CouponNativeCutAuthorization ah WITH (UPDLOCK,HOLDLOCK) ON ah.Id=ahl.AuthorizationId
    WHERE ahl.ReservationId=@rid AND ${heldAuthorizationPredicate('ahl','ah',policy,true)}`)).recordset;
  if(!Array.isArray(rows))throw unavailable();
  if(rows.length)throw heldError();
}
async function assertCarrierHasNoActiveAuthorization(tx, carrierId, docuNo) {
  const carrier=String(carrierId??'').trim();
  if(!carrier)throw Object.assign(Error('COUPON_CARRIER_INVALID'),{status:400});
  const locked=(await tx.request().input('carrier',sql.VarChar(50),carrier)
    .input('doc',sql.VarChar(50),String(docuNo||'')).query(`SELECT Id FROM wf.CouponReservation WITH (UPDLOCK,HOLDLOCK)
    WHERE CarrierSoId=@carrier OR (NULLIF(@doc,'') IS NOT NULL AND CarrierDocuNo=@doc) ORDER BY Id`)).recordset;
  if(!Array.isArray(locked))throw unavailable();
  if(!locked.length)return;
  await assertNoPendingEdit(tx);
  const policy=await resolveHoldPolicy(text=>tx.request().query(text));
  if(!policy.auth)return;
  await assertNoBridgeHold(tx,"cr.CarrierSoId=@carrier OR(NULLIF(@doc,'') IS NOT NULL AND cr.CarrierDocuNo=@doc)",
   [['carrier',sql.VarChar(50),carrier],['doc',sql.VarChar(50),String(docuNo||'')]],policy);
  const rows=(await tx.request().input('carrier',sql.VarChar(50),carrier)
    .input('doc',sql.VarChar(50),String(docuNo||'')).query(`SELECT TOP 1 1 AS ActiveNativeAuthorization
    FROM wf.CouponReservation cr WITH (UPDLOCK,HOLDLOCK)
    JOIN wf.CouponNativeCutAuthorizationLine ahl WITH (UPDLOCK,HOLDLOCK) ON ahl.ReservationId=cr.Id
    JOIN wf.CouponNativeCutAuthorization ah WITH (UPDLOCK,HOLDLOCK) ON ah.Id=ahl.AuthorizationId
    WHERE (cr.CarrierSoId=@carrier OR (NULLIF(@doc,'') IS NOT NULL AND cr.CarrierDocuNo=@doc)) AND ${heldAuthorizationPredicate('ahl','ah',policy,true)}`)).recordset;
  if(!Array.isArray(rows))throw unavailable();
  if(rows.length)throw heldError();
}
async function assertBeneficiaryHasNoActiveAuthorization(tx, owner, beneficiary) {
  const ownerId=String(owner??'').trim(),beneficiaryId=String(beneficiary??'').trim();
  if(!ownerId||!beneficiaryId)throw Object.assign(Error('COUPON_BENEFICIARY_INVALID'),{status:409});
  const locked=(await tx.request().input('owner',sql.VarChar(50),ownerId)
    .input('beneficiary',sql.VarChar(50),beneficiaryId).query(`SELECT Id FROM wf.CouponReservation WITH (UPDLOCK,HOLDLOCK)
    WHERE OwnerCustId=@owner AND BeneficiaryCustId=@beneficiary ORDER BY Id`)).recordset;
  if(!Array.isArray(locked))throw unavailable();
  if(!locked.length)return;
  await assertNoPendingEdit(tx);
  const policy=await resolveHoldPolicy(text=>tx.request().query(text));
  if(!policy.auth)return;
  await assertNoBridgeHold(tx,'cr.OwnerCustId=@owner AND cr.BeneficiaryCustId=@beneficiary',
   [['owner',sql.VarChar(50),ownerId],['beneficiary',sql.VarChar(50),beneficiaryId]],policy);
  const rows=(await tx.request().input('owner',sql.VarChar(50),ownerId)
    .input('beneficiary',sql.VarChar(50),beneficiaryId).query(`SELECT TOP 1 1 AS ActiveNativeAuthorization
    FROM wf.CouponReservation cr WITH (UPDLOCK,HOLDLOCK)
    JOIN wf.CouponNativeCutAuthorizationLine ahl WITH (UPDLOCK,HOLDLOCK) ON ahl.ReservationId=cr.Id
    JOIN wf.CouponNativeCutAuthorization ah WITH (UPDLOCK,HOLDLOCK) ON ah.Id=ahl.AuthorizationId
    WHERE cr.OwnerCustId=@owner AND cr.BeneficiaryCustId=@beneficiary AND ${heldAuthorizationPredicate('ahl','ah',policy,true)}`)).recordset;
  if(!Array.isArray(rows))throw unavailable();
  if(rows.length)throw heldError();
}

module.exports={authorizationHoldsAvailable,resolveHoldPolicy,heldReservationExpirySql,assertNoActiveAuthorization,assertCarrierHasNoActiveAuthorization,assertBeneficiaryHasNoActiveAuthorization};
