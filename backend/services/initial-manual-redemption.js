'use strict';
const {isInitialNativeUatTarget}=require('./initial-native-uat-target');
// UAT simulation only. This never creates weighing or physical shipment evidence.
const {createHash}=require('crypto');
const {sql,wfTransaction}=require('../db');
const {nativeFingerprint}=require('./initial-booking-ai');
const {deliverySnapshot,verifyReceipt,verifyDeliveryAccount}=require('./initial-delivery');
const {isInitialRedemptionTransition}=require('./redemption-transition');
const {getVisibleScope,inScope}=require('./visible-scope');
const {ACCESS_AS_ACTOR_ROLES,roleRank}=require('./role-capabilities');
const {CREATORS,REVIEWERS,mayCreate,decision}=require('./manual-redemption-policy');
const POLICY='O25-116-MANUAL-UAT2-v1';
const input=(type,value)=>({type,value});
const hash=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
function queryFor(tx){return async(text,inputs={})=>{
 const r=tx.request();for(const [key,{type,value}] of Object.entries(inputs))r.input(key,type,value);
 return r.query('SET ARITHABORT ON; SET ANSI_WARNINGS ON; '+text);
};}
async function identity(q,user){
 const effective=Number(user?.sub),actor=Number(user?.actorSub||user?.sub);
 if(![effective,actor].every(v=>Number.isSafeInteger(v)&&v>0))fail('MR_ACTOR_INVALID',401);
 const rows=(await q('SELECT Id,Role,IsActive,MustChangePassword,EmpId FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id IN(@user,@actor)',{user:input(sql.Int,effective),actor:input(sql.Int,actor)})).recordset||[];
 const me=rows.find(r=>Number(r.Id)===effective),real=rows.find(r=>Number(r.Id)===actor);
 if(![me,real].every(r=>r&&(r.IsActive===true||r.IsActive===1)&&!r.MustChangePassword))fail('MR_ACTOR_UNAVAILABLE',403);
 if(me.Role!==user.role||real.Role!==(user.actorRole||user.role))fail('MR_ROLE_CHANGED',403);
 if(actor!==effective&&(!ACCESS_AS_ACTOR_ROLES.includes(real.Role)||roleRank(real.Role)<roleRank(me.Role)))fail('MR_ACCESS_AS_FORBIDDEN',403);
 if(![...CREATORS,...REVIEWERS].includes(me.Role))fail('MR_ROLE_FORBIDDEN',403);
 return {effective,actor,role:me.Role,empId:me.EmpId};
}
const sourceInputs=source=>({source:input(sql.Int,source)});
async function context(q,source,user){
 const r=(await q(`SELECT r.*,h.DocuNo AS SourceNo,h.EmpID,e.SalesUserId FROM wf.NativeDeliveryReceipt r WITH(UPDLOCK,HOLDLOCK)
  JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=r.SourceSOID AND h.DocuType=103 AND h.BrchID=1
  LEFT JOIN wf.SalesOrderExt e ON e.SOID=CONVERT(varchar(50),h.SOID) WHERE r.SourceSOID=@source`,sourceInputs(source))).recordset?.[0];
 if(!r||!inScope(await getVisibleScope(user,q),{userId:r.SalesUserId,empId:r.EmpID}))fail('MR_SOURCE_NOT_FOUND',404);
 try{await verifyDeliveryAccount(q,r.SourceNo,r);await verifyReceipt(q,r);}catch{fail('MR_DELIVERY_DIVERGED');}
 return r;
}
async function redemptionSnapshot(q,id){
 const parts=[];for(const [table,order] of [['WFRedemtionHD','RedemtionID'],['WFRedemtionDT','Listno']]){
  const value=(await q(`SELECT COALESCE(CONVERT(nvarchar(max),(SELECT * FROM dbo.${table} WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@id ORDER BY ${order} FOR XML RAW,BINARY BASE64,ELEMENTS XSINIL)),N'') AS Snapshot`,{id:input(sql.Int,id)})).recordset?.[0]?.Snapshot;
  if(typeof value!=='string')fail('MR_SNAPSHOT_UNAVAILABLE',503);parts.push(value);
 }return parts;
}
async function redemptionHash(q,id){return hash(await redemptionSnapshot(q,id));}
async function eligible(q,r){
 const source=r.SourceSOID;
 const rows=(await q(`SELECT c.GoodQty AS Qty,c.CouponNo,h.DocuNo AS DeliveryNo
  FROM dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=c.DocuID AND h.DocuType=104
  JOIN dbo.SODT d WITH(UPDLOCK,HOLDLOCK) ON d.SOID=h.SOID AND d.ListNo=c.RefListno AND d.DocuType=104
  WHERE c.CouponID=@coupon AND c.GoodQty>0 AND c.RemaQty=c.GoodQty AND d.RemaQty=c.GoodQty
   AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE CouponID=c.CouponID)
   AND NOT EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@source,h.SOID))
   AND NOT EXISTS(SELECT 1 FROM wf.CouponReservation WITH(UPDLOCK,HOLDLOCK) WHERE CouponId=c.CouponID)
   AND NOT EXISTS(SELECT 1 FROM wf.ControlTicketOverlay WITH(UPDLOCK,HOLDLOCK) WHERE DocuId=c.CouponID)`,{...sourceInputs(source),coupon:input(sql.Int,r.CouponID)})).recordset||[];
 if(rows.length!==1)fail('MR_SOURCE_UNAVAILABLE');
 const date=(await q("SELECT CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120) AS BusinessDate")).recordset?.[0]?.BusinessDate;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))fail('MR_SNAPSHOT_UNAVAILABLE',503);
 return {fingerprint:hash([POLICY,r.SourceAfterHash,r.DeliveryAfterHash,date]),qty:String(rows[0].Qty),couponNo:rows[0].CouponNo,deliveryNo:rows[0].DeliveryNo};
}
const requestInputs=id=>({request:input(sql.VarChar(36),id)});
const dataHash=r=>hash([r.Reason,r.IssueName,r.CarLicense,r.EvidenceMode,r.Evidence]);
function evidenceFor(parent,current){return JSON.stringify({mode:'UAT_SIMULATION',version:1,source103:parent.SourceSOID,delivery104:parent.DeliverySOID,couponId:parent.CouponID,couponNo:parent.CouponNo,quantityTon:current.qty,basis:'owned native coupon, no scale measurement',physicalShipmentVerified:false});}
function requestView(r,who){return r?{requestId:r.RequestId,status:r.Status,reason:r.Reason,receiver:r.IssueName,plate:r.CarLicense,
 evidenceMode:r.EvidenceMode,evidence:JSON.parse(r.Evidence),expiresAt:r.ExpiresAt,selfApproval:r.SelfApproval==null?null:Boolean(r.SelfApproval),
 isRequester:Number(r.RequestedById)===who.effective&&Number(r.RequesterActorId)===who.actor,
 canApprove:r.Status==='PENDING'&&decision({role:who.role,actorId:who.actor,requesterActorId:Number(r.RequesterActorId)}).allowed}:null;}
