'use strict';

const { sql,wfTransaction }=require('../db');
const { requireAuthorizationActor }=require('./coupon-native-authorization');
const { assertBridge }=require('./coupon-native-edit-approval');
const { assertNativeHoldPrimary }=require('./coupon-native-review-queue');
const { couponVisible,reservationsVisible }=require('./coupon-access-scope');

const validEditId=value=>typeof value==='string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
function fail(code,status=409) {
  throw Object.assign(new Error(code),{code,status});
}

async function reviewNativeEdit({ actor,editId,reason },deps, resume) {
  if(!validEditId(editId)||typeof reason!=='string'||reason.trim().length<10||reason.length>500)
    fail('COUPON_RECOVERY_RELEASE_INVALID',400);
  const identities=await requireAuthorizationActor(actor,deps);
  return (deps.wfTransaction||wfTransaction)(async tx=>{
    await (deps.assertNativeHoldPrimary||assertNativeHoldPrimary)(tx);
    const query=(text,inputs={})=>{
      const request=tx.request();
      for(const [name,{type,value}] of Object.entries(inputs))request.input(name,type,value);
      return request.query(text);
    };
    await (deps.assertBridge||assertBridge)(query);
    const metadata=(await query(`SELECT CASE WHEN
      OBJECT_ID('wf.sp_ReleaseCouponNativeEdit','P') IS NOT NULL
      AND OBJECT_ID('wf.CouponEffectiveSettlement','V') IS NOT NULL
      AND (SELECT COUNT(*) FROM wf.SchemaMigration WITH (HOLDLOCK)
           WHERE FileName='236_coupon_recovery_reviewed_release.sql')=1
      THEN 1 ELSE 0 END AS Ready`)).recordset?.[0];
    if(metadata?.Ready!==1)fail('COUPON_RECOVERY_RELEASE_UNAVAILABLE',503);

    const edit={editId:{type:sql.UniqueIdentifier,value:editId}};
    const readLines=async hint=>(await query(`SELECT TOP 101 h.CouponId,s.ReservationId
       FROM wf.CouponNativeEditHold h WITH (${hint})
       LEFT JOIN wf.CouponReservationSettlement s WITH (${hint}) ON s.Id=h.PlannedSettlementId
       WHERE h.EditId=@editId ORDER BY h.CouponId`,edit)).recordset;
    const observed=await readLines('READCOMMITTED');
    if(!Array.isArray(observed)||!observed.length||observed.length>100||
       observed.some(row=>!Number.isSafeInteger(Number(row.CouponId))||Number(row.CouponId)<=0||
         !Number.isSafeInteger(Number(row.ReservationId))||Number(row.ReservationId)<=0))
      fail('COUPON_RECOVERY_RELEASE_NOT_FOUND',404);
    for(const row of observed){
      const result=await query('SELECT CouponID FROM dbo.WFCoupon WITH (UPDLOCK,HOLDLOCK) WHERE CouponID=@cid',
        {cid:{type:sql.Int,value:Number(row.CouponId)}});
      if(result.recordset?.length!==1)fail('COUPON_RECOVERY_RELEASE_NOT_FOUND',404);
    }
    const locked=await readLines('HOLDLOCK');
    if(!Array.isArray(locked)||locked.length!==observed.length||
       locked.some((row,i)=>row.CouponId!==observed[i].CouponId||row.ReservationId!==observed[i].ReservationId))
      fail('COUPON_RECOVERY_RELEASE_SOURCE_CHANGED');
    for(const row of locked){
      if(!await (deps.couponVisible||couponVisible)(actor,row.CouponId,query))
        fail('COUPON_RECOVERY_RELEASE_NOT_FOUND',404);
    }
    if(!await (deps.reservationsVisible||reservationsVisible)(actor,locked.map(row=>row.ReservationId),query))
      fail('COUPON_RECOVERY_RELEASE_NOT_FOUND',404);

    if (resume) {
      const available=(await query(`SELECT CASE WHEN OBJECT_ID('wf.sp_ResumeCouponNativeEdit','P') IS NOT NULL
        AND EXISTS(SELECT 1 FROM wf.SchemaMigration WHERE FileName='240_coupon_native_edit_resume_set_options.sql')
        THEN 1 ELSE 0 END AS Ready`)).recordset?.[0]?.Ready;
      if (available!==1) fail('COUPON_EDIT_RESUME_UNAVAILABLE',503);
    }
    try {
      await query(resume ? 'EXEC wf.sp_ResumeCouponNativeEdit @editId,@effective,@actor,@reason'
        : 'EXEC wf.sp_ReleaseCouponNativeEdit @editId,@effective,@actor,@reason',{
        ...edit,effective:{type:sql.Int,value:identities.effective},actor:{type:sql.Int,value:identities.actor},
        reason:{type:sql.NVarChar(500),value:reason.trim()},
      });
    } catch(error) {
      const code=String(error?.message||'').match(/COUPON_RECOVERY_RELEASE_(RECEIPT_INVALID|PROOF_INVALID|SOURCE_CHANGED)|COUPON_EDIT_RESUME_(SOURCE_CONFLICT|BALANCE_CONFLICT)/)?.[0];
      if(code)fail(code);
      throw error;
    }
    return resume ? {editId,resumed:true} : {editId,released:true};
  },{ isolationLevel:sql.ISOLATION_LEVEL.SERIALIZABLE });
}

const releaseNativeEdit=(input,deps={})=>reviewNativeEdit(input,deps,false);
const resumeNativeEdit=(input,deps={})=>reviewNativeEdit(input,deps,true);
module.exports={ releaseNativeEdit,resumeNativeEdit };
