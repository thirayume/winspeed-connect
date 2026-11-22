'use strict';
const {sql}=require('../db');
const {createHash}=require('crypto');
const {nativeOwnerInScope}=require('./native-document-scope');
const {couponVisible,beneficiaryCustomerVisible,reservationsVisible}=require('./coupon-access-scope');
const {assertSettledSourcesUnchanged}=require('./coupon-settlement-source-fence');
const {readTicketUseExpiry,assertCouponReservationCoverage,assertNoUnreservedLegacyReferences}=require('./coupon-service');
const {heldReservationExpirySql,resolveHoldPolicy}=require('./coupon-authorization-hold');
const {boundaries,DEFAULT_START_DATE}=require('./data-window');
const {id,date,fail,planDelivery,planRedemption,planInvoice}=require('./native-document-plan');
const hash=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const input=(type,value)=>({type,value});
const ip=value=>({source:input(sql.Int,id(value))});
const amount=column=>`CONVERT(varchar(40),CONVERT(decimal(18,4),${column}))`;
async function dataWindow(q){
 const raw=(await q("SELECT SettingValue FROM wf.SystemSetting WITH(UPDLOCK,HOLDLOCK) WHERE SettingKey='GLOBAL_DATA_START_DATE'")).recordset?.[0]?.SettingValue;
 return boundaries(raw==null||raw===''?DEFAULT_START_DATE:String(raw).trim());
}
async function snapshot(q,select,inputs){
 const value=(await q(`SELECT COALESCE(CONVERT(nvarchar(max),(${select} FOR XML RAW,BINARY BASE64,ELEMENTS XSINIL)),N'') AS Snapshot`,inputs)).recordset?.[0]?.Snapshot;
 if(typeof value!=='string')fail('ND_SNAPSHOT_UNAVAILABLE',503);return value;
}
async function creditSummary(q,cust,amount){
 const window=await dataWindow(q);
 // credit-service reads independent policies with Promise.all. A mssql
 // Transaction owns one connection and cannot execute simultaneous requests.
 let tail=Promise.resolve();
 const lockedQuery=(text,p)=>{const next=tail.then(()=>q(text.replace(/WITH\s*\(NOLOCK\)/gi,'WITH(UPDLOCK,HOLDLOCK)'),p));tail=next;return next;};
 return require('./credit-service').checkCustomerCreditAndAging(String(cust),amount,{
  wfQuery:lockedQuery,
  getSettingValue:async key=>(await lockedQuery('SELECT SettingValue FROM wf.SystemSetting WITH(UPDLOCK,HOLDLOCK) WHERE SettingKey=@key',
   {key:input(sql.NVarChar(100),key)})).recordset?.[0]?.SettingValue,
  readGlobalDataWindow:async()=>window,
 });
}
async function order(q,source,user,{allowOpening=false}={}){
 const p=ip(source);
 const row=(await q(`SELECT h.SOID AS soid,h.DocuNo AS docNo,h.DocuType AS docType,h.EmpID,h.CustID AS custId,h.AppvFlag,h.AppvDocuNo,
  CONVERT(varchar(10),h.DocuDate,120) AS docDate,CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120) AS today,e.SalesUserId,
  ${amount('h.SumGoodAmnt')} AS gross,${amount('ISNULL(h.BillDiscAmnt,0)')} AS discount,${amount('h.BillAftrDiscAmnt')} AS taxBase,
  ${amount('ISNULL(h.VatAmnt,0)')} AS tax,${amount('h.NetAmnt')} AS net,${amount('ISNULL(h.VatRate,0)')} AS vatRate,h.VatType AS vatType
  FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) LEFT JOIN wf.SalesOrderExt e WITH(UPDLOCK,HOLDLOCK) ON e.SOID=CONVERT(varchar(50),h.SOID)
  WHERE h.SOID=@source AND h.DocuType IN(103,104)`,p)).recordset?.[0];
 if(!row||!await nativeOwnerInScope(user,row,q))fail('ND_SOURCE_NOT_FOUND',404);
 const window=await dataWindow(q);
 if(!allowOpening&&row.docDate<window.businessDate)fail('ND_SOURCE_BEFORE_CUTOFF',404);
 row.lines=(await q(`SELECT d.ListNo AS [lineNo],d.GoodID AS goodId,d.GoodName AS goodName,${amount('d.GoodQty2')} AS quantity,${amount('d.RemaQty')} AS remaining,
  ${amount('d.GoodPrice2')} AS price,${amount('d.GoodAmnt')} AS amount,${amount('g.GoodWeight')} AS packKg,
  CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM wf.RebateTicketRedemptionReceipt r WITH(UPDLOCK,HOLDLOCK)
   JOIN wf.RebateTicketReceiptState s WITH(UPDLOCK,HOLDLOCK) ON s.ReceiptId=r.Id AND s.Status IN('RESERVED','FINAL')
   WHERE r.BookingSOID=CASE WHEN d.DocuType=103 THEN d.SOID ELSE d.RefSOID END
    AND r.BookingLineNo=CASE WHEN d.DocuType=103 THEN d.ListNo ELSE d.RefListNo END AND r.Treatment='ZERO') THEN 1 ELSE 0 END) AS rebateTicketVerified
  FROM dbo.SODT d WITH(UPDLOCK,HOLDLOCK) JOIN dbo.EMGood g WITH(HOLDLOCK) ON g.GoodID=d.GoodID WHERE d.SOID=@source ORDER BY d.ListNo`,p)).recordset||[];
 const parts=[];
 for(const [table,key,sort] of [['SOHD','SOID','SOID'],['SODT','SOID','ListNo'],['SOHDRemark','SOID','ListNo'],['SODTRemark','SOID','ListNo,RefListNo'],
  ['SalesOrderExt','SOID','SOID'],['NativeBookingOrigin','SOID','SOID']]){
  const schema=['SalesOrderExt','NativeBookingOrigin'].includes(table)?'wf':'dbo';
  parts.push(await snapshot(q,`SELECT * FROM ${schema}.${table} WITH(UPDLOCK,HOLDLOCK) WHERE ${key}=@source ORDER BY ${sort}`,p));
 }
 parts.push(await snapshot(q,'SELECT g.* FROM dbo.EMGood g WITH(HOLDLOCK) WHERE g.GoodID IN(SELECT GoodID FROM dbo.SODT WHERE SOID=@source) ORDER BY g.GoodID',p));
 parts.push(await snapshot(q,`SELECT p.* FROM wf.PriceApproval p WITH(UPDLOCK,HOLDLOCK) JOIN wf.SalesOrderExt e ON e.SourceDraftId=p.SoId WHERE e.SOID=CONVERT(varchar(50),@source) ORDER BY p.Id`,p));
 return {row,parts,p};
}
async function delivery(q,source,user){
 const {row,p,parts}=await order(q,source,user);
 if(row.docType!==103||row.AppvFlag!=='Y'||!row.AppvDocuNo)fail('ND_BOOKING_APPROVAL_REQUIRED');
 const origin=(await q('SELECT Fingerprint FROM wf.NativeBookingOrigin WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@source',p)).recordset?.[0];
 const {confirmedFingerprint}=require('./initial-delivery');
 if(!origin||await confirmedFingerprint(q,source)!==origin.Fingerprint)fail('ND_ORIGIN_CHANGED');
 for(const select of [
  'SELECT * FROM dbo.EMCust WITH(UPDLOCK,HOLDLOCK) WHERE CustID=@cust',
  'SELECT * FROM wf.CustomerExt WITH(UPDLOCK,HOLDLOCK) WHERE CustId=@cust',
  'SELECT * FROM wf.CreditMaster WITH(UPDLOCK,HOLDLOCK) WHERE CustId=@cust',
  'SELECT g.* FROM dbo.EMCustGroup g WITH(UPDLOCK,HOLDLOCK) JOIN dbo.EMCust c WITH(HOLDLOCK) ON c.CustGroupID=g.CustGroupID WHERE c.CustID=@cust',
  "SELECT * FROM wf.SystemSetting WITH(UPDLOCK,HOLDLOCK) WHERE SettingKey LIKE 'CREDIT[_]%' ORDER BY SettingKey",
  `SELECT SOInvID,ARID,DocuType,DocuDate,DueDate,DocuStatus,ReplaceFlag,CouponFlag,Sign,NetAmnt,RemaAmnt
   FROM dbo.SOInvHD WITH(UPDLOCK,HOLDLOCK) WHERE ARID=@cust AND DocuStatus<>'C' AND RemaAmnt<>0 ORDER BY SOInvID`,
  `SELECT d.*,h.CreditStartDate,h.CreditEndDate FROM dbo.EMCustTempCreditDT d WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.EMCustTempCreditHD h WITH(UPDLOCK,HOLDLOCK) ON h.CreditID=d.CreditID WHERE d.CustID=@cust ORDER BY d.CreditID`,
  'SELECT * FROM dbo.SOCreditApprov WITH(UPDLOCK,HOLDLOCK) WHERE CustID=@cust ORDER BY CreditID'
 ])parts.push(await snapshot(q,select,{cust:input(sql.Int,row.custId)}));
 const credit=await creditSummary(q,row.custId,row.net);
 if(credit.creditHold)fail('ND_CUSTOMER_CREDIT_HOLD');
 return {plan:planDelivery(row),sourceHash:hash([row.today,...parts]),row};
}
async function booking(q,source,user){
 const {row,p,parts}=await order(q,source,user);
 if(row.docType!==103||row.AppvFlag!=='W'||row.AppvDocuNo)fail('ND_BOOKING_UNAVAILABLE');
 const origin=(await q('SELECT Fingerprint FROM wf.NativeBookingOrigin WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@source',p)).recordset?.[0];
 const {nativeFingerprint}=require('./initial-booking-ai');
 if(!origin||await nativeFingerprint(q,source)!==origin.Fingerprint)fail('ND_ORIGIN_CHANGED');
 if((await q(`SELECT TOP 1 1 AS found FROM wf.PriceApproval p WITH(UPDLOCK,HOLDLOCK) JOIN wf.SalesOrderExt e ON e.SourceDraftId=p.SoId
   WHERE e.SOID=CONVERT(varchar(50),@source) AND p.Status='PENDING'`,p)).recordset?.length)fail('ND_PRICE_APPROVAL_PENDING');
 return {plan:{version:'NATIVE-DOCUMENTS-v3',kind:119,soid:id(source),lines:[]},sourceHash:hash([row.today,...parts]),row};
}
async function redemption(q,tx,source,user,selection,inputData){
 const cust=id(source),docDate=date(inputData.docDate),window=await dataWindow(q),holdPolicy=await resolveHoldPolicy(text=>q(text));
 if(docDate<window.businessDate)fail('ND_SOURCE_BEFORE_CUTOFF',404);
 if(!await beneficiaryCustomerVisible(user,cust,window,q))fail('ND_CUSTOMER_NOT_FOUND',404);
 if(!Array.isArray(selection)||!selection.length||selection.length>100)fail('ND_LINES_INVALID',400);
 const coupons=[],reservations=[],parts=[];
 const ids=selection.map(r=>id(r.couponId)).sort((a,b)=>a-b);
 if(new Set(ids).size!==ids.length)fail('ND_DUPLICATE_LINE',400);
 for(const cid of ids){
  const p={coupon:input(sql.Int,cid),cust:input(sql.VarChar(50),String(cust)),date:input(sql.VarChar(10),docDate)};
  const row=(await q(`SELECT c.CouponID AS couponId,c.CouponNo AS couponNo,c.DocuID AS deliveryId,c.RefListno AS sourceLineNo,c.GoodID AS goodId,
   h.DocuNo AS deliveryNo,h.CustID AS ownerCustId,${amount('c.RemaQty')} AS remaining,
   ${amount(`ISNULL((SELECT SUM(cr.ReservedQty-ISNULL(cr.ConsumedQty,0)) FROM wf.CouponReservation cr WITH(UPDLOCK,HOLDLOCK)
     WHERE cr.CouponId=c.CouponID AND cr.Status='RESERVED' AND ${heldReservationExpirySql('cr',holdPolicy,true)}),0)`)} AS reserved,
   CONVERT(bit,CASE WHEN h.CustID=CONVERT(int,@cust) OR EXISTS(SELECT 1 FROM wf.CouponBeneficiary b WITH(UPDLOCK,HOLDLOCK)
    WHERE b.OwnerCustId=CONVERT(varchar(50),h.CustID) AND b.BeneficiaryCustId=@cust AND b.Status='ACTIVE'
     AND(b.EffectiveFrom IS NULL OR b.EffectiveFrom<=CONVERT(datetime,@date,120)) AND(b.EffectiveTo IS NULL OR b.EffectiveTo>=CONVERT(datetime,@date,120))
     AND(b.EffectiveFrom IS NULL OR b.EffectiveFrom<=CONVERT(date,DATEADD(hour,7,GETUTCDATE())))
     AND(b.EffectiveTo IS NULL OR b.EffectiveTo>=CONVERT(date,DATEADD(hour,7,GETUTCDATE())))
     AND(b.Scope='ALL' OR b.Scope=CONVERT(varchar(50),c.GoodID))) THEN 1 ELSE 0 END) AS beneficiaryValid
   FROM dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=c.DocuID
   WHERE c.CouponID=@coupon AND c.Docutype=104 AND h.DocuType=104 AND h.DocuStatus<>'C' AND h.DocuDate<=CONVERT(datetime,@date,120)`,p)).recordset?.[0];
  if(!row||!row.beneficiaryValid)fail('ND_COUPON_NOT_FOUND',404);
  row.inScope=await couponVisible(user,cid,q)||Number(row.ownerCustId)!==cust;
  if(!row.inScope)fail('ND_COUPON_NOT_FOUND',404);
  await assertCouponReservationCoverage(tx,cid);
  await assertNoUnreservedLegacyReferences(tx,row.couponNo);
  await assertSettledSourcesUnchanged(tx,cid);
  const expiry=await readTicketUseExpiry(tx,cid);
  row.expiryDate=expiry.expiryDate;row.expired=expiry.expired;row.custId=cust;
  coupons.push(row);
  const held=(await q(`SELECT CONVERT(varchar(30),cr.Id) AS id,cr.CouponId AS couponId,cr.BeneficiaryCustId AS custId,cr.Revision AS revision,
   ${amount('ISNULL(cr.ConsumedQty,0)')} AS consumed,${amount('cr.ReservedQty-ISNULL(cr.ConsumedQty,0)')} AS remaining,
   CONVERT(bit,CASE WHEN cr.Status='RESERVED' AND(cr.ExpiresAt IS NULL OR cr.ExpiresAt>GETUTCDATE()) THEN 1 ELSE 0 END) AS active,
   CONVERT(bit,CASE WHEN ${holdPolicy.bridge?'wf.fn_CouponBridgeReservationHeld(cr.Id)=1 OR ':''}EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorizationLine al WITH(UPDLOCK,HOLDLOCK)
    JOIN wf.CouponNativeCutAuthorization ah WITH(UPDLOCK,HOLDLOCK) ON ah.Id=al.AuthorizationId
    WHERE al.ReservationId=cr.Id AND(ah.State='ACTIVE' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH(UPDLOCK,HOLDLOCK) WHERE e.AuthorizationLineId=al.Id))) THEN 1 ELSE 0 END) AS nativeHeld
   FROM wf.CouponReservation cr WITH(UPDLOCK,HOLDLOCK) WHERE cr.CouponId=@coupon ORDER BY cr.Id`,p)).recordset||[];
  for(const r of held){r.inScope=await reservationsVisible(user,[r.id],q);reservations.push(r);}
  for(const select of ['SELECT * FROM dbo.WFCoupon WITH(UPDLOCK,HOLDLOCK) WHERE CouponID=@coupon',
   `SELECT h.* FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) JOIN dbo.WFCoupon c WITH(HOLDLOCK) ON c.DocuID=h.SOID WHERE c.CouponID=@coupon`,
   `SELECT d.* FROM dbo.SODT d WITH(UPDLOCK,HOLDLOCK) JOIN dbo.WFCoupon c WITH(HOLDLOCK)
    ON c.DocuID=d.SOID AND c.RefListno=d.ListNo WHERE c.CouponID=@coupon`,
   'SELECT cr.* FROM wf.CouponReservation cr WITH(UPDLOCK,HOLDLOCK) WHERE cr.CouponId=@coupon ORDER BY cr.Id',
   'SELECT * FROM wf.ControlTicketOverlay WITH(UPDLOCK,HOLDLOCK) WHERE DocuId=@coupon',
   'SELECT * FROM wf.CouponExpiry WITH(UPDLOCK,HOLDLOCK) WHERE CouponId=@coupon',
   `SELECT b.* FROM wf.CouponBeneficiary b WITH(UPDLOCK,HOLDLOCK) WHERE b.BeneficiaryCustId=@cust ORDER BY b.Id`])
   parts.push(await snapshot(q,select,p));
 }
 const plan=planRedemption({custId:cust,docDate,coupons,reservations},selection);
 const text=(v,max)=>typeof v==='string'&&v.trim()&&v.trim().length<=max?v.trim():fail('ND_SLIP_INVALID',400);
 Object.assign(plan,{slipNo:text(inputData.slipNo,25),receiver:text(inputData.receiver,100),plate:text(inputData.plate,25),exception:true});
 if(!/^\d{1,25}$/.test(plan.slipNo))fail('ND_SLIP_INVALID',400);
 // A typed slip requires a manager/admin decision and does not claim scale evidence.
 return {plan,sourceHash:hash(parts),row:{custId:cust},physicalShipmentVerified:false};
}
async function assertReplayScope(q,receipt,request,user){
 if(receipt.DocuType!==116){
  await order(q,receipt.SourceId,user,{allowOpening:receipt.DocuType===107});
 }else{
  const window=await dataWindow(q),cust=Number(receipt.SourceId),saved=JSON.parse(request.InputJson);
  if(date(saved.data.docDate)<window.businessDate)fail('ND_SOURCE_BEFORE_CUTOFF',404);
  if(!await beneficiaryCustomerVisible(user,cust,window,q))fail('ND_CUSTOMER_NOT_FOUND',404);
  for(const line of saved.lines){
   const row=(await q(`SELECT h.CustID AS ownerCustId,
    CONVERT(bit,CASE WHEN h.CustID=@cust OR EXISTS(SELECT 1 FROM wf.CouponBeneficiary b WITH(HOLDLOCK)
     WHERE b.OwnerCustId=CONVERT(varchar(50),h.CustID) AND b.BeneficiaryCustId=CONVERT(varchar(50),@cust)
      AND b.Status='ACTIVE' AND(b.Scope='ALL' OR b.Scope=CONVERT(varchar(50),c.GoodID))
      AND(b.EffectiveFrom IS NULL OR b.EffectiveFrom<=CONVERT(date,DATEADD(hour,7,GETUTCDATE())))
      AND(b.EffectiveTo IS NULL OR b.EffectiveTo>=CONVERT(date,DATEADD(hour,7,GETUTCDATE())))) THEN 1 ELSE 0 END) AS allowed
    FROM dbo.WFCoupon c WITH(HOLDLOCK) JOIN dbo.SOHD h WITH(HOLDLOCK) ON h.SOID=c.DocuID
    WHERE c.CouponID=@coupon AND c.DocuType=104 AND h.DocuType=104 AND h.DocuStatus<>'C'`,
    {cust:input(sql.Int,cust),coupon:input(sql.Int,id(line.couponId))})).recordset?.[0];
   if(!row?.allowed||(Number(row.ownerCustId)===cust&&!await couponVisible(user,line.couponId,q)))fail('ND_COUPON_NOT_FOUND',404);
  }
 }
 if(receipt.DocuType===107){
  const window=await dataWindow(q),saved=JSON.parse(request.InputJson);
  if(date(saved.data.docDate)<window.businessDate)fail('ND_SOURCE_BEFORE_CUTOFF',404);
 }
}
async function invoice(q,source,user,selection,inputData){
 const {row,p,parts}=await order(q,source,user,{allowOpening:true});
 if(row.docType!==104)fail('ND_DELIVERY_REQUIRED');
 if(!Array.isArray(selection)||!selection.length||selection.length>100)fail('ND_LINES_INVALID',400);
 const cuts=[];
 for(const wanted of selection){
  const cut=id(wanted.redemptionId),line=id(wanted.lineNo);
  const r=(await q(`SELECT d.RedemtionID AS redemptionId,d.Listno AS [lineNo],c.RefListno AS sourceLineNo,c.DocuID AS deliveryId,
   CONVERT(varchar(10),h.DocuDate,120) AS docDate,${amount('d.GoodQty')} AS quantity,
   CONVERT(bit,CASE WHEN d.PostInv='N' AND d.SOInvID IS NULL AND d.RemaQty=d.GoodQty AND d.IsCheck='Y' AND h.IsCheckAll='Y' AND h.DocuStatus='N' THEN 1 ELSE 0 END) AS uninvoiced
   FROM dbo.WFRedemtionDT d WITH(UPDLOCK,HOLDLOCK) JOIN dbo.WFRedemtionHD h WITH(UPDLOCK,HOLDLOCK) ON h.RedemtionID=d.RedemtionID AND h.DocuType=116
   JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=d.CouponID WHERE d.RedemtionID=@cut AND d.Listno=@line AND c.DocuID=@source`,
   {...p,cut:input(sql.Int,cut),line:input(sql.Int,line)})).recordset?.[0];
  if(!r)fail('ND_CUT_SOURCE_MISMATCH');cuts.push(r);
  parts.push(await snapshot(q,'SELECT * FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@cut',{cut:input(sql.Int,cut)}));
  parts.push(await snapshot(q,'SELECT * FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@cut ORDER BY Listno',{cut:input(sql.Int,cut)}));
 }
 row.deliveryId=id(source);row.deliveryNo=row.docNo;row.docDate=date(inputData.docDate);
 if(row.docDate<(await dataWindow(q)).businessDate)fail('ND_SOURCE_BEFORE_CUTOFF',404);
 for(const r of row.lines){
  const prior=(await q(`SELECT ${amount('ISNULL(SUM(d.GoodQty2),0)')} AS qty,${amount('ISNULL(SUM(d.GoodAmnt),0)')} AS gross
   FROM dbo.SOInvDT d WITH(UPDLOCK,HOLDLOCK) WHERE d.RefID=@source AND d.RefListNo=@line AND d.Docutype=107`,{...p,line:input(sql.Int,r.lineNo)})).recordset[0];
  const priorDiscount=(await q(`SELECT ${amount('ISNULL(SUM(l.DiscountAmount),0)')} AS discount FROM wf.NativeDocumentReceiptLine l WITH(UPDLOCK,HOLDLOCK)
   JOIN wf.NativeDocumentReceipt h WITH(UPDLOCK,HOLDLOCK) ON h.RequestId=l.RequestId
   JOIN dbo.SOInvDT d WITH(UPDLOCK,HOLDLOCK) ON d.SOInvID=h.NativeId AND d.ListNo=l.NativeLineNo
   WHERE h.DocuType=107 AND d.RefID=@source AND d.RefListNo=@line`,{...p,line:input(sql.Int,r.lineNo)})).recordset[0];
  Object.assign(r,{invoicedQuantity:prior.qty,invoicedGross:prior.gross,invoicedDiscount:priorDiscount.discount});
 }
 row.priorTax=(await q(`SELECT ${amount('ISNULL(SUM(h.VATAmnt),0)')} AS tax FROM dbo.SOInvHD h WITH(UPDLOCK,HOLDLOCK) WHERE h.Docutype=107
   AND h.SOInvID IN(SELECT SOInvID FROM dbo.SOInvDT WITH(UPDLOCK,HOLDLOCK) WHERE RefID=@source AND Docutype=107)`,p)).recordset[0].tax;
 for(const select of [
  'SELECT h.* FROM dbo.SOInvHD h WITH(UPDLOCK,HOLDLOCK) WHERE h.SOInvID IN(SELECT SOInvID FROM dbo.SOInvDT WITH(UPDLOCK,HOLDLOCK) WHERE RefID=@source AND Docutype IN(202,107)) ORDER BY h.SOInvID',
  'SELECT * FROM dbo.SOInvDT WITH(UPDLOCK,HOLDLOCK) WHERE RefID=@source AND Docutype IN(202,107) ORDER BY SOInvID,ListNo',
  'SELECT * FROM wf.NativeDocumentReceipt WITH(UPDLOCK,HOLDLOCK) WHERE SourceId=@source OR NativeId=@source ORDER BY RequestId'
 ])parts.push(await snapshot(q,select,p));
 return {plan:planInvoice(row,cuts),sourceHash:hash(parts),row};
}
module.exports={hash,input,snapshot,dataWindow,order,booking,delivery,redemption,invoice,assertReplayScope,creditSummary};
