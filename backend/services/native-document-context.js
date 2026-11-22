'use strict';
const {sql,wfTransaction}=require('../db');
const {businessIds}=require('./business-identity');
const {queryFor,liveUser,permission,approveAllowed}=require('./native-document-service');
const {assertTarget}=require('./native-document-target');
const {order,input,dataWindow}=require('./native-document-source');
const {couponVisible,reservationsVisible}=require('./coupon-access-scope');
const {heldReservationExpirySql,resolveHoldPolicy}=require('./coupon-authorization-hold');
const {fail,id}=require('./native-document-plan');
async function inspectBooking({soid,user,couponNo=''},options={}){
 id(soid);
 if(typeof couponNo!=='string'||couponNo.length>25||/[^\x20-\x7e]/.test(couponNo))fail('ND_COUPON_SEARCH_INVALID',400);
 return (options.transaction||wfTransaction)(async tx=>{
  const q=queryFor(tx);await assertTarget(q,options.env||process.env);
  const ids=businessIds(user),who=await liveUser(q,ids.effective,ids.actor,Number(user.sub??user.id),Number(user.actorSub??user.actorId??user.sub??user.id));
  const permissions={};
  for(const code of ['so.approve-native','so.create-native-delivery','credit.approve-native','coupon.request116','coupon.manual116','invoice.post-native'])
   permissions[code]=await permission(q,who.effective,code)&&await permission(q,who.actor,code);
  if(!Object.values(permissions).some(Boolean))fail('ND_ACTOR_FORBIDDEN',403);
  const {row}=await order(q,Number(soid),who.user),hold=await resolveHoldPolicy(text=>q(text)),window=await dataWindow(q);
  if(row.docType!==103)fail('ND_BOOKING_REQUIRED');
  const p={s:input(sql.Int,Number(soid)),cust:input(sql.VarChar(50),String(row.custId)),ticket:input(sql.VarChar(25),couponNo.trim())};
  const deliveries=(await q(`SELECT DISTINCT h.SOID AS id,h.DocuNo AS docNo FROM dbo.SOHD h JOIN dbo.SODT d ON d.SOID=h.SOID
   WHERE h.DocuType=104 AND d.RefSOID=@s ORDER BY h.SOID`,p)).recordset;
  // Opening tickets remain selectable; the UI receives the number and balance,
  // without exposing their pre-cutoff booking/invoice details.
  const coupons=(await q(`SELECT TOP 101 c.CouponID AS id,c.CouponNo AS couponNo,c.GoodName AS goodName,c.DocuID AS deliveryId,h.CustID AS ownerCustId,
   CONVERT(varchar(40),CONVERT(decimal(18,4),c.RemaQty)) AS remaining,
   CONVERT(varchar(40),CONVERT(decimal(18,4),c.RemaQty-ISNULL((SELECT SUM(cr.ReservedQty-ISNULL(cr.ConsumedQty,0))
    FROM wf.CouponReservation cr WHERE cr.CouponId=c.CouponID AND cr.Status='RESERVED' AND ${heldReservationExpirySql('cr',hold)}),0))) AS available
   FROM dbo.WFCoupon c JOIN dbo.SOHD h ON h.SOID=c.DocuID
   WHERE c.Docutype=104 AND h.DocuType=104 AND h.DocuStatus<>'C' AND c.RemaQty>0
    AND(@ticket='' OR c.CouponNo=@ticket)
    AND(h.CustID=CONVERT(int,@cust) OR EXISTS(SELECT 1 FROM wf.CouponBeneficiary b WHERE b.OwnerCustId=CONVERT(varchar(50),h.CustID)
     AND b.BeneficiaryCustId=@cust AND b.Status='ACTIVE' AND(b.EffectiveFrom IS NULL OR b.EffectiveFrom<=CONVERT(date,DATEADD(hour,7,GETUTCDATE())))
     AND(b.EffectiveTo IS NULL OR b.EffectiveTo>=CONVERT(date,DATEADD(hour,7,GETUTCDATE()))) AND(b.Scope='ALL' OR b.Scope=CONVERT(varchar(50),c.GoodID))))
   ORDER BY c.CouponID DESC`,p)).recordset;
  const visible=[];
  for(const c of coupons)if(Number(c.ownerCustId)!==row.custId||await couponVisible(who.user,c.id,q)){
   const reservations=(await q(`SELECT CONVERT(varchar(30),cr.Id) AS id,
    CASE WHEN cr.ReservedAt>=@start THEN cr.CarrierDocuNo ELSE NULL END AS carrierNo,
    CONVERT(varchar(40),CONVERT(decimal(18,4),cr.ReservedQty-ISNULL(cr.ConsumedQty,0))) AS remaining
    FROM wf.CouponReservation cr WHERE cr.CouponId=@c AND cr.BeneficiaryCustId=@cust AND cr.Status='RESERVED'
     AND(cr.ExpiresAt IS NULL OR cr.ExpiresAt>GETUTCDATE()) AND cr.ReservedQty>ISNULL(cr.ConsumedQty,0)
     AND NOT EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorizationLine al JOIN wf.CouponNativeCutAuthorization ah ON ah.Id=al.AuthorizationId
      WHERE al.ReservationId=cr.Id AND(ah.State='ACTIVE' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WHERE e.AuthorizationLineId=al.Id)))
    ORDER BY cr.Id`,{...p,c:input(sql.Int,c.id),start:input(sql.DateTime2,window.utcInstant)})).recordset;
   const availableReservations=[];
   for(const r of reservations)if(await reservationsVisible(who.user,[r.id],q))availableReservations.push(r);
   const {ownerCustId,deliveryId,...safe}=c;visible.push({...safe,reservations:availableReservations});
  }
  const requests=(await q(`SELECT TOP 100 r.RequestId AS requestId,r.DocuType AS docuType,r.SourceId AS sourceId,r.Status AS status,
   r.Revision AS revision,r.ExpiresAtUtc AS expiresAt,r.Reason AS reason,r.UserId,r.ActorUserId,
   r.PlanXml.value('(/plan/@slipNo)[1]','varchar(25)') AS slipNo,
   r.PlanXml.value('(/plan/@receiver)[1]','nvarchar(100)') AS receiver,
   r.PlanXml.value('(/plan/@plate)[1]','nvarchar(25)') AS plate,
   r.PlanXml.value('(/plan/@quantity)[1]','varchar(40)') AS quantity
   FROM wf.NativeDocumentRequest r WHERE r.Status IN('PENDING','APPROVED') AND r.ExpiresAtUtc>GETUTCDATE()
    AND((r.DocuType=104 AND r.SourceKind='SO' AND r.SourceId=@s)
     OR(r.DocuType=116 AND r.SourceKind='CUSTOMER' AND r.SourceId=CONVERT(int,@cust)))
   ORDER BY r.CreatedAtUtc DESC`,p)).recordset;
  const safeRequests=[];
  for(const request of requests){
   const lines=(await q(`SELECT l.value('@couponId','int') AS couponId,l.value('@quantity','varchar(40)') AS quantity,
    (SELECT c.CouponNo FROM dbo.WFCoupon c WHERE c.CouponID=l.value('@couponId','int')) AS couponNo
    FROM wf.NativeDocumentRequest r CROSS APPLY r.PlanXml.nodes('/plan/line') t(l) WHERE r.RequestId=@r`,{r:input(sql.VarChar(36),request.requestId)})).recordset;
   if(request.docuType===116){
    // A beneficiary request can cover another salesperson's tickets, but only
    // the same live beneficiary grants used by the writer may widen its scope.
    try{
     const saved=(await q('SELECT InputJson FROM wf.NativeDocumentRequest WHERE RequestId=@r',{r:input(sql.VarChar(36),request.requestId)})).recordset[0];
     await require('./native-document-source').assertReplayScope(q,{DocuType:116,SourceId:request.sourceId},saved,who.user);
    }catch(e){if([403,404].includes(e.status))continue;throw e;}
   }
   let canApprove=false;
   try{await approveAllowed(q,who,{...request,DocuType:request.docuType});canApprove=true;}catch(e){if(e.status!==403)throw e;}
   const {UserId,ActorUserId,...safe}=request;
   safeRequests.push({...safe,isRequester:UserId===who.effective&&ActorUserId===who.actor,canApprove,lines});
  }
  const cuts=(await q(`SELECT d.RedemtionID AS redemptionId,h.DocuNo AS redemptionNo,d.Listno AS [lineNo],c.DocuID AS deliveryId,c.CouponNo AS couponNo,
   CONVERT(varchar(40),CONVERT(decimal(18,4),d.GoodQty)) AS quantity,CONVERT(varchar(10),h.DocuDate,120) AS docDate
   FROM dbo.WFRedemtionDT d JOIN dbo.WFRedemtionHD h ON h.RedemtionID=d.RedemtionID AND h.DocuType=116
   JOIN dbo.WFCoupon c ON c.CouponID=d.CouponID JOIN dbo.SODT s ON s.SOID=c.DocuID AND s.ListNo=c.RefListno
   JOIN wf.NativeDocumentReceipt r ON r.NativeId=h.RedemtionID AND r.DocuType=116 AND r.NativeAfterHash IS NOT NULL
   WHERE s.RefSOID=@s AND h.DocuStatus='N' AND d.PostInv='N' AND d.SOInvID IS NULL AND d.RemaQty=d.GoodQty
   ORDER BY c.DocuID,h.DocuDate,d.RedemtionID,d.Listno`,p)).recordset;
  const credit=permissions['credit.approve-native']||permissions['so.create-native-delivery']
   ?await require('./native-document-source').creditSummary(q,row.custId,deliveries.length?'0.0000':row.net):null;
  return {soid:Number(soid),docuNo:row.docNo,custId:row.custId,approvalNo:row.AppvDocuNo,today:row.today,deliveries,credit,
   gross:row.gross,discount:row.discount,tax:row.tax,amount:row.net,
   orderLines:row.lines.map(l=>({lineNo:l.lineNo,goodId:l.goodId,goodName:l.goodName,quantity:l.quantity,price:l.price,amount:l.amount})),
   coupons:visible.slice(0,100),moreCoupons:coupons.length>100,requests:safeRequests,cuts,permissions};
 });
}
async function listCreditRequests(user,options={}){
 return(options.transaction||wfTransaction)(async tx=>{
  const q=queryFor(tx);await assertTarget(q,options.env||process.env);
  const ids=businessIds(user),who=await liveUser(q,ids.effective,ids.actor,Number(user.sub??user.id),Number(user.actorSub??user.actorId??user.sub??user.id));
  for(const n of new Set([who.effective,who.actor]))if(!await permission(q,n,'credit.approve-native'))fail('ND_ACTOR_FORBIDDEN',403);
  const window=await dataWindow(q);
  const rows=(await q(`SELECT TOP 100 r.SourceId AS soid,r.RequestId AS requestId,r.Status AS status,r.CreatedAtUtc AS requestedAt,
   h.DocuNo AS docuNo,h.AppvDocuNo AS aiNo,CONVERT(varchar(40),CONVERT(decimal(18,4),h.NetAmnt)) AS amount,h.EmpID,e.SalesUserId
   FROM wf.NativeDocumentRequest r JOIN dbo.SOHD h ON h.SOID=r.SourceId AND h.DocuType=103
   LEFT JOIN wf.SalesOrderExt e ON e.SOID=CONVERT(varchar(50),h.SOID)
   WHERE r.DocuType=104 AND r.SourceKind='SO' AND r.Status='PENDING' AND r.ExpiresAtUtc>GETUTCDATE() AND h.DocuDate>=@start
   ORDER BY r.CreatedAtUtc`,{start:input(sql.Date,window.businessDate)})).recordset;
  const result=[];
  for(const row of rows)if(await require('./native-document-scope').nativeOwnerInScope(who.user,row,q)){
   const {EmpID,SalesUserId,...safe}=row;result.push(safe);
  }
  return result;
 });
}
module.exports={inspectBooking,listCreditRequests};
