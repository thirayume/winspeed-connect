'use strict';
const crypto=require('crypto');
const {sql,wfTransaction}=require('../db');
const {businessIds}=require('./business-identity');
const target=require('./native-document-target'),source=require('./native-document-source');
const {queryFor,liveUser,requirePermission,planXml}=require('./native-document-service');
const scope=require('./coupon-access-scope');
const {fixed,decimal,id,date,fail}=require('./native-document-plan');
const {editPlan}=require('./coupon-bridge-plan');
const {input,hash}=source;
const uuid=v=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(v||''));
const text=(v,max)=>typeof v==='string'&&v.trim()&&v.trim().length<=max?v.trim():fail('ND_SLIP_INVALID',400);
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function xml(tag,rows){return `<${tag}s>${rows.map(r=>`<${tag} ${Object.entries(r).map(([k,v])=>`${k}="${escape(v)}"`).join(' ')}/>`).join('')}</${tag}s>`;}
const actorParams=who=>({u:input(sql.Int,who.effective),a:input(sql.Int,who.actor),pu:input(sql.Int,who.primaryEffective),pa:input(sql.Int,who.primaryActor)});
async function physical(q,nativeId){return(await q(`DECLARE @h nvarchar(max),@l nvarchar(max);EXEC wf.sp_CouponBridgePhysical @n,@h OUTPUT,@l OUTPUT;
 SELECT @h AS HeaderProof,@l AS LineProof`,{n:input(sql.Int,nativeId)})).recordset[0];}