function receiptView(r,replayed){return {soid:r.SourceSOID,redemptionId:r.RedemptionID,redemptionNo:r.RedemptionNo,
 couponId:r.CouponID,policyVersion:r.PolicyVersion,replayed,completed:true,evidenceMode:'UAT_SIMULATION',physicalShipmentVerified:false};}
async function verifyCompleted(q,parent,r){
 if(r.PolicyVersion!==POLICY||!r.RedemptionAfterHash||!r.DeliveryAfterHash)fail('MR_RECEIPT_DIVERGED');
 const current=await redemptionHash(q,r.RedemptionID);
 if(parent.DeliveryAfterHash!==r.DeliveryAfterHash||current!==r.RedemptionAfterHash){
  const {verifyInvoiceContinuation}=require('./initial-invoice-continuation');
  if(!await verifyInvoiceContinuation(q,parent,r,current))fail('MR_RECEIPT_DIVERGED');
 }
 const request=(await q('SELECT * FROM wf.NativeManualRedemptionRequest WHERE RequestId=@request',requestInputs(r.RequestId))).recordset?.[0];
 if(!request||request.Status!=='CONSUMED'||dataHash(request)!==r.ApprovedDataHash||request.ApprovedDataHash!==r.ApprovedDataHash)fail('MR_RECEIPT_DIVERGED');
}
async function initialManualRedemption({operation='preview',soid,user,requestId,fingerprint,reason,receiver,plate},options={}){
 if(!(options.enabled??(process.env.NATIVE_MANUAL_116_ENABLED==='true')))fail('MR_NOT_ENABLED',503);
 if(!['preview','request','approve','apply'].includes(operation))fail('MR_OPERATION_INVALID',400);
 if(!/^\d+$/.test(String(soid))||!Number.isSafeInteger(Number(soid))||Number(soid)<=0||Number(soid)>2147483647)fail('MR_SOURCE_INVALID',400);
 if(operation!=='preview'&&(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(requestId||''))||!/^[a-f0-9]{64}$/.test(String(fingerprint||''))))fail('MR_REQUEST_INVALID',400);
 if(operation==='request'&&(![reason,receiver,plate].every(v=>typeof v==='string')||reason.trim().length<10||reason.trim().length>500
  ||receiver.trim().length<1||receiver.length>100||plate.trim().length<1||plate.length>25
  ||!receiver.startsWith('UAT2 ')||!plate.startsWith('UAT2-')))fail('MR_SIMULATION_DETAILS_REQUIRED',400);
 soid=Number(soid);
 return (options.transaction||wfTransaction)(async tx=>{
  const q=queryFor(tx);
  const target=(await q("SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) AS ServerName,DB_NAME() AS DbName,DB_ID() AS DbId")).recordset?.[0];
  if(!isInitialNativeUatTarget(target))fail('MR_TARGET_NOT_SUPPORTED',403);
  const who=await identity(q,user);
  if(['request','apply'].includes(operation)&&!mayCreate(who.role))fail('MR_ROLE_FORBIDDEN',403);
  const lock=(await q("DECLARE @r int; EXEC @r=sp_getapplock @Resource='WF_INITIAL_DELIVERY_104',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000; SELECT @r AS LockResult")).recordset?.[0]?.LockResult;
  if(!Number.isInteger(lock)||lock<0)fail('MR_BUSY');
  const parent=await context(q,soid,user);
  const old=(await q('SELECT * FROM wf.NativeManualRedemptionReceipt WITH(UPDLOCK,HOLDLOCK) WHERE SourceSOID=@source',sourceInputs(soid))).recordset?.[0];
  if(old){
   if(operation!=='preview'&&(operation!=='apply'||old.RequestId!==requestId||old.Fingerprint!==fingerprint||Number(old.AppliedById)!==who.effective||Number(old.ApplierActorId)!==who.actor))fail('MR_REQUEST_CONFLICT');
   await verifyCompleted(q,parent,old);return receiptView(old,true);
  }
  const current=await eligible(q,parent);
  if(operation!=='preview'&&fingerprint!==current.fingerprint)fail('MR_PREVIEW_STALE');
  if(operation==='preview'){
   const r=(await q("SELECT TOP 1 * FROM wf.NativeManualRedemptionRequest WITH(UPDLOCK,HOLDLOCK) WHERE SourceSOID=@source AND Status IN('PENDING','APPROVED') ORDER BY RequestedAt DESC",sourceInputs(soid))).recordset?.[0];
   return {soid,...current,completed:false,evidenceMode:'UAT_SIMULATION',physicalShipmentVerified:false,canCreate:mayCreate(who.role),request:r&&r.Fingerprint===current.fingerprint?requestView(r,who):null};
  }
  let r=(await q('SELECT * FROM wf.NativeManualRedemptionRequest WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@request',requestInputs(requestId))).recordset?.[0];
  const owned=r&&Number(r.SourceSOID)===soid&&r.Fingerprint===fingerprint&&r.PolicyVersion===POLICY;
  if(operation==='request'){
   if(r){if(!owned||Number(r.RequestedById)!==who.effective||Number(r.RequesterActorId)!==who.actor||r.Reason!==reason.trim()||r.IssueName!==receiver.trim()||r.CarLicense!==plate.trim())fail('MR_REQUEST_CONFLICT');return requestView(r,who);}
   const active=(await q("SELECT TOP 1 * FROM wf.NativeManualRedemptionRequest WITH(UPDLOCK,HOLDLOCK) WHERE SourceSOID=@source AND Status IN('PENDING','APPROVED') ORDER BY RequestedAt DESC",sourceInputs(soid))).recordset?.[0];
   if(active&&(Number(active.RequestedById)!==who.effective||Number(active.RequesterActorId)!==who.actor))fail('MR_REQUEST_OWNED_BY_ANOTHER');
   const evidence=evidenceFor(parent,current);
   await q(`UPDATE wf.NativeManualRedemptionRequest SET Status='SUPERSEDED' WHERE SourceSOID=@source AND Status IN('PENDING','APPROVED');
    INSERT INTO wf.NativeManualRedemptionRequest(RequestId,SourceSOID,Fingerprint,DeliveryBeforeHash,RequestedById,RequesterActorId,Status,Reason,Evidence,EvidenceMode,IssueName,CarLicense,PolicyVersion)
    VALUES(@request,@source,@fingerprint,@before,@user,@actor,'PENDING',@reason,@evidence,'UAT_SIMULATION',@receiver,@plate,@policy);
    INSERT INTO wf.SalesOrderAudit(SoId,UserId,ActorUserId,Action,Note) VALUES(CONVERT(varchar(50),@source),@user,@actor,'MANUAL_116_REQUESTED',@request)`,{
    ...sourceInputs(soid),...requestInputs(requestId),fingerprint:input(sql.VarChar(64),fingerprint),before:input(sql.VarChar(64),parent.DeliveryAfterHash),
    user:input(sql.Int,who.effective),actor:input(sql.Int,who.actor),reason:input(sql.NVarChar(500),reason.trim()),evidence:input(sql.NVarChar(sql.MAX),evidence),receiver:input(sql.NVarChar(100),receiver.trim()),plate:input(sql.NVarChar(25),plate.trim()),policy:input(sql.VarChar(40),POLICY)});
   r=(await q('SELECT * FROM wf.NativeManualRedemptionRequest WHERE RequestId=@request',requestInputs(requestId))).recordset?.[0];
   if(!r)fail('MR_REQUEST_UNAVAILABLE',503);return requestView(r,who);
  }
  if(!owned)fail('MR_REQUEST_CONFLICT');
  if(r.EvidenceMode!=='UAT_SIMULATION'||r.Evidence!==evidenceFor(parent,current))fail('MR_REQUEST_CHANGED');
  if(r.Status==='APPROVED'&&r.ApprovedDataHash!==dataHash(r))fail('MR_REQUEST_CHANGED');
  if(operation==='approve'){
   const d=decision({role:who.role,actorId:who.actor,requesterActorId:Number(r.RequesterActorId)});
   if(!d.allowed)fail('MR_APPROVAL_FORBIDDEN',403);
   if(!/^\d+$/.test(String(who.empId||'')))fail('MR_APPROVER_MAPPING_REQUIRED',403);
   const emp=(await q('SELECT EmpID FROM dbo.EMEmp WHERE CONVERT(varchar(30),EmpID)=@emp',{emp:input(sql.VarChar(30),String(who.empId))})).recordset||[];
   if(emp.length!==1)fail('MR_APPROVER_MAPPING_REQUIRED',403);
   if(r.Status==='APPROVED'&&Number(r.ApprovedById)===who.effective&&Number(r.ApproverActorId)===who.actor)return requestView(r,who);
   if(r.Status!=='PENDING')fail('MR_REQUEST_CONFLICT');
   await q(`UPDATE wf.NativeManualRedemptionRequest SET Status='APPROVED',ApprovedById=@user,ApproverActorId=@actor,ApprovedAt=GETUTCDATE(),ExpiresAt=DATEADD(minute,30,GETUTCDATE()),SelfApproval=@self,ApprovedDataHash=@datahash WHERE RequestId=@request AND Status='PENDING';
    INSERT INTO wf.SalesOrderAudit(SoId,UserId,ActorUserId,Action,Note) VALUES(CONVERT(varchar(50),@source),@user,@actor,'MANUAL_116_APPROVED',@request)`,{
    ...sourceInputs(soid),...requestInputs(requestId),user:input(sql.Int,who.effective),actor:input(sql.Int,who.actor),self:input(sql.Bit,d.selfApproval),datahash:input(sql.VarChar(64),dataHash(r))});
   r=(await q('SELECT * FROM wf.NativeManualRedemptionRequest WHERE RequestId=@request',requestInputs(requestId))).recordset?.[0];
   if(!r||r.Status!=='APPROVED')fail('MR_REQUEST_UNAVAILABLE',503);return requestView(r,who);
  }
  if(r.Status!=='APPROVED'||Number(r.RequestedById)!==who.effective||Number(r.RequesterActorId)!==who.actor)fail('MR_APPROVAL_REQUIRED');
  const beforeParts=await deliverySnapshot(q,parent.DeliverySOID);
  const result=(await q('EXEC wf.usp_CreateInitialManualRedemption @SOID=@source,@RequestId=@request,@Fingerprint=@fingerprint,@UserId=@user,@ActorId=@actor',{
   ...sourceInputs(soid),...requestInputs(requestId),fingerprint:input(sql.VarChar(64),fingerprint),user:input(sql.Int,who.effective),actor:input(sql.Int,who.actor)})).recordset?.[0];
  if(!result||Number(result.CouponID)!==Number(parent.CouponID)||Number(result.DeliverySOID)!==Number(parent.DeliverySOID)||result.DeliveryBeforeHash!==parent.DeliveryAfterHash)fail('MR_RECEIPT_UNAVAILABLE',503);
  const proof=(await q(`SELECT d.RedemtionID FROM dbo.WFRedemtionDT d JOIN dbo.WFRedemtionHD h ON h.RedemtionID=d.RedemtionID AND h.DocuType=116
   JOIN dbo.WFCoupon c ON c.CouponID=d.CouponID
   JOIN wf.NativeManualRedemptionRequest rr ON rr.RequestId=@request
   JOIN wf.AppUser u ON u.Id=rr.ApprovedById JOIN dbo.EMEmp emp ON CONVERT(varchar(30),emp.EmpID)=u.EmpId
   JOIN dbo.SMAudit a ON a.audit_id=@audit AND a.audit_system=3 AND a.audit_screen=2098003052 AND a.audit_columnid=h.RedemtionID AND a.audit_docuno=h.DocuNo AND a.brchid=1
   JOIN dbo.SMEvent e ON e.eventid=@event AND e.systemid=3 AND e.objectid=2098003052 AND e.docuid=h.RedemtionID AND e.docuno=h.DocuNo AND e.brchid=1
   WHERE d.RedemtionID=@id AND d.CouponID=@coupon AND d.Listno=1 AND d.GoodQty=c.GoodQty
    AND d.GoodID=c.GoodID AND d.GoodUnitID=c.GoodUnitID AND d.InveID=c.InveID AND d.LocaID=c.LocaID AND d.GoodPrice=c.GoodPrice AND d.CouponNo=c.CouponNo
    AND h.DocuNo=@no AND h.AppvEmpID=emp.EmpID AND h.CarLicense=rr.CarLicense AND h.IssueName=rr.IssueName
    AND h.DocuDate=CONVERT(datetime,CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120),120)
    AND d.RemaQty=d.GoodQty AND d.PostInv='N' AND d.SOInvID IS NULL AND d.SOListNo IS NULL AND d.IsCheck='Y'
    AND h.DocuStatus='N' AND h.IsCheckAll='Y' AND h.SumGoodQty=d.GoodQty AND c.RemaQty=0`,{
    ...requestInputs(requestId),id:input(sql.Int,result.RedemptionID),coupon:input(sql.Int,parent.CouponID),no:input(sql.VarChar(25),result.RedemptionNo),
    audit:input(sql.Int,result.NativeAuditId),event:input(sql.Int,result.NativeEventId)})).recordset||[];
  if(proof.length!==1||await nativeFingerprint(q,soid)!==parent.SourceAfterHash)fail('MR_RECEIPT_DIVERGED');
  const afterParts=await deliverySnapshot(q,parent.DeliverySOID);
  if(!isInitialRedemptionTransition(beforeParts,afterParts))fail('MR_UNEXPECTED_NATIVE_CHANGE');
  const after=hash(afterParts),nativeHash=await redemptionHash(q,result.RedemptionID);
  // Advance only our own validated transition. Preserve the previous snapshot in
  // the new immutable receipt; never adopt a change made externally in WinSpeed.
  const updated=(await q(`UPDATE wf.NativeDeliveryReceipt SET DeliveryAfterHash=@after WHERE SourceSOID=@source AND DeliveryAfterHash=@before;
   SELECT @@ROWCOUNT AS Updated; UPDATE wf.NativeManualRedemptionReceipt SET DeliveryAfterHash=@after,RedemptionAfterHash=@native WHERE SourceSOID=@source AND RequestId=@request`,{
   ...sourceInputs(soid),...requestInputs(requestId),before:input(sql.VarChar(64),parent.DeliveryAfterHash),after:input(sql.VarChar(64),after),native:input(sql.VarChar(64),nativeHash)})).recordset?.[0]?.Updated;
  if(updated!==1)fail('MR_RECEIPT_DIVERGED');
  return receiptView(result,false);
 });
}
function manualRedemptionHttpError(e){
 if(e.status&&/^MR_[A-Z_]+$/.test(e.code||''))return {status:e.status,code:e.code};
 const code=/\b(MR_(?:TARGET_NOT_SUPPORTED|SOURCE_UNAVAILABLE|ACTOR_UNAVAILABLE|APPROVAL_REQUIRED|REQUEST_CONFLICT|COUNTER_UNSUPPORTED|NUMBER_EXHAUSTED|ID_CONFLICT|ID_EXHAUSTED))\b/.exec(String(e.message||''))?.[1];
 return {status:code?409:503,code:code||'MR_FAILED'};
}
module.exports={initialManualRedemption,manualRedemptionHttpError,redemptionHash,redemptionSnapshot,verifyCompleted,POLICY};
