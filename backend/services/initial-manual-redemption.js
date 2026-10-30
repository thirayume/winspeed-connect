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
// The requester's employee becomes WinSpeed's recorder (SaveEmpID); the approver's
// employee must be enabled in wf.NativeApproverEmployee and is kept in wf only.
async function employee(q,empId,code){
 if(!/^\d+$/.test(String(empId||'')))fail(code,403);
 const rows=(await q('SELECT e.EmpID,a.IsEnabled AS ApproverEnabled FROM dbo.EMEmp e LEFT JOIN wf.NativeApproverEmployee a ON a.EmpID=e.EmpID WHERE CONVERT(varchar(30),e.EmpID)=@emp',{emp:input(sql.VarChar(30),String(empId))})).recordset||[];
 if(rows.length!==1)fail(code,403);
 return rows[0];
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
   AND NOT EXISTS(SELECT 1 FROM wf.CouponReservation WITH(UPDLOCK,HOLDLOCK) WHERE CouponId=c.CouponID)
   AND NOT EXISTS(SELECT 1 FROM wf.ControlTicketOverlay WITH(UPDLOCK,HOLDLOCK) WHERE DocuId=c.CouponID)`,{...sourceInputs(source),coupon:input(sql.Int,r.CouponID)})).recordset||[];
 if(rows.length!==1)fail('MR_SOURCE_UNAVAILABLE');
 const date=(await q("SELECT CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120) AS BusinessDate")).recordset?.[0]?.BusinessDate;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))fail('MR_SNAPSHOT_UNAVAILABLE',503);
 return {fingerprint:hash([POLICY,r.SourceAfterHash,r.DeliveryAfterHash,date]),qty:String(rows[0].Qty),couponNo:rows[0].CouponNo,deliveryNo:rows[0].DeliveryNo};
}
const requestInputs=id=>({request:input(sql.VarChar(36),id)});
const dataHash=r=>hash([r.Reason,r.IssueName,r.CarLicense,r.EvidenceMode,r.Evidence]);
// Owner31Oct2026: the 116 number is the transport slip. With the booking's completed scale
// record it is the MoveBill and the vehicle is the scale's; net weight within 2% of the coupon
// is normal. Without one the requester types the 7-digit slip number. Outside 2%, or without a
// scale record, the request is an exception that a manager other than the requester approves.
async function slipFor(q,parent,qty){
 const rows=(await q(`SELECT Id,SPID,RTRIM(MoveBill) AS MoveBill,RTRIM(CarNo) AS CarNo,WeightNet,RTRIM(Status) AS Status
  FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@source,@delivery)`,{...sourceInputs(parent.SourceSOID),delivery:input(sql.Int,parent.DeliverySOID)})).recordset||[];
 if(!rows.length)return {source:'MANUAL',exception:true};
 const w=rows[0];
 if(rows.length!==1||Number(w.SPID)!==Number(parent.SourceSOID))fail('MR_SCALE_AMBIGUOUS');
 if(w.Status!=='3'||!/^\d{7}$/.test(w.MoveBill||'')||!(Number(w.WeightNet)>0)||!w.CarNo||w.CarNo.length>25)fail('MR_SCALE_INCOMPLETE');
 const kg=Number(qty)*1000,net=Number(w.WeightNet);
 return {source:'SCALE',slipNo:w.MoveBill,plate:w.CarNo,scaleEventId:Number(w.Id),netKg:net,
  diffPct:Math.round((net-kg)/kg*10000)/100,exception:Math.abs(net-kg)>Number(qty)*20};
}
const effectiveSlip=(slip,r)=>slip.source==='MANUAL'?{...slip,slipNo:r.SlipNo,plate:r.CarLicense}:slip;
const slipMatches=(r,s)=>r.SlipNo===s.slipNo&&r.SlipSource===s.source&&Boolean(r.ExceptionRequired)===s.exception&&r.CarLicense===s.plate
 &&(s.source==='MANUAL'||(Number(r.ScaleEventId)===s.scaleEventId&&Number(r.ScaleNetKg)===s.netKg));
function slipView(s,current){return {source:s.source,slipNo:s.slipNo??null,plate:s.plate??null,netKg:s.netKg??null,diffPct:s.diffPct??null,
 couponTon:current.qty,tolerancePct:2,exception:s.exception};}
function evidenceFor(parent,current,slip){return JSON.stringify({mode:'UAT_SIMULATION',version:2,source103:parent.SourceSOID,delivery104:parent.DeliverySOID,couponId:parent.CouponID,couponNo:parent.CouponNo,quantityTon:current.qty,
 slip:{source:slip.source,no:slip.slipNo,vehicle:slip.plate,scaleEventId:slip.scaleEventId??null,netKg:slip.netKg??null,exception:slip.exception},
 basis:slip.source==='SCALE'?'scale record of the booking':'typed transport slip, no scale record',physicalShipmentVerified:false});}
function mayApprove(r,who){
 const d=decision({role:who.role,actorId:who.actor,requesterActorId:Number(r.RequesterActorId)});
 return {...d,exceptionBlocked:Boolean(r.ExceptionRequired)&&(!REVIEWERS.includes(who.role)||d.selfApproval)};
}
function requestView(r,who){if(!r)return null;const d=mayApprove(r,who);return {requestId:r.RequestId,status:r.Status,reason:r.Reason,receiver:r.IssueName,plate:r.CarLicense,
 slipNo:r.SlipNo,slipSource:r.SlipSource,exceptionRequired:Boolean(r.ExceptionRequired),scaleNetKg:r.ScaleNetKg??null,
 evidenceMode:r.EvidenceMode,evidence:JSON.parse(r.Evidence),expiresAt:r.ExpiresAt,selfApproval:r.SelfApproval==null?null:Boolean(r.SelfApproval),
 isRequester:Number(r.RequestedById)===who.effective&&Number(r.RequesterActorId)===who.actor,
 canApprove:r.Status==='PENDING'&&d.allowed&&!d.exceptionBlocked};}
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
async function initialManualRedemption({operation='preview',soid,user,requestId,fingerprint,reason,receiver,plate,slipNo},options={}){
 if(!(options.enabled??(process.env.NATIVE_MANUAL_116_ENABLED==='true')))fail('MR_NOT_ENABLED',503);
 if(!['preview','request','approve','apply'].includes(operation))fail('MR_OPERATION_INVALID',400);
 if(!/^\d+$/.test(String(soid))||!Number.isSafeInteger(Number(soid))||Number(soid)<=0||Number(soid)>2147483647)fail('MR_SOURCE_INVALID',400);
 if(operation!=='preview'&&(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(requestId||''))||!/^[a-f0-9]{64}$/.test(String(fingerprint||''))))fail('MR_REQUEST_INVALID',400);
 if(operation==='request'&&(![reason,receiver].every(v=>typeof v==='string')||reason.trim().length<10||reason.trim().length>500
  ||receiver.trim().length<1||receiver.length>100||!receiver.startsWith('UAT2 ')
  ||(plate!=null&&(typeof plate!=='string'||plate.length>25))||(slipNo!=null&&typeof slipNo!=='string')))fail('MR_SIMULATION_DETAILS_REQUIRED',400);
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
   const slip=await slipFor(q,parent,current.qty);
   return {soid,...current,slip:slipView(slip,current),completed:false,evidenceMode:'UAT_SIMULATION',physicalShipmentVerified:false,canCreate:mayCreate(who.role),request:r&&r.Fingerprint===current.fingerprint?requestView(r,who):null};
  }
  let r=(await q('SELECT * FROM wf.NativeManualRedemptionRequest WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@request',requestInputs(requestId))).recordset?.[0];
  const owned=r&&Number(r.SourceSOID)===soid&&r.Fingerprint===fingerprint&&r.PolicyVersion===POLICY;
  if(operation==='request'){
   await employee(q,who.empId,'MR_RECORDER_MAPPING_REQUIRED');
   const scale=await slipFor(q,parent,current.qty);
   let use=scale;
   if(scale.source==='MANUAL'){
    const typed=String(slipNo||'').trim(),vehicle=String(plate||'').trim();
    if(!/^\d{7}$/.test(typed))fail('MR_SLIP_REQUIRED',400);
    use={...scale,slipNo:typed,plate:vehicle};
   }
   // UAT simulation: test slips use the 99xxxxx range and test vehicles, never a real slip or truck.
   if(!/^99\d{5}$/.test(use.slipNo)||!String(use.plate||'').startsWith('UAT2-'))fail('MR_SIMULATION_DETAILS_REQUIRED',400);
   if(r){if(!owned||Number(r.RequestedById)!==who.effective||Number(r.RequesterActorId)!==who.actor||r.Reason!==reason.trim()||r.IssueName!==receiver.trim()||!slipMatches(r,use))fail('MR_REQUEST_CONFLICT');return requestView(r,who);}
   const active=(await q("SELECT TOP 1 * FROM wf.NativeManualRedemptionRequest WITH(UPDLOCK,HOLDLOCK) WHERE SourceSOID=@source AND Status IN('PENDING','APPROVED') ORDER BY RequestedAt DESC",sourceInputs(soid))).recordset?.[0];
   if(active&&(Number(active.RequestedById)!==who.effective||Number(active.RequesterActorId)!==who.actor))fail('MR_REQUEST_OWNED_BY_ANOTHER');
   const used=(await q(`SELECT (SELECT COUNT(*) FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuNo=@slip) AS Documents,
    (SELECT COUNT(*) FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE RTRIM(MoveBill)=@slip AND NOT(WGType='SO' AND SPID=@source)) AS OtherScale,
    (SELECT COUNT(*) FROM wf.NativeManualRedemptionRequest WITH(UPDLOCK,HOLDLOCK) WHERE SlipNo=@slip AND Status IN('PENDING','APPROVED') AND SourceSOID<>@source) AS Requests`,
    {...sourceInputs(soid),slip:input(sql.VarChar(25),use.slipNo)})).recordset?.[0]||{};
   if(Number(used.Documents)||Number(used.OtherScale)||Number(used.Requests))fail('MR_SLIP_IN_USE');
   const evidence=evidenceFor(parent,current,use);
   await q(`UPDATE wf.NativeManualRedemptionRequest SET Status='SUPERSEDED' WHERE SourceSOID=@source AND Status IN('PENDING','APPROVED');
    INSERT INTO wf.NativeManualRedemptionRequest(RequestId,SourceSOID,Fingerprint,DeliveryBeforeHash,RequestedById,RequesterActorId,Status,Reason,Evidence,EvidenceMode,IssueName,CarLicense,PolicyVersion,
     SlipNo,SlipSource,ScaleEventId,ScaleNetKg,CouponTon,ExceptionRequired)
    VALUES(@request,@source,@fingerprint,@before,@user,@actor,'PENDING',@reason,@evidence,'UAT_SIMULATION',@receiver,@plate,@policy,
     @slip,@slipsource,@scaleevent,@scalenet,@couponton,@exception);
    INSERT INTO wf.SalesOrderAudit(SoId,UserId,ActorUserId,Action,Note) VALUES(CONVERT(varchar(50),@source),@user,@actor,'MANUAL_116_REQUESTED',@request)`,{
    ...sourceInputs(soid),...requestInputs(requestId),fingerprint:input(sql.VarChar(64),fingerprint),before:input(sql.VarChar(64),parent.DeliveryAfterHash),
    user:input(sql.Int,who.effective),actor:input(sql.Int,who.actor),reason:input(sql.NVarChar(500),reason.trim()),evidence:input(sql.NVarChar(sql.MAX),evidence),receiver:input(sql.NVarChar(100),receiver.trim()),plate:input(sql.NVarChar(25),use.plate),policy:input(sql.VarChar(40),POLICY),
    slip:input(sql.VarChar(25),use.slipNo),slipsource:input(sql.VarChar(20),use.source),scaleevent:input(sql.Int,use.scaleEventId??null),scalenet:input(sql.Int,use.netKg??null),
    couponton:input(sql.Decimal(18,4),current.qty),exception:input(sql.Bit,use.exception)});
   r=(await q('SELECT * FROM wf.NativeManualRedemptionRequest WHERE RequestId=@request',requestInputs(requestId))).recordset?.[0];
   if(!r)fail('MR_REQUEST_UNAVAILABLE',503);return requestView(r,who);
  }
  if(!owned)fail('MR_REQUEST_CONFLICT');
  const slip=effectiveSlip(await slipFor(q,parent,current.qty),r);
  if(r.EvidenceMode!=='UAT_SIMULATION'||r.Evidence!==evidenceFor(parent,current,slip)||!slipMatches(r,slip))fail('MR_REQUEST_CHANGED');
  if(r.Status==='APPROVED'&&r.ApprovedDataHash!==dataHash(r))fail('MR_REQUEST_CHANGED');
  if(operation==='approve'){
   const d=mayApprove(r,who);
   if(!d.allowed)fail('MR_APPROVAL_FORBIDDEN',403);
   if(d.exceptionBlocked)fail('MR_EXCEPTION_APPROVER_REQUIRED',403);
   const approver=await employee(q,who.empId,'MR_APPROVER_MAPPING_REQUIRED');
   if(!(approver.ApproverEnabled===true||approver.ApproverEnabled===1))fail('MR_APPROVER_NOT_LISTED',403);
   if(r.Status==='APPROVED'&&Number(r.ApprovedById)===who.effective&&Number(r.ApproverActorId)===who.actor)return requestView(r,who);
   if(r.Status!=='PENDING')fail('MR_REQUEST_CONFLICT');
   await q(`UPDATE wf.NativeManualRedemptionRequest SET Status='APPROVED',ApprovedById=@user,ApproverActorId=@actor,ApprovedAt=GETUTCDATE(),ExpiresAt=DATEADD(minute,30,GETUTCDATE()),SelfApproval=@self,ApprovedDataHash=@datahash WHERE RequestId=@request AND Status='PENDING';
    INSERT INTO wf.SalesOrderAudit(SoId,UserId,ActorUserId,Action,Note) VALUES(CONVERT(varchar(50),@source),@user,@actor,'MANUAL_116_APPROVED',@request)`,{
    ...sourceInputs(soid),...requestInputs(requestId),user:input(sql.Int,who.effective),actor:input(sql.Int,who.actor),self:input(sql.Bit,d.selfApproval),datahash:input(sql.VarChar(64),dataHash(r))});
   r=(await q('SELECT * FROM wf.NativeManualRedemptionRequest WHERE RequestId=@request',requestInputs(requestId))).recordset?.[0];
   if(!r||r.Status!=='APPROVED')fail('MR_REQUEST_UNAVAILABLE',503);return requestView(r,who);
  }
  if(r.Status!=='APPROVED'||Number(r.RequestedById)!==who.effective||Number(r.RequesterActorId)!==who.actor)fail('MR_APPROVAL_REQUIRED');
  await employee(q,who.empId,'MR_RECORDER_MAPPING_REQUIRED');
  const beforeParts=await deliverySnapshot(q,parent.DeliverySOID);
  const result=(await q('EXEC wf.usp_CreateInitialManualRedemption @SOID=@source,@RequestId=@request,@Fingerprint=@fingerprint,@UserId=@user,@ActorId=@actor',{
   ...sourceInputs(soid),...requestInputs(requestId),fingerprint:input(sql.VarChar(64),fingerprint),user:input(sql.Int,who.effective),actor:input(sql.Int,who.actor)})).recordset?.[0];
  if(!result||Number(result.CouponID)!==Number(parent.CouponID)||Number(result.DeliverySOID)!==Number(parent.DeliverySOID)||result.DeliveryBeforeHash!==parent.DeliveryAfterHash)fail('MR_RECEIPT_UNAVAILABLE',503);
  const proof=(await q(`SELECT d.RedemtionID FROM dbo.WFRedemtionDT d JOIN dbo.WFRedemtionHD h ON h.RedemtionID=d.RedemtionID AND h.DocuType=116
   JOIN dbo.WFCoupon c ON c.CouponID=d.CouponID
   JOIN wf.NativeManualRedemptionRequest rr ON rr.RequestId=@request
   JOIN wf.AppUser ru ON ru.Id=rr.RequestedById JOIN dbo.EMEmp rec ON CONVERT(varchar(30),rec.EmpID)=ru.EmpId
   JOIN wf.AppUser au ON au.Id=rr.ApprovedById JOIN dbo.EMEmp apv ON CONVERT(varchar(30),apv.EmpID)=au.EmpId
   JOIN wf.NativeDocumentApproval na ON na.DocuType=116 AND na.NativeDocID=h.RedemtionID AND na.NativeDocNo=h.DocuNo AND na.RequestId=rr.RequestId
    AND na.RecorderUserId=rr.RequestedById AND na.RecorderActorId=rr.RequesterActorId AND na.RecorderEmpID=rec.EmpID
    AND na.ApproverUserId=rr.ApprovedById AND na.ApproverActorId=rr.ApproverActorId AND na.ApproverEmpID=apv.EmpID
    AND na.SelfApproval=rr.SelfApproval AND na.ApprovedAt=rr.ApprovedAt
   JOIN dbo.SMAudit a ON a.audit_id=@audit AND a.audit_system=3 AND a.audit_screen=2098003052 AND a.audit_columnid=h.RedemtionID AND a.audit_docuno=h.DocuNo AND a.brchid=1
   JOIN dbo.SMEvent e ON e.eventid=@event AND e.systemid=3 AND e.objectid=2098003052 AND e.docuid=h.RedemtionID AND e.docuno=h.DocuNo AND e.brchid=1
   WHERE d.RedemtionID=@id AND d.CouponID=@coupon AND d.Listno=1 AND d.GoodQty=c.GoodQty
    AND d.GoodID=c.GoodID AND d.GoodUnitID=c.GoodUnitID AND d.InveID=c.InveID AND d.LocaID=c.LocaID AND d.GoodPrice=c.GoodPrice AND d.CouponNo=c.CouponNo
    AND h.DocuNo=@no AND h.DocuNo=rr.SlipNo AND h.SaveEmpID=rec.EmpID AND h.AppvEmpID IS NULL AND h.CarLicense=rr.CarLicense AND h.IssueName=rr.IssueName
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
 const code=/\b(MR_(?:TARGET_NOT_SUPPORTED|SOURCE_UNAVAILABLE|ACTOR_UNAVAILABLE|APPROVAL_REQUIRED|RECORDER_MAPPING_REQUIRED|APPROVER_NOT_LISTED|SLIP_INVALID|SLIP_IN_USE|SCALE_CHANGED|EXCEPTION_APPROVER_REQUIRED|REQUEST_CONFLICT|COUNTER_UNSUPPORTED|NUMBER_EXHAUSTED|ID_CONFLICT|ID_EXHAUSTED))\b/.exec(String(e.message||''))?.[1];
 return {status:code?409:503,code:code||'MR_FAILED'};
}
module.exports={initialManualRedemption,manualRedemptionHttpError,redemptionHash,redemptionSnapshot,verifyCompleted,POLICY};
