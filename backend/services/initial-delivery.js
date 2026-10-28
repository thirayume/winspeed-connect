'use strict';
// Restricted UAT simulation: full single-line whole-bag zero-tax104, numbered
// C/D and202 receivable, with explicit Account credit approval. No116/107/GL.
const { createHash } = require('crypto');
const { sql, wfTransaction } = require('../db');
const { nativeFingerprint } = require('./initial-booking-ai');
const { getVisibleScope, inScope } = require('./visible-scope');
const { rolesFor, roleRank, ACCESS_AS_ACTOR_ROLES } = require('./role-capabilities');
const { bookOf, couponSeriesForBill } = require('./account-books');
const { isInitialNativeUatTarget } = require('./initial-native-uat-target');
const POLICY = 'O25-DO104-COMPLETE-UAT2-v2';
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
const hash = parts => createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex');
const input = (type, value) => ({ type, value });
const idInputs = soid => ({ soid: input(sql.Int, soid) });
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(value || ''));
function queryFor(tx) {
 return async (text, inputs = {}) => {
  const r = tx.request();
  for (const [key, { type, value }] of Object.entries(inputs)) r.input(key, type, value);
  return r.query('SET ARITHABORT ON; SET ANSI_WARNINGS ON; ' + text);
 };
}
async function identity(q, user, approval = false) {
 const effective = Number(user?.sub), actor = Number(user?.actorSub || user?.sub);
 if (![effective, actor].every(n => Number.isSafeInteger(n) && n > 0)) fail('DO_ACTOR_INVALID', 401);
 const rows = (await q(`SELECT Id,Role,IsActive,MustChangePassword FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK)
  WHERE Id IN(@effective,@actor)`, { effective: input(sql.Int,effective), actor: input(sql.Int,actor) })).recordset || [];
 const current = rows.find(r => Number(r.Id) === effective), real = rows.find(r => Number(r.Id) === actor);
 if (![current,real].every(r => r && (r.IsActive === true || r.IsActive === 1) && !r.MustChangePassword)) fail('DO_ACTOR_UNAVAILABLE',403);
 if (current.Role !== user.role || real.Role !== (user.actorRole || user.role)) fail('DO_ROLE_CHANGED',403);
 if (!rolesFor(approval ? 'credit.approve-native' : 'so.create-native-delivery').includes(current.Role)) fail('DO_ROLE_FORBIDDEN',403);
 if (actor !== effective && (!ACCESS_AS_ACTOR_ROLES.includes(real.Role) || roleRank(real.Role) < roleRank(current.Role))) fail('DO_ACCESS_AS_FORBIDDEN',403);
 return { effective, actor };
}
async function target(q) {
 const r = (await q(`SELECT CONVERT(NVARCHAR(128),SERVERPROPERTY('ServerName')) AS ServerName,DB_NAME() AS DbName,DB_ID() AS DbId`)).recordset?.[0];
 if (!isInitialNativeUatTarget(r)) fail('DO_TARGET_NOT_SUPPORTED',403);
}
async function xml(q, statement, inputs) {
 const r = (await q(`SELECT COALESCE(CONVERT(NVARCHAR(MAX),(${statement} FOR XML RAW,BINARY BASE64,ELEMENTS XSINIL)),N'') AS Snapshot`,inputs)).recordset?.[0];
 if (typeof r?.Snapshot !== 'string') fail('DO_SNAPSHOT_UNAVAILABLE',503);
 return r.Snapshot;
}
// Reconstruct only the four known initial AI header changes. All original native
// column order, exact decimals/nulls and remarks must still hash to confirmation.
async function confirmedFingerprint(q, soid) {
 const columns = (await q("SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('dbo.SOHD') ORDER BY column_id")).recordset || [];
 if (!columns.length || !['AppvFlag','AppvDocuNo','Appvid','AppvDate'].every(k => columns.some(c => c.name === k))) fail('DO_SCHEMA_UNSUPPORTED',503);
 const quote = name => '[' + String(name).replace(/]/g,']]') + ']';
 const select = columns.map(({name}) => {
  if (name === 'AppvFlag') return "CAST('W' AS VARCHAR(1)) AS [AppvFlag]";
  if (name === 'AppvDocuNo' || name === 'Appvid' || name === 'AppvDate') return 'NULL AS '+quote(name);
  return quote(name);
 }).join(',');
 const parts = [await xml(q,`SELECT ${select} FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@soid ORDER BY SOID`,idInputs(soid))];
 for (const [table,order] of [['SODT','ListNo'],['SOHDRemark','ListNo'],['SODTRemark','ListNo,RefListNo']]) {
  parts.push(await xml(q,`SELECT * FROM dbo.${table} WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@soid ORDER BY ${order}`,idInputs(soid)));
 }
 return hash(parts);
}
async function deliverySnapshot(q, soid) {
 const parts=[];
 for(const [table,key,order] of [['SOHD','SOID','SOID'],['SODT','SOID','ListNo'],['SOHDRemark','SOID','ListNo'],
  ['SODTRemark','SOID','ListNo,RefListNo'],['WFCoupon','DocuID','CouponID'],['Define_104','ID','ID']]) {
  parts.push(await xml(q,`SELECT * FROM dbo.${table} WITH(UPDLOCK,HOLDLOCK) WHERE ${key}=@soid ORDER BY ${order}`,idInputs(soid)));
 }
 for(const statement of [
  'SELECT h.* FROM dbo.SOInvHD h WITH(UPDLOCK,HOLDLOCK) WHERE h.Docutype=202 AND h.SOInvID IN(SELECT SOInvID FROM dbo.SOInvDT WITH(UPDLOCK,HOLDLOCK) WHERE RefID=@soid AND Docutype=202) ORDER BY h.SOInvID',
  'SELECT * FROM dbo.SOInvDT WITH(UPDLOCK,HOLDLOCK) WHERE RefID=@soid AND Docutype=202 ORDER BY SOInvID,ListNo',
  'SELECT v.* FROM dbo.VTVAT v WITH(UPDLOCK,HOLDLOCK) JOIN dbo.SOInvHD h ON h.PostID=v.FromID AND h.Docutype=v.FromFlag WHERE h.Docutype=202 AND h.SOInvID IN(SELECT SOInvID FROM dbo.SOInvDT WHERE RefID=@soid AND Docutype=202) ORDER BY v.VATID,v.ListNo',
  'SELECT s.* FROM dbo.SMSat s WITH(UPDLOCK,HOLDLOCK) JOIN dbo.SOInvHD h ON h.PostID=s.GlobalID AND h.Docutype=s.GlobalFlag WHERE h.Docutype=202 AND h.SOInvID IN(SELECT SOInvID FROM dbo.SOInvDT WHERE RefID=@soid AND Docutype=202) ORDER BY s.GlobalID',
 ])parts.push(await xml(q,statement,idInputs(soid)));
 return parts;
}
async function deliveryFingerprint(q,soid){return hash(await deliverySnapshot(q,soid));}
async function context(q,soid,user) {
 const row=(await q(`SELECT h.SOID,h.DocuNo,h.EmpID,h.CustID,h.AppvDocuNo,e.SalesUserId
  FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) LEFT JOIN wf.SalesOrderExt e WITH(UPDLOCK,HOLDLOCK) ON e.SOID=CONVERT(VARCHAR(50),h.SOID)
  WHERE h.SOID=@soid AND h.DocuType=103`,idInputs(soid))).recordset?.[0];
 if(!row || !inScope(await getVisibleScope(user,q),{userId:row.SalesUserId,empId:row.EmpID})) fail('DO_SOURCE_NOT_FOUND',404);
 if(!/^[IK]\d{2}-\d{5}$/.test(String(row.DocuNo||'')))fail('DO_ACCOUNT_MISMATCH');
 return row;
}
async function eligible(q,row,who) {
 const soid=Number(row.SOID), p={...idInputs(soid),cust:input(sql.Int,Number(row.CustID))};
 const origin=(await q('SELECT Fingerprint,PolicyVersion FROM wf.NativeBookingOrigin WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@soid',idInputs(soid))).recordset?.[0];
 if(!origin || origin.PolicyVersion!=='O11-AI-INITIAL-UAT2-v1') fail('DO_ORIGIN_REQUIRED');
 if(await confirmedFingerprint(q,soid)!==origin.Fingerprint) fail('DO_SOURCE_CHANGED');
 const checks=await q(`EXEC wf.usp_CreateCompleteInitialDelivery @SOID=@soid,@Preview=1,@RequestId=NULL,@Fingerprint=NULL,@UserId=@user,@ActorId=@actor`,
  {...idInputs(soid),user:input(sql.Int,who.effective),actor:input(sql.Int,who.actor)});
 const amount=checks.recordset?.[0]?.Amount;
 if(typeof amount!=='string' || !/^\d+\.\d{4}$/.test(amount)) fail('DO_AMOUNT_UNAVAILABLE',503);
 const detail=checks.recordset?.[0];
 if(detail.SourceBook!==bookOf(row.DocuNo)||detail.CouponSeries!==couponSeriesForBill(detail.SourceBook)
  || ![detail.PackKg,detail.SackQty].every(v=>typeof v==='string'&&/^\d+\.\d{4}$/.test(v)&&Number(v)>0))fail('DO_PREVIEW_UNAVAILABLE',503);
 const parts=[await nativeFingerprint(q,soid)];
 const statements=[
  'SELECT CustID,CreditState,CreditAmnt FROM dbo.EMCust WITH(UPDLOCK,HOLDLOCK) WHERE CustID=@cust',
  'SELECT BrchID,CreditTermSO FROM dbo.SOOption WITH(UPDLOCK,HOLDLOCK) WHERE BrchID=1',
  `SELECT * FROM dbo.SOInvHD WITH(UPDLOCK,HOLDLOCK) WHERE ARID=@cust AND DocuStatus<>'C' AND ReplaceFlag='N' AND CouponFlag='N'
   AND (DocuType IN(107,109,110,202) OR(DocuType=201 AND ISNULL(CkCreditTerm,'N')='Y')) ORDER BY SOInvID`,
  // Include all customer limit rows, even inactive ones, so edits cannot silently
  // reuse an earlier Account decision. Eligibility rejects active limit branches.
  `SELECT d.*,h.CreditStartDate,h.CreditEndDate FROM dbo.EMCustTempCreditDT d WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.EMCustTempCreditHD h WITH(UPDLOCK,HOLDLOCK) ON h.CreditID=d.CreditID WHERE d.CustID=@cust ORDER BY d.CreditID`,
  'SELECT * FROM dbo.SOCreditApprov WITH(UPDLOCK,HOLDLOCK) WHERE CustID=@cust ORDER BY CreditID',
  'SELECT CONVERT(VARCHAR(10),DATEADD(hour,7,GETUTCDATE()),120) AS BusinessDate',
  'SELECT g.GoodID,g.GoodWeight,g.ExpnID,u.GoodUnitID,u.GoodUnitCode FROM dbo.SODT d WITH(UPDLOCK,HOLDLOCK) JOIN dbo.EMGood g WITH(UPDLOCK,HOLDLOCK) ON g.GoodID=d.GoodID JOIN dbo.EMGoodUnit u WITH(UPDLOCK,HOLDLOCK) ON u.GoodUnitID=d.GoodUnitID2 WHERE d.SOID=@soid ORDER BY d.ListNo',
  "SELECT * FROM dbo.EMPeriod WITH(UPDLOCK,HOLDLOCK) WHERE PeriodType='N' AND CONVERT(DATETIME,CONVERT(VARCHAR(10),DATEADD(hour,7,GETUTCDATE()),120),120) BETWEEN BeginDate AND EndDate ORDER BY PeriodID",
 ];
 for(const statement of statements) parts.push(await xml(q,statement,p));
 return {fingerprint:hash(parts),amount,book:detail.SourceBook,couponSeries:detail.CouponSeries,packKg:detail.PackKg,sackQty:detail.SackQty};
}
const requestInputs=id=>({request:input(sql.VarChar(36),id)});
function requestView(r,who) {
 return r ? {requestId:r.RequestId,status:r.Status,expiresAt:r.ExpiresAt,selfApproval:r.SelfApproval==null?null:Boolean(r.SelfApproval),
  isRequester:Number(r.RequestedById)===who.effective && Number(r.RequesterActorId)===who.actor} : null;
}
function receiptView(r,replayed) {
 return {soid:r.SourceSOID,deliverySoid:r.DeliverySOID,deliveryNo:r.DeliveryNo,couponId:r.CouponID,createdAt:r.CreatedAt,
  couponNo:r.CouponNo,financeSoInvId:r.FinanceSOInvID,financePostId:r.FinancePostID,
  policyVersion:r.PolicyVersion,replayed,shipmentReady:false};
}
async function verifyReceipt(q,r) {
 if(!r.SourceAfterHash || !r.DeliveryAfterHash || await nativeFingerprint(q,r.SourceSOID)!==r.SourceAfterHash
  || await deliveryFingerprint(q,r.DeliverySOID)!==r.DeliveryAfterHash) fail('DO_RECEIPT_DIVERGED');
}
async function verifyDeliveryAccount(q,sourceNo,r) {
 const delivery=(await q(`SELECT DocuNo,DocuType FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK)
  WHERE SOID=@delivery AND DocuType=104`,{delivery:input(sql.Int,Number(r.DeliverySOID))})).recordset?.[0];
 if(!delivery || delivery.DocuNo!==r.DeliveryNo) fail('DO_RECEIPT_DIVERGED');
 // bookOf also understands C/D/J/N. Those are not valid103/104 bill numbers
 // under this initial contract, even when they map to the same account.
 const billBook=no=>/^[IK]\d{2}-\d{5}$/.test(String(no||'')) ? bookOf(no) : null;
 const sourceBook=billBook(sourceNo),deliveryBook=billBook(delivery.DocuNo);
 if(!sourceBook || !deliveryBook || sourceBook!==deliveryBook) fail('DO_ACCOUNT_MISMATCH');
 if(r.PolicyVersion!==POLICY || !r.CouponNo || !r.FinanceSOInvID || !r.FinancePostID || !r.FinanceVATID) fail('DO_LEGACY_RECEIPT_INCOMPLETE');
 if(!/^[CD]\d{7}$/.test(r.CouponNo) || !r.CouponNo.startsWith(couponSeriesForBill(deliveryBook)+delivery.DocuNo.slice(1,3))) fail('DO_COUPON_ACCOUNT_MISMATCH');
 const proof=(await q(`SELECT c.CouponID AS CompleteCouponID
  FROM dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK)
  JOIN dbo.SODT d WITH(UPDLOCK,HOLDLOCK) ON d.SOID=c.DocuID AND d.ListNo=c.RefListno AND d.DocuType=104
  JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=d.SOID AND h.DocuType=104 AND h.CouponFlag='Y'
  JOIN dbo.SOInvDT f WITH(UPDLOCK,HOLDLOCK) ON f.RefID=d.SOID AND f.RefListNo=d.ListNo AND f.Docutype=202
  JOIN dbo.SOInvHD a WITH(UPDLOCK,HOLDLOCK) ON a.SOInvID=f.SOInvID AND a.Docutype=202 AND a.CouponFlag='Y' AND a.StockEffc='N' AND a.PostGL='N'
  JOIN dbo.SMSat s WITH(UPDLOCK,HOLDLOCK) ON s.GlobalID=a.PostID AND s.GlobalFlag=202
  JOIN dbo.VTVAT v WITH(UPDLOCK,HOLDLOCK) ON v.FromID=a.PostID AND v.FromFlag=202
  WHERE c.CouponID=@coupon AND c.DocuID=@delivery AND c.Docutype=104 AND c.CouponNo=@couponNo
   AND c.SONo=h.DocuNo AND c.GoodID=d.GoodID AND c.GoodUnitID=d.GoodUnitID2 AND c.GoodPrice=d.GoodPrice2
   AND c.GoodQty=d.GoodQty2 AND c.ContainQty=@pack AND c.SackQty=@bags AND c.SackQty*c.ContainQty=c.GoodQty*1000
   AND a.SOInvID=@finance AND a.PostID=@post AND v.VATID=@vat AND a.DocuNo=h.DocuNo AND a.BrchID=h.BrchID
   AND f.GoodAmnt=h.NetAmnt AND a.NetAmnt=h.NetAmnt AND v.BaseAmnt=h.NetAmnt AND v.VatAmnt=0`,{
   delivery:input(sql.Int,Number(r.DeliverySOID)),coupon:input(sql.Int,Number(r.CouponID)),couponNo:input(sql.VarChar(25),r.CouponNo),
   finance:input(sql.Int,Number(r.FinanceSOInvID)),post:input(sql.Int,Number(r.FinancePostID)),vat:input(sql.Int,Number(r.FinanceVATID)),
   pack:input(sql.Decimal(18,4),r.ContainQty),bags:input(sql.Decimal(18,4),r.SackQty),
  })).recordset||[];
 if(proof.length!==1 || Number(proof[0].CompleteCouponID)!==Number(r.CouponID))fail('DO_COMPLETE_RECEIPT_DIVERGED');
}
async function initialDelivery({operation='preview',soid,user,requestId,fingerprint,reason},options={}) {
 if(!(options.enabled??(process.env.NATIVE_DELIVERY_104_ENABLED==='true'))) fail('DO_NOT_ENABLED',503);
 if(!['preview','request','approve','apply','list'].includes(operation)) fail('DO_OPERATION_INVALID',400);
 const approval=operation==='approve'||operation==='list';
 if(operation!=='list' && (!/^\d+$/.test(String(soid))||!Number.isSafeInteger(Number(soid))||Number(soid)<=0||Number(soid)>2147483647)) fail('DO_SOURCE_ID_INVALID',400);
 if(!['preview','list'].includes(operation) && (!uuid(requestId)||!/^[a-f0-9]{64}$/.test(String(fingerprint||'')))) fail('DO_REQUEST_INVALID',400);
 if(operation==='approve' && (typeof reason!=='string'||reason.trim().length<5||reason.trim().length>300)) fail('DO_REASON_REQUIRED',400);
 return (options.transaction||wfTransaction)(async tx=>{
  const q=queryFor(tx);await target(q);const who=await identity(q,user,approval);
  const lock=(await q(`DECLARE @r INT; EXEC @r=sp_getapplock @Resource='WF_INITIAL_DELIVERY_104',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000; SELECT @r AS LockResult`)).recordset?.[0]?.LockResult;
  if(!Number.isInteger(lock)||lock<0) fail('DO_BUSY');
  if(operation==='list') {
   return (await q(`SELECT TOP 50 r.SOID AS soid,r.RequestId AS requestId,r.Fingerprint AS fingerprint,
    CONVERT(VARCHAR(40),r.Amount) AS amount,r.RequestedAt AS requestedAt,h.DocuNo AS docuNo,h.AppvDocuNo AS aiNo
    FROM wf.NativeDeliveryRequest r JOIN dbo.SOHD h ON h.SOID=r.SOID AND h.DocuType=103
    WHERE r.Status='PENDING' AND r.PolicyVersion='O25-DO104-COMPLETE-UAT2-v2' ORDER BY r.Id`)).recordset||[];
  }
  soid=Number(soid);const row=await context(q,soid,user);
  const old=(await q('SELECT * FROM wf.NativeDeliveryReceipt WITH(UPDLOCK,HOLDLOCK) WHERE SourceSOID=@soid',idInputs(soid))).recordset?.[0];
  if(old) {
   if(operation!=='preview' && (operation!=='apply'||old.RequestId!==requestId||old.Fingerprint!==fingerprint
    ||Number(old.AppliedById)!==who.effective||Number(old.ApplierActorId)!==who.actor)) fail('DO_REQUEST_CONFLICT');
   await verifyDeliveryAccount(q,row.DocuNo,old);
   await verifyReceipt(q,old);return {...receiptView(old,true),completed:true};
  }
  const current=await eligible(q,row,who);
  if(operation!=='preview' && current.fingerprint!==fingerprint) fail('DO_PREVIEW_STALE');
  if(operation==='preview') {
   const r=(await q(`SELECT TOP 1 * FROM wf.NativeDeliveryRequest WITH(UPDLOCK,HOLDLOCK)
    WHERE SOID=@soid AND Status IN('PENDING','APPROVED') ORDER BY Id DESC`,idInputs(soid))).recordset?.[0];
   const active=r && r.Fingerprint===current.fingerprint ? r : null;
   return {soid,docuNo:row.DocuNo,aiNo:row.AppvDocuNo,...current,requiresCreditApproval:true,
    request:requestView(active,who),completed:false,shipmentReady:false};
  }
  let r=(await q('SELECT * FROM wf.NativeDeliveryRequest WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@request',requestInputs(requestId))).recordset?.[0];
  const owned=r && Number(r.SOID)===soid && r.Fingerprint===fingerprint && r.PolicyVersion===POLICY;
  if(operation==='request') {
   if(r) {
    if(!owned||Number(r.RequestedById)!==who.effective||Number(r.RequesterActorId)!==who.actor||!['PENDING','APPROVED'].includes(r.Status)) fail('DO_REQUEST_CONFLICT');
    return requestView(r,who);
   }
   const active=(await q(`SELECT TOP 1 * FROM wf.NativeDeliveryRequest WITH(UPDLOCK,HOLDLOCK)
    WHERE SOID=@soid AND Status IN('PENDING','APPROVED') ORDER BY Id DESC`,idInputs(soid))).recordset?.[0];
   if(active && (Number(active.RequestedById)!==who.effective||Number(active.RequesterActorId)!==who.actor)) fail('DO_REQUEST_OWNED_BY_ANOTHER');
   await q(`UPDATE wf.NativeDeliveryRequest SET Status='SUPERSEDED' WHERE SOID=@soid AND Status IN('PENDING','APPROVED');
    INSERT INTO wf.NativeDeliveryRequest(SOID,RequestId,Fingerprint,Amount,RequestedById,RequesterActorId,Status,PolicyVersion)
    SELECT @soid,@request,@fingerprint,NetAmnt,@user,@actor,'PENDING',@policy FROM dbo.SOHD WHERE SOID=@soid`,
    {...idInputs(soid),...requestInputs(requestId),fingerprint:input(sql.VarChar(64),fingerprint),user:input(sql.Int,who.effective),actor:input(sql.Int,who.actor),policy:input(sql.VarChar(40),POLICY)});
   await q(`INSERT INTO wf.SalesOrderAudit(SoId,UserId,ActorUserId,Action,Note)
    VALUES(CONVERT(VARCHAR(50),@soid),@user,@actor,'NATIVE_104_CREDIT_REQUESTED',@request)`,
    {...idInputs(soid),...requestInputs(requestId),user:input(sql.Int,who.effective),actor:input(sql.Int,who.actor)});
   r=(await q('SELECT * FROM wf.NativeDeliveryRequest WHERE RequestId=@request',requestInputs(requestId))).recordset?.[0];
   if(!r) fail('DO_REQUEST_UNAVAILABLE',503);return requestView(r,who);
  }
  if(!owned) fail('DO_REQUEST_CONFLICT');
  if(operation==='approve') {
   if(r.Status==='APPROVED' && Number(r.ApprovedById)===who.effective && Number(r.ApproverActorId)===who.actor
    && r.Reason===reason.trim()) return requestView(r,who);
   if(r.Status!=='PENDING') fail('DO_REQUEST_CONFLICT');
   await q(`UPDATE wf.NativeDeliveryRequest SET Status='APPROVED',ApprovedById=@user,ApproverActorId=@actor,
    ApprovedAt=GETUTCDATE(),ExpiresAt=DATEADD(minute,30,GETUTCDATE()),SelfApproval=CASE WHEN RequesterActorId=@actor THEN 1 ELSE 0 END,Reason=@reason
    WHERE RequestId=@request AND Status='PENDING';
    INSERT INTO wf.SalesOrderAudit(SoId,UserId,ActorUserId,Action,Note)
    VALUES(CONVERT(VARCHAR(50),@soid),@user,@actor,'NATIVE_104_CREDIT_APPROVED',@request)`,
    {...idInputs(soid),...requestInputs(requestId),user:input(sql.Int,who.effective),actor:input(sql.Int,who.actor),reason:input(sql.NVarChar(300),reason.trim())});
   r=(await q('SELECT * FROM wf.NativeDeliveryRequest WHERE RequestId=@request',requestInputs(requestId))).recordset?.[0];
   if(!r||r.Status!=='APPROVED') fail('DO_REQUEST_UNAVAILABLE',503);return requestView(r,who);
  }
  if(r.Status!=='APPROVED'||Number(r.RequestedById)!==who.effective||Number(r.RequesterActorId)!==who.actor) fail('DO_CREDIT_APPROVAL_REQUIRED');
  const result=(await q(`EXEC wf.usp_CreateCompleteInitialDelivery @SOID=@soid,@Preview=0,@RequestId=@request,@Fingerprint=@fingerprint,@UserId=@user,@ActorId=@actor`,
   {...idInputs(soid),...requestInputs(requestId),fingerprint:input(sql.VarChar(64),fingerprint),user:input(sql.Int,who.effective),actor:input(sql.Int,who.actor)})).recordset?.[0];
  if(!result) fail('DO_RECEIPT_UNAVAILABLE',503);
  await verifyDeliveryAccount(q,row.DocuNo,result);
  const sourceHash=await nativeFingerprint(q,soid),deliveryHash=await deliveryFingerprint(q,result.DeliverySOID);
  await q(`UPDATE wf.NativeDeliveryReceipt SET SourceAfterHash=@sourceHash,DeliveryAfterHash=@deliveryHash WHERE SourceSOID=@soid AND RequestId=@request`,
   {...idInputs(soid),...requestInputs(requestId),sourceHash:input(sql.VarChar(64),sourceHash),deliveryHash:input(sql.VarChar(64),deliveryHash)});
  return receiptView(result,false);
 });
}
function deliveryHttpError(e) {
 if(e.status && /^DO_[A-Z_]+$/.test(e.code||'')) return {status:e.status,code:e.code};
 const known=/\b(DO_(?:TARGET_NOT_SUPPORTED|SOURCE_UNAVAILABLE|CONTRACT_UNSUPPORTED|CREDIT_CONTRACT_UNSUPPORTED|COUNTER_UNSUPPORTED|COUPON_COUNTER_UNSUPPORTED|PACKAGING_UNSUPPORTED|PERIOD_UNSUPPORTED|NUMBER_EXHAUSTED|CREDIT_APPROVAL_REQUIRED|ACTOR_UNAVAILABLE|REQUEST_CONFLICT|ID_CONFLICT|ID_EXHAUSTED))\b/.exec(String(e.message||''));
 return known ? {status:409,code:known[1]} : {status:503,code:'DO_FAILED'};
}
module.exports={initialDelivery,deliveryHttpError,confirmedFingerprint,deliveryFingerprint,deliverySnapshot,verifyReceipt,verifyDeliveryAccount,POLICY};