async function visible(q,who,cust,window,coupons){
 if(!await scope.beneficiaryCustomerVisible(who.user,cust,window,q))fail('ND_CUSTOMER_NOT_FOUND',404);
 for(const c of coupons){
  if(!c.beneficiaryValid||(Number(c.ownerCustId)===cust&&!await scope.couponVisible(who.user,c.couponId,q)))fail('ND_COUPON_NOT_FOUND',404);
 }
}
async function inspectEdit(q,tx,who,args){
 const nativeId=id(args.nativeId),p={n:input(sql.Int,nativeId)};
 const doc=(await q(`SELECT b.CustId,b.Revision,b.State,b.Origin,b.HeaderProof,b.LineProof,h.DocuNo,
  CONVERT(varchar(10),h.DocuDate,120) AS DocuDate,h.IssueName,h.CarLicense,h.SaveEmpID,h.DocuStatus
  FROM(SELECT @n AS Id)x LEFT JOIN wf.CouponBridgeDocument b WITH(UPDLOCK,HOLDLOCK) ON b.NativeId=x.Id
  LEFT JOIN dbo.WFRedemtionHD h WITH(UPDLOCK,HOLDLOCK) ON h.RedemtionID=x.Id AND h.DocuType=116`,p)).recordset[0];
 const cust=doc.CustId?Number(doc.CustId):id(args.custId),window=await source.dataWindow(q);
 if(args.custId!==undefined&&id(args.custId)!==cust)fail('ND_CUSTOMER_NOT_FOUND',404);
 const selection=args.operationType==='D'?[]:args.lines;
 const before=(await q(`SELECT CouponID AS couponId,Listno AS [lineNo],CONVERT(varchar(40),CONVERT(decimal(18,4),GoodQty)) AS quantity
  FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@n ORDER BY CouponID`,p)).recordset;
 if(!doc.DocuNo||!before.length)fail('ND_CUT_PROOF_REQUIRED');
 const ids=[...new Set([...before.map(l=>id(l.couponId)),...(selection||[]).map(l=>id(l.couponId))])].sort((a,b)=>a-b);
 const requestedDate=date(args.data?.docDate||doc.DocuDate),coupons=[],reservations=[],settlements=[],proofs=[];
 for(const cid of ids){
  const cp={c:input(sql.Int,cid),cust:input(sql.VarChar(50),String(cust)),date:input(sql.Date,requestedDate),...p};
  const c=(await q(`SELECT c.CouponID AS couponId,c.CouponNo AS couponNo,h.CustID AS ownerCustId,
   CONVERT(varchar(40),CONVERT(decimal(18,4),c.RemaQty)) AS remaining,
   CONVERT(varchar(40),CONVERT(decimal(18,4),ISNULL((SELECT SUM(r.ReservedQty-ISNULL(r.ConsumedQty,0)) FROM wf.CouponReservation r WITH(UPDLOCK,HOLDLOCK)
    WHERE r.CouponId=c.CouponID AND r.Status='RESERVED' AND(r.ExpiresAt IS NULL OR r.ExpiresAt>GETUTCDATE()
     OR wf.fn_CouponBridgeReservationHeld(r.Id)=1 OR EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorizationLine al JOIN wf.CouponNativeCutAuthorization a ON a.Id=al.AuthorizationId
      WHERE al.ReservationId=r.Id AND(a.State='ACTIVE' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WHERE e.AuthorizationLineId=al.Id))))),0))) AS held,
   CASE WHEN h.CustID=CONVERT(int,@cust) OR EXISTS(SELECT 1 FROM wf.CouponBeneficiary b WITH(UPDLOCK,HOLDLOCK)
    WHERE b.OwnerCustId=CONVERT(varchar(50),h.CustID) AND b.BeneficiaryCustId=@cust AND b.Status='ACTIVE'
     AND(b.Scope='ALL' OR b.Scope=CONVERT(varchar(50),c.GoodID)) AND(b.EffectiveFrom IS NULL OR b.EffectiveFrom<=@date)
     AND(b.EffectiveTo IS NULL OR b.EffectiveTo>=@date) AND(b.EffectiveFrom IS NULL OR b.EffectiveFrom<=CONVERT(date,DATEADD(hour,7,GETUTCDATE())))
     AND(b.EffectiveTo IS NULL OR b.EffectiveTo>=CONVERT(date,DATEADD(hour,7,GETUTCDATE())))) THEN 1 ELSE 0 END AS beneficiaryValid
   FROM dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=c.DocuID AND h.DocuType=104
   WHERE c.CouponID=@c AND c.DocuType=104 AND h.DocuStatus<>'C' AND h.DocuDate<=@date`,cp)).recordset[0];
  if(!c)fail('ND_COUPON_NOT_FOUND',404);coupons.push(c);
  const rr=(await q(`SELECT CONVERT(varchar(30),r.Id) AS id,r.CouponId AS couponId,r.Revision AS revision,
   CONVERT(varchar(40),CONVERT(decimal(12,4),ISNULL(r.ConsumedQty,0))) AS consumed,
   CONVERT(varchar(40),CONVERT(decimal(12,4),r.ReservedQty-ISNULL(r.ConsumedQty,0))) AS remaining,
   CASE WHEN r.Status='RESERVED' AND(r.ExpiresAt IS NULL OR r.ExpiresAt>DATEADD(minute,15,GETUTCDATE())) THEN 1 ELSE 0 END AS active,
   CASE WHEN wf.fn_CouponBridgeReservationHeld(r.Id)=1 OR EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorizationLine al JOIN wf.CouponNativeCutAuthorization a ON a.Id=al.AuthorizationId
     WHERE al.ReservationId=r.Id AND(a.State='ACTIVE' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WHERE e.AuthorizationLineId=al.Id))) THEN 1 ELSE 0 END AS nativeHeld
   FROM wf.CouponReservation r WITH(UPDLOCK,HOLDLOCK) WHERE r.CouponId=@c AND r.BeneficiaryCustId=@cust ORDER BY r.Id`,cp)).recordset;
  for(const r of rr)reservations.push({...r,active:Boolean(r.active),inScope:await scope.reservationsVisible(who.user,[r.id],q)});
  settlements.push(...(await q(`SELECT CONVERT(varchar(30),s.Id) AS id,CONVERT(varchar(30),s.ReservationId) AS reservationId,s.CouponId AS couponId,
   CONVERT(varchar(40),s.SettledQty) AS quantity FROM wf.CouponBridgeEffectiveSettlement s WITH(HOLDLOCK)
   WHERE s.NativeRedemptionId=@n AND s.CouponId=@c ORDER BY s.Id`,cp)).recordset);
  for(const query of [
   'SELECT * FROM dbo.WFCoupon WITH(UPDLOCK,HOLDLOCK) WHERE CouponID=@c',
   'SELECT h.* FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) JOIN dbo.WFCoupon c ON c.DocuID=h.SOID WHERE c.CouponID=@c',
   'SELECT d.* FROM dbo.SODT d WITH(UPDLOCK,HOLDLOCK) JOIN dbo.WFCoupon c ON c.DocuID=d.SOID AND c.RefListno=d.ListNo WHERE c.CouponID=@c',
  ])proofs.push(await source.snapshot(q,query,cp));
 }
 await visible(q,who,cust,window,coupons);
 const current=await physical(q,nativeId),registered=Boolean(doc.CustId);
 if(registered&&(doc.State!=='ACTIVE'||doc.HeaderProof!==current.HeaderProof||doc.LineProof!==current.LineProof))fail('ND_CUT_DIVERGED');
 const operation=args.operationType||'E';
 const plan=editPlan({before,coupons,reservations,settlements},selection||before.map(l=>({couponId:l.couponId,quantity:l.quantity})),operation);
 const data={docDate:requestedDate,receiver:text(args.data?.receiver||doc.IssueName,100),plate:text(args.data?.plate||doc.CarLicense,25)};
 const fingerprint=hash([nativeId,cust,registered,doc.Revision,current,plan,data,proofs,reservations,who.effective,who.actor,who.empId,window.businessDate]);
 return {doc,cust,current,plan,data,fingerprint,registered,opening:doc.DocuDate<window.businessDate,nativeId,coupons};
}
async function bridgeOperation(args,options={}){
 const env=options.env||process.env;
 if(env.NATIVE_COUPON_BRIDGE_ENABLED!=='true'||!target.enabled(env))fail('ND_BRIDGE_DISABLED',503);
 const operations=['inspect','publish','adopt','release','withdraw','recover','queue'];
 if(!operations.includes(args.operation))fail('ND_OPERATION_INVALID',400);
 if(!['inspect','queue'].includes(args.operation)&&(typeof args.reason!=='string'||args.reason.trim().length<10||args.reason.length>500))fail('ND_REASON_REQUIRED',400);
 return(options.transaction||wfTransaction)(async tx=>{
  const q=queryFor(tx);await target.assertTarget(q,env);
  await require('./initial-invoice-metadata').verifyOperationalMetadata(q,null,{env});
  const ids=businessIds(args.user),who=await liveUser(q,ids.effective,ids.actor,Number(args.user.sub??args.user.id),Number(args.user.actorSub??args.user.actorId??args.user.sub??args.user.id));
  await requirePermission(q,who,args.operationType==='C'&&['inspect','publish'].includes(args.operation)?'coupon.manual116':'coupon.settle');
  const locked=(await q("DECLARE @r int;EXEC @r=sp_getapplock @Resource='WF_NATIVE_DOCUMENTS_V3',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;SELECT @r AS Result")).recordset?.[0]?.Result;
  if(!Number.isInteger(locked)||locked<0)fail('ND_BUSY');
  if(args.operation==='queue'){
   const rows=(await q(`SELECT TOP 100 PermitId,NativeId,CustId,DocuNo,Operation,State,ExpiresAtUtc,StartedAtUtc,CompletedAtUtc,
    CONVERT(varchar(10),DocuDate,120) AS DocuDate FROM wf.CouponBridgePermit WITH(HOLDLOCK)
    WHERE ReleasedAtUtc IS NULL AND State<>'CANCELLED' ORDER BY CreatedAtUtc,PermitId`)).recordset,window=await source.dataWindow(q),visibleRows=[];
   for(const r of rows)if(await scope.beneficiaryCustomerVisible(who.user,r.CustId,window,q))
    visibleRows.push({...r,NativeId:r.DocuDate<window.businessDate?null:r.NativeId,DocuNo:r.DocuDate<window.businessDate?null:r.DocuNo,
     DocuDate:r.DocuDate<window.businessDate?null:r.DocuDate,opening:r.DocuDate<window.businessDate});
   return {items:visibleRows};
  }
  const ap=actorParams(who);
  if(['release','withdraw','recover'].includes(args.operation)){
   if(!uuid(args.permitId))fail('ND_REQUEST_INVALID',400);
   const p={permit:input(sql.VarChar(36),args.permitId)};
   const permit=(await q('SELECT * FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK) WHERE PermitId=@permit',p)).recordset[0];
   if(!permit)fail('ND_REQUEST_NOT_FOUND',404);
   const coupons=(await q(`SELECT l.CouponId AS couponId,h.CustID AS ownerCustId,
    CASE WHEN h.CustID=p.CustId OR EXISTS(SELECT 1 FROM wf.CouponBeneficiary b WITH(HOLDLOCK)
     WHERE b.OwnerCustId=CONVERT(varchar(50),h.CustID) AND b.BeneficiaryCustId=CONVERT(varchar(50),p.CustId) AND b.Status='ACTIVE'
      AND(b.Scope='ALL' OR b.Scope=CONVERT(varchar(50),c.GoodID))
      AND(b.EffectiveFrom IS NULL OR b.EffectiveFrom<=CONVERT(date,DATEADD(hour,7,GETUTCDATE())))
      AND(b.EffectiveTo IS NULL OR b.EffectiveTo>=CONVERT(date,DATEADD(hour,7,GETUTCDATE())))) THEN 1 ELSE 0 END AS beneficiaryValid
    FROM wf.CouponBridgeLine l JOIN wf.CouponBridgePermit p ON p.PermitId=l.PermitId
    JOIN dbo.WFCoupon c ON c.CouponID=l.CouponId JOIN dbo.SOHD h ON h.SOID=c.DocuID WHERE l.PermitId=@permit`,p)).recordset;
   if(!coupons.length)fail('ND_CUT_PROOF_REQUIRED');
   await visible(q,who,Number(permit.CustId),await source.dataWindow(q),coupons);
   const proof=await physical(q,permit.NativeId),fingerprint=hash([permit,proof,who.effective,who.actor]);
   if(args.fingerprint!==fingerprint){
    const summary=(await q(`SELECT c.CouponNo AS couponNo,CONVERT(varchar(40),l.BeforeQty) AS beforeQty,
     CONVERT(varchar(40),l.AfterQty) AS afterQty FROM wf.CouponBridgeLine l JOIN dbo.WFCoupon c ON c.CouponID=l.CouponId
     WHERE l.PermitId=@permit ORDER BY l.[LineNo]`,p)).recordset;
    return {permitId:permit.PermitId,status:permit.State,fingerprint,reviewRequired:true,lines:summary,operation:permit.Operation};
   }
   const proc={release:'sp_CouponBridgeRelease',withdraw:'sp_CouponBridgeWithdraw',recover:'sp_CouponBridgeResume'}[args.operation];
   const params={...p,...ap,reason:input(sql.NVarChar(500),args.reason),h:input(sql.NVarChar(sql.MAX),proof.HeaderProof),l:input(sql.NVarChar(sql.MAX),proof.LineProof)};
   await q(`EXEC wf.${proc} @permit=@permit,@user=@u,@actor=@a,@reason=@reason${args.operation==='recover'?',@primary=@pu,@primaryActor=@pa,@head=@h,@lines=@l':''}`,params);
   return {permitId:permit.PermitId,completed:true,operation:args.operation};
  }
  let current;
  if(args.operationType==='C'){
   if(!uuid(args.requestId))fail('ND_REQUEST_INVALID',400);
   const r=(await q('SELECT * FROM wf.NativeDocumentRequest WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@r AND DocuType=116',
    {r:input(sql.VarChar(36),args.requestId)})).recordset[0];
   if(!r||r.Status!=='APPROVED')fail('ND_APPROVAL_REQUIRED');
   const saved=JSON.parse(r.InputJson),requester=await liveUser(q,r.UserId,r.ActorUserId,r.PrimaryUserId,r.PrimaryActorId);
   const rebuilt=await source.redemption(q,tx,r.SourceId,requester.user,saved.lines,saved.data);
   await source.redemption(q,tx,r.SourceId,who.user,saved.lines,saved.data);
   const canonical=(await q('SELECT CONVERT(nvarchar(max),CONVERT(xml,@xml)) AS [Plan]',{xml:input(sql.Xml,planXml(rebuilt.plan,r.SourceId))})).recordset[0].Plan;
   if(r.SourceHash!==rebuilt.sourceHash||r.PlanXml!==canonical)fail('ND_SOURCE_CHANGED');
   const plan={lines:rebuilt.plan.lines.map((l,i)=>({couponId:l.couponId,lineNo:i+1,before:'0.0000',after:l.quantity,nativeBefore:l.beforeRemaining})),
    allocations:rebuilt.plan.lines.flatMap(l=>(l.settlements||[]).map(s=>({couponId:l.couponId,reservationId:s.reservationId,settlementId:'0',
     delta:s.quantity,beforeConsumed:s.beforeConsumed,revision:s.revision})))};
   current={cust:r.SourceId,doc:{DocuNo:rebuilt.plan.slipNo},nativeId:null,data:rebuilt.plan,plan,
    fingerprint:hash([r,canonical,who.effective,who.actor,who.empId]),registered:true};
  }else{
   if(args.nativeId===undefined&&args.docuNo){
    const rows=(await q('SELECT RedemtionID FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuNo=@number AND DocuType=116',
     {number:input(sql.VarChar(25),text(args.docuNo,25))})).recordset;
    if(rows.length!==1)fail('ND_CUT_PROOF_REQUIRED');
    args={...args,nativeId:rows[0].RedemtionID};
   }
   current=await inspectEdit(q,tx,who,args);
  }
  if(args.operation==='inspect')return {fingerprint:current.fingerprint,registered:current.registered,opening:Boolean(current.opening),
   revision:current.doc.Revision,plan:{...current.plan,lines:current.plan.lines.map(l=>({...l,
    couponNo:current.coupons?.find(c=>Number(c.couponId)===Number(l.couponId))?.couponNo}))},data:current.opening?undefined:current.data};
  if(args.fingerprint!==current.fingerprint)fail('ND_PREVIEW_STALE');
  if(args.operation==='adopt'){
   if(args.operationType==='C')fail('ND_OPERATION_INVALID',400);
   await q('EXEC wf.sp_CouponBridgeAdopt @native=@n,@cust=@c,@user=@u,@actor=@a,@head=@h,@lines=@l,@reason=@reason',{
    ...ap,n:input(sql.Int,current.nativeId),c:input(sql.Int,current.cust),h:input(sql.NVarChar(sql.MAX),current.current.HeaderProof),
    l:input(sql.NVarChar(sql.MAX),current.current.LineProof),reason:input(sql.NVarChar(500),args.reason)});
   return {adopted:true,refreshRequired:true};
  }
  if(args.operation!=='publish'||!current.registered)fail('ND_CUT_ADOPTION_REQUIRED');
  const permitId=crypto.randomUUID();
  await q(`EXEC wf.sp_CouponBridgePublish @permit=@permit,@request=@request,@operation=@op,@native=@n,@number=@number,@cust=@cust,
    @date=@date,@receiver=@receiver,@plate=@plate,@emp=@emp,@user=@u,@actor=@a,@primary=@pu,@primaryActor=@pa,@revision=@rev,
    @reason=@reason,@lines=@lines,@allocations=@allocations`,{...ap,permit:input(sql.VarChar(36),permitId),request:input(sql.VarChar(36),args.requestId||null),
    op:input(sql.Char(1),args.operationType||'E'),n:input(sql.Int,current.nativeId),number:input(sql.VarChar(25),current.doc.DocuNo),cust:input(sql.Int,current.cust),
    date:input(sql.Date,current.data.docDate),receiver:input(sql.NVarChar(100),current.data.receiver),plate:input(sql.NVarChar(25),current.data.plate),emp:input(sql.Int,id(who.empId)),
    rev:input(sql.Int,current.doc.Revision||null),reason:input(sql.NVarChar(500),args.reason),lines:input(sql.Xml,xml('line',current.plan.lines)),
    allocations:input(sql.Xml,xml('allocation',current.plan.allocations))});
  return {permitId,status:'APPROVED',leaseMinutes:15};
 },{isolationLevel:sql.ISOLATION_LEVEL.SERIALIZABLE});
}
function httpError(e){const result=require('./native-document-service').httpError(e);
 return result.code==='ND_OPERATION_FAILED'?{...result,code:'ND_BRIDGE_FAILED'}:result;}
module.exports={bridgeOperation,xml,httpError};
