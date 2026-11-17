'use strict';

// Internal candidate only: captures a current 116 and coupon balances under a
// caller-owned transaction, in coupon-first order. This is not authorization,
// a before/after proof, a recovery writer, or a durable incomplete-edit hold.
// A future caller must independently establish identity and document scope,
// lock reservations/evidence, and keep the transaction open through its work.
const {sql}=require('../db');
const {isValidStartDate}=require('./data-window');
function invalid(code='RECOVERY_SNAPSHOT_INVALID') {
  throw Object.assign(new Error(code),{code,status:409});
}
function id(value) {
  const n=Number(value);
  if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(n)||n<=0||n>2147483647) invalid();
  return n;
}
function quantity(value,allowZero=false) {
  if(typeof value!=='string'||!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(value)||value.length>24) invalid();
  const [whole,part='']=value.split('.');
  const result=BigInt(whole)*10000n+BigInt(part.padEnd(4,'0'));
  if((!allowZero&&result===0n)||result>999999999999999999n)invalid();
  return `${result/10000n}.${String(result%10000n).padStart(4,'0')}`;
}
function lineSet(rows) {
  if(!Array.isArray(rows)||!rows.length||rows.length>100)invalid();
  const lines=rows.map(r=>{if(r.ExactQty!==1)invalid();return {listNo:id(r.ListNo),couponId:id(r.CouponId),qty:quantity(r.Qty)};});
  if(new Set(lines.map(r=>r.listNo)).size!==lines.length||new Set(lines.map(r=>r.couponId)).size!==lines.length)invalid();
  return lines.sort((a,b)=>a.couponId-b.couponId);
}
async function loadNativeRecoverySnapshotForUpdate(tx,redemptionId) {
  const rid=id(redemptionId);
  if(!tx||typeof tx.request!=='function')invalid();
  const context=(await tx.request().query('SELECT @@TRANCOUNT AS TransactionCount, XACT_STATE() AS TransactionState'))?.recordset;
  if(!Array.isArray(context)||context.length!==1||!Number.isInteger(context[0].TransactionCount)||
     context[0].TransactionCount<1||context[0].TransactionState!==1)invalid();
  const getLines=async hint=>(await tx.request().input('rid',sql.Int,rid).query(`
    SELECT TOP 101 Listno AS ListNo,CouponID AS CouponId,CONVERT(varchar(32),CAST(GoodQty AS decimal(18,4))) AS Qty,
      CASE WHEN GoodQty=CAST(GoodQty AS decimal(18,4)) THEN 1 ELSE 0 END AS ExactQty
    FROM dbo.WFRedemtionDT WITH (${hint}) WHERE RedemtionID=@rid ORDER BY CouponID,Listno`))?.recordset;
  // Discovery never authorizes anything. Re-read the entire set after locking
  // coupons and header so an intervening edit fails closed.
  const discovered=lineSet(await getLines('READCOMMITTED'));
  const balances=new Map();
  for(const line of discovered) {
    const rows=(await tx.request().input('cid',sql.Int,line.couponId).query(`SELECT CouponID AS CouponId,
      CONVERT(varchar(32),CAST(RemaQty AS decimal(18,4))) AS Balance,
      CASE WHEN RemaQty=CAST(RemaQty AS decimal(18,4)) THEN 1 ELSE 0 END AS ExactBalance
      FROM dbo.WFCoupon WITH (UPDLOCK,HOLDLOCK)
      WHERE CouponID=@cid`))?.recordset;
    if(!Array.isArray(rows)||rows.length!==1||id(rows[0].CouponId)!==line.couponId||rows[0].ExactBalance!==1)invalid();
    balances.set(line.couponId,quantity(rows[0].Balance,true));
  }
  const heads=(await tx.request().input('rid',sql.Int,rid).query(`SELECT RedemtionID,DocuNo,DocuType,DocuStatus,
    CONVERT(varchar(10),DocuDate,120) AS DocuDate FROM dbo.WFRedemtionHD WITH (UPDLOCK,HOLDLOCK)
    WHERE RedemtionID=@rid`))?.recordset;
  if(!Array.isArray(heads)||heads.length!==1)invalid();
  const head=heads[0],docuNo=typeof head.DocuNo==='string'?head.DocuNo.trim():'';
  if(id(head.RedemtionID)!==rid||Number(head.DocuType)!==116||!docuNo||docuNo.length>50||
     !['N','Y'].includes(String(head.DocuStatus||'').trim())||!isValidStartDate(head.DocuDate))invalid();
  const locked=lineSet(await getLines('UPDLOCK,HOLDLOCK'));
  if(JSON.stringify(locked)!==JSON.stringify(discovered))invalid('RECOVERY_SNAPSHOT_CHANGED');
  return {redemptionId:rid,docuNo,docuDate:head.DocuDate,
    lines:locked.map(line=>({...line,nativeBalance:balances.get(line.couponId)})),requiresAtomicProof:true};
}
module.exports={loadNativeRecoverySnapshotForUpdate};
