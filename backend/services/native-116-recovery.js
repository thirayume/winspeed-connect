'use strict';
// Reviews incomplete native autocommit saves without manufacturing a WinSpeed
// operator/audit. Recovery restores the exact pre-save image in one transaction.
const {sql,wfTransaction}=require('../db');
const {businessIds}=require('./business-identity');
const {queryFor,liveUser,requirePermission}=require('./native-document-service');
const {input,hash}=require('./native-document-source');
const {fail}=require('./native-document-plan');
const target=require('./native-document-target');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function native116Recovery(args,options={}){
 const env=options.env||process.env;
 if(env.NATIVE_COUPON_BRIDGE_DIRECT_ENABLED!=='true')fail('ND_NATIVE116_DIRECT_DISABLED',503);
 if(!['queue','inspect','restore'].includes(args.operation))fail('ND_OPERATION_INVALID',400);
 if(args.operation!=='queue'&&!UUID.test(String(args.stageId||'')))fail('ND_REQUEST_INVALID',400);
 if(args.operation==='restore'&&(typeof args.reason!=='string'||args.reason.trim().length<10||args.reason.length>500))fail('ND_REASON_REQUIRED',400);
 return(options.transaction||wfTransaction)(async tx=>{
  const q=queryFor(tx);await target.assertTarget(q,env);
  await require('./initial-invoice-metadata').verifyOperationalMetadata(q,null,{env});
  const ids=businessIds(args.user),who=await liveUser(q,ids.effective,ids.actor,Number(args.user.sub??args.user.id),Number(args.user.actorSub??args.user.actorId??args.user.sub??args.user.id));
  for(const perspective of [who.user.roles,who.user.actorRoles])if(!perspective.includes('ADMIN')||perspective.includes('SEPARATION'))fail('ND_NATIVE116_RECOVERY_ADMIN_REQUIRED',403);
  await requirePermission(q,who,'coupon.settle');
  const locked=(await q("DECLARE @r int;EXEC @r=sp_getapplock @Resource='WF_NATIVE_DOCUMENTS_V3',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;SELECT @r Result")).recordset?.[0]?.Result;
  if(!Number.isInteger(locked)||locked<0)fail('ND_BUSY');
  if(args.operation==='queue')return {items:(await q(`SELECT TOP 100 CONVERT(varchar(36),StageId) stageId,DocuNo docuNo,CONVERT(varchar(10),DocuDate,120) docuDate,CreatedAtUtc createdAtUtc,
   CASE WHEN s.NativeSpid=@@SPID OR APPLOCK_TEST('public',N'WF_NATIVE116_CONN_'+CONVERT(nvarchar(36),s.ConnectionId),'Exclusive','Transaction')<>1 THEN 1 ELSE 0 END connectionOpen
   FROM wf.Native116Stage s WITH(HOLDLOCK) WHERE State='PENDING' ORDER BY CreatedAtUtc,StageId`)).recordset};
  const p={stage:input(sql.UniqueIdentifier,args.stageId)};
  const row=(await q(`SELECT s.*,
   ISNULL(CONVERT(nvarchar(max),(SELECT * FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=s.NativeId FOR XML RAW('head'),TYPE)),N'') CurrentHead,
   ISNULL(CONVERT(nvarchar(max),(SELECT * FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=s.NativeId ORDER BY Listno FOR XML RAW('line'),TYPE)),N'') CurrentLines,
   ISNULL(CONVERT(nvarchar(max),(SELECT c.CouponId,b.RemaQty FROM wf.Native116StageCoupon c WITH(UPDLOCK,HOLDLOCK) JOIN dbo.WFCoupon b WITH(UPDLOCK,HOLDLOCK) ON b.CouponID=c.CouponId WHERE c.StageId=s.StageId ORDER BY c.CouponId FOR XML RAW('coupon'),TYPE)),N'') CurrentBalances,
   CASE WHEN s.NativeSpid=@@SPID OR APPLOCK_TEST('public',N'WF_NATIVE116_CONN_'+CONVERT(nvarchar(36),s.ConnectionId),'Exclusive','Transaction')<>1 THEN 1 ELSE 0 END ConnectionOpen
   FROM wf.Native116Stage s WITH(UPDLOCK,HOLDLOCK) WHERE StageId=@stage`,p)).recordset?.[0];
  if(!row)fail('ND_REQUEST_NOT_FOUND',404);
  if(row.State!=='PENDING')fail('ND_NATIVE116_RECOVERY_STAGE_CHANGED');
  const coupons=(await q(`SELECT c.CouponId couponId,b.CouponNo couponNo,CONVERT(varchar(40),c.NativeBefore) restoreBalance,
   CONVERT(varchar(40),b.RemaQty) currentBalance FROM wf.Native116StageCoupon c WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.WFCoupon b WITH(UPDLOCK,HOLDLOCK) ON b.CouponID=c.CouponId WHERE c.StageId=@stage ORDER BY c.CouponId`,p)).recordset;
  const fingerprint=hash([row,coupons,who.effective,who.actor,who.primaryEffective,who.primaryActor]);
  if(args.operation==='inspect')return {stageId:args.stageId,fingerprint,docuNo:row.DocuNo,docuDate:row.DocuDate,
   connectionOpen:Boolean(row.ConnectionOpen),restoreExisting:!!row.BeforeHead,coupons};
  if(args.fingerprint!==fingerprint)fail('ND_PREVIEW_STALE');
  if(row.ConnectionOpen)fail('ND_NATIVE116_CLOSE_ORIGINAL_CONNECTION');
  await q(`EXEC wf.sp_Native116RecoverBefore @stage=@stage,@user=@u,@actor=@a,@reason=@reason,@head=@head,@lines=@lines,@balances=@balances`,{
   ...p,u:input(sql.Int,who.effective),a:input(sql.Int,who.actor),reason:input(sql.NVarChar(500),args.reason.trim()),
   head:input(sql.NVarChar(sql.MAX),row.CurrentHead),lines:input(sql.NVarChar(sql.MAX),row.CurrentLines),balances:input(sql.NVarChar(sql.MAX),row.CurrentBalances)});
  return {stageId:args.stageId,completed:true,restoredBefore:true};
 });
}
module.exports={native116Recovery};
