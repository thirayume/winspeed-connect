'use strict';
const {sql,wfTransaction}=require('../db');
const {businessIds}=require('./business-identity');
const {roleRank}=require('./role-capabilities');
const {adminApprovesOwn,approvalIdentity}=require('./approval-identity');
const target=require('./native-document-target');
const source=require('./native-document-source');
const {fail,id}=require('./native-document-plan');
const {verifyOperationalMetadata}=require('./initial-invoice-metadata');
const {readApprovedSalesVat}=require('./native-sales-vat-approval');
const {input,hash,snapshot}=source;
const TYPES=new Set([119,104,116,107]);
const PERMISSIONS={119:'so.approve-native',104:'so.create-native-delivery',116:'coupon.request116',107:'invoice.post-native'};
const FLAGS={119:'NATIVE_BOOKING_AI_ENABLED',104:'NATIVE_DELIVERY_104_ENABLED',116:'NATIVE_MANUAL_116_ENABLED',107:'NATIVE_INVOICE_107_ENABLED'};
const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(value||''));
const fingerprint=value=>/^[a-f0-9]{64}$/.test(String(value||''));
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function attrs(object){return Object.entries(object).filter(([,v])=>v!==undefined&&v!==null&&typeof v!=='object').map(([k,v])=>`${k}="${escape(typeof v==='boolean'?(v?1:0):v)}"`).join(' ');}
function planXml(plan,sourceId){
 return `<plan ${attrs({...plan,type:plan.kind,sourceId})}>${(plan.lines||[]).map(l=>`<line ${attrs(l)}>${(l.settlements||[]).map(s=>`<settlement ${attrs(s)}/>`).join('')}</line>`).join('')}</plan>`;
}
function queryFor(tx){return async(text,inputs={})=>{
 const r=tx.request();for(const [key,{type,value}]of Object.entries(inputs))r.input(key,type,value);
 return r.query('SET ARITHABORT ON;SET ANSI_WARNINGS ON;SET ANSI_PADDING ON;SET CONCAT_NULL_YIELDS_NULL ON;SET NUMERIC_ROUNDABORT OFF;'+text);
};}
async function liveUser(q,effective,actor,primaryEffective=effective,primaryActor=actor){
 const users=(await q(`SELECT Id,Role,EmpId,IsActive,MustChangePassword FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id IN(@u,@a)`,
  {u:input(sql.Int,id(effective)),a:input(sql.Int,id(actor))})).recordset||[];
 const me=users.find(r=>Number(r.Id)===effective),real=users.find(r=>Number(r.Id)===actor);
 if(![me,real].every(r=>r&&r.IsActive&&!r.MustChangePassword))fail('ND_ACTOR_UNAVAILABLE',403);
 async function roles(n){return(await q(`SELECT DISTINCT p.BaseRole FROM wf.vUserRole u WITH(HOLDLOCK) JOIN wf.RoleProfile p WITH(HOLDLOCK) ON p.Code=u.RoleCode WHERE u.UserId=@u`,
  {u:input(sql.Int,n)})).recordset.map(r=>r.BaseRole);}
 const effectiveRoles=await roles(effective),actorRoles=effective===actor?effectiveRoles:await roles(actor);
 const user={sub:primaryEffective,actorSub:primaryActor,role:me.Role,roles:effectiveRoles,actorRole:real.Role,actorRoles,isImpersonating:effective!==actor,
  identityMapping:{primaryEffectiveUserId:primaryEffective,primaryActorUserId:primaryActor,businessEffectiveUserId:effective,businessActorUserId:actor}};
 if(effective!==actor&&(roleRank(real.Role)<roleRank(me.Role)||!await permission(q,actor,'access-as')))fail('ND_ACCESS_AS_FORBIDDEN',403);
 return {effective,actor,primaryEffective,primaryActor,user,empId:Number(me.EmpId)};
}
async function permission(q,user,code){
 return Number((await q('SELECT wf.fn_UserHasPermission(@u,@p) AS Allowed',{u:input(sql.Int,user),p:input(sql.VarChar(80),code)})).recordset?.[0]?.Allowed)===1;
}
async function requirePermission(q,who,code,alternate=null){
 for(const n of new Set([who.effective,who.actor]))if(!await permission(q,n,code)&&(!alternate||!await permission(q,n,alternate)))fail('ND_ACTOR_FORBIDDEN',403);
}
async function audit(q,who,key,action,before,after,reason){
 await q(`INSERT wf.ChangeEvent(EntityType,EntityId,Action,BeforeJson,AfterJson,ReasonCode,ReasonText,UserId,ActorUserId)
  VALUES('NATIVE_DOCUMENT',@key,@action,@before,@after,'NATIVE_DOCUMENT',@reason,@u,@a)`,{
  key:input(sql.VarChar(100),key),action:input(sql.VarChar(30),action),before:input(sql.NVarChar(sql.MAX),before?JSON.stringify(before):null),
  after:input(sql.NVarChar(sql.MAX),JSON.stringify({...after,primaryUserId:who.primaryEffective,primaryActorId:who.primaryActor})),
  reason:input(sql.NVarChar(500),reason),u:input(sql.VarChar(50),String(who.effective)),a:input(sql.VarChar(50),String(who.actor))});
}
async function readSource(q,tx,type,sourceId,user,lines,data){
 if(type===119)return source.booking(q,sourceId,user);
 if(type===104)return source.delivery(q,sourceId,user);
 if(type===116)return source.redemption(q,tx,sourceId,user,lines,data);
 return source.invoice(q,sourceId,user,lines,data);
}
async function assertAiApprover(q,who,row){
 const listed=(await q('SELECT IsEnabled FROM wf.NativeApproverEmployee WITH(UPDLOCK,HOLDLOCK) WHERE EmpID=@emp',{emp:input(sql.Int,who.empId)})).recordset?.[0];
 if(!listed?.IsEnabled)fail('ND_APPROVER_NOT_LISTED',403);
 if((Number(row.SalesUserId)===who.effective||Number(row.EmpID)===who.empId)&&!adminApprovesOwn(approvalIdentity(who.user)))fail('ND_SELF_APPROVAL',403);
}
async function approveAllowed(q,who,request){
 if(request.DocuType===104)return requirePermission(q,who,'credit.approve-native');
 await requirePermission(q,who,'coupon.manual116');
 // Manual slips have no verified scale proof: the exact quantities, recipient
 // and vehicle require a separate manager decision (ADMIN may approve itself).
 for(const perspective of [who.user,{role:who.user.actorRole,roles:who.user.actorRoles}]){
  const roles=perspective.roles||[perspective.role];
  if(!roles.includes('ADMIN')&&(!roles.some(r=>['MANAGER','C_LEVEL'].includes(r))||who.actor===Number(request.ActorUserId)))fail('ND_116_APPROVAL_REQUIRED',403);
 }
}
function publicRequest(r){return {requestId:r.RequestId,status:r.Status,revision:r.Revision,expiresAt:r.ExpiresAtUtc,docuType:r.DocuType,sourceId:r.SourceId};}
function publicReceipt(r,lines,replayed){return {requestId:r.RequestId,docuType:r.DocuType,sourceId:r.SourceId,nativeId:r.NativeId,nativeNo:r.NativeNo,
 financeId:r.FinanceId,policyVersion:r.PolicyVersion,completed:true,replayed,lines};}
// Hash only immutable native facts. Later cuts, invoicing and the accountant's
// GL work must not invalidate a legitimate replay of the earlier operation.
async function nativeProof(q,receipt){
 const p={n:input(sql.Int,receipt.NativeId),r:input(sql.VarChar(36),receipt.RequestId)},parts=[];
 if(receipt.DocuType===119){
  parts.push(await snapshot(q,"SELECT SOID,DocuNo,AppvFlag,Appvid,AppvDocuNo,AppvDate FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@n AND DocuType=103",p));
 }else if(receipt.DocuType===104){
  parts.push(await snapshot(q,`SELECT SOID,DocuNo,CustID,DocuDate,SumGoodAmnt,BillDiscAmnt,BillAftrDiscAmnt,VatAmnt,NetAmnt,CouponFlag
   FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@n AND DocuType=104`,p));
  parts.push(await snapshot(q,`SELECT d.ListNo,d.GoodID,d.GoodQty2,d.GoodPrice2,d.GoodAmnt,d.RefSOID,d.RefListNo,c.CouponID,c.CouponNo,c.GoodQty,c.GoodPrice,c.ContainQty,c.SackQty
   FROM dbo.SODT d WITH(UPDLOCK,HOLDLOCK) JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.DocuID=d.SOID AND c.RefListno=d.ListNo
   WHERE d.SOID=@n ORDER BY d.ListNo,c.CouponID`,p));
  parts.push(await snapshot(q,`SELECT f.SOInvID,f.DocuNo,f.CustID,f.ARID,f.DocuDate,f.SumGoodAmnt,f.BillDiscAmnt,f.BillAftrDiscAmnt,f.VATAmnt,f.NetAmnt,f.CouponFlag,f.StockEffc
   FROM dbo.SOInvHD f WITH(UPDLOCK,HOLDLOCK) JOIN wf.NativeDocumentReceipt r ON r.FinanceId=f.SOInvID WHERE r.RequestId=@r AND f.Docutype=202`,p));
  parts.push(await snapshot(q,`SELECT d.ListNo,d.RefID,d.RefListNo,d.GoodAmnt,d.ExpnID,d.TotaExcludeAmnt,d.VatType,d.VatRate,d.VATGroupID
   FROM dbo.SOInvDT d WITH(UPDLOCK,HOLDLOCK) JOIN wf.NativeDocumentReceipt r ON r.FinanceId=d.SOInvID WHERE r.RequestId=@r ORDER BY d.ListNo`,p));
  parts.push(await snapshot(q,`SELECT v.VATID,v.BaseAmnt,v.VatAmnt,v.VatRate,v.VatType,v.VATGroupID,v.FromFlag,v.FromID
   FROM dbo.VTVAT v WITH(UPDLOCK,HOLDLOCK) JOIN dbo.SOInvHD f ON f.PostID=v.FromID AND f.Docutype=v.FromFlag
   JOIN wf.NativeDocumentReceipt r ON r.FinanceId=f.SOInvID WHERE r.RequestId=@r ORDER BY v.VATID,v.ListNo`,p));
 }else if(receipt.DocuType===116){
  parts.push(await snapshot(q,`SELECT RedemtionID,DocuNo,DocuDate,IssueName,CarLicense,SaveEmpID,SumGoodQty,IsCheckAll FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@n AND DocuType=116`,p));
  parts.push(await snapshot(q,`SELECT Listno,CouponID,CouponNo,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,GoodQty,IsCheck
   FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@n ORDER BY Listno`,p));
 }else{
  parts.push(await snapshot(q,`SELECT SOInvID,DocuNo,DocuDate,InvDate,ShipDate,DueDate,CreditEndDate,CustID,ARID,SumGoodAmnt,BillDiscAmnt,BillAftrDiscAmnt,VATAmnt,NetAmnt,StockEffc,CouponFlag
   FROM dbo.SOInvHD WITH(UPDLOCK,HOLDLOCK) WHERE SOInvID=@n AND Docutype=107`,p));
  parts.push(await snapshot(q,`SELECT ListNo,GoodID,GoodQty2,GoodStockQty,GoodPrice2,GoodAmnt,TotaExcludeAmnt,RefID,RefListNo FROM dbo.SOInvDT WITH(UPDLOCK,HOLDLOCK) WHERE SOInvID=@n ORDER BY ListNo`,p));
  parts.push(await snapshot(q,`SELECT StockDetailID,ListNo,GoodID,GoodQty2,GoodStockQty,DocuType,StockFlag,DocuID FROM dbo.ICStockDetail WITH(UPDLOCK,HOLDLOCK) WHERE DocuID=@n AND DocuType=107 ORDER BY ListNo,StockDetailID`,p));
 }
 if(parts.some(s=>s===''))fail('ND_RECEIPT_DIVERGED');
 return hash(parts);
}
async function assertInvoiceCutProof(q,plan,proof=nativeProof,{bridge=false}={}){
 // A non-null receipt hash is not proof that a WinSpeed user has not edited
 // the transport since then. Verify the whole physical cut, including other
 // lines in a mixed-order slip, under the invoice transaction's locks.
 for(const nativeId of [...new Set(plan.lines.map(l=>id(l.redemptionId)))].sort((a,b)=>a-b)){
  if(bridge&&await require('./coupon-bridge-proof').currentProof(q,nativeId))continue;
  const rows=(await q('SELECT * FROM wf.NativeDocumentReceipt WITH(UPDLOCK,HOLDLOCK) WHERE DocuType=116 AND NativeId=@n',
   {n:input(sql.Int,nativeId)})).recordset||[];
  if(rows.length!==1||!rows[0].NativeAfterHash)fail('ND_CUT_PROOF_REQUIRED');
  if(await proof(q,rows[0])!==rows[0].NativeAfterHash)fail('ND_CUT_DIVERGED');
 }
}
async function nativeDocument(args,options={}){
 const {operation='preview',type,sourceId,user}=args,env=options.env||process.env;
 if(!target.enabled(env)||env[FLAGS[type]]!=='true')fail('ND_WRITER_DISABLED',503);
 if(!TYPES.has(type)||!['preview','request','approve','reject','cancel','apply'].includes(operation))fail('ND_OPERATION_INVALID',400);
 id(sourceId);
 if(operation!=='preview'&&!uuid(args.requestId))fail('ND_REQUEST_INVALID',400);
 return (options.transaction||wfTransaction)(async tx=>{
  const q=queryFor(tx),actualTarget=await target.assertTarget(q,env),ids=businessIds(user);
  const who=await liveUser(q,ids.effective,ids.actor,Number(user.sub??user.id),Number(user.actorSub??user.actorId??user.sub??user.id));
  if(operation!=='cancel'){
   const required=['approve','reject'].includes(operation)?(type===104?'credit.approve-native':'coupon.manual116')
    :(type===116&&operation==='apply'?'coupon.manual116':PERMISSIONS[type]);
   await requirePermission(q,who,required,type===116&&!['apply','approve','reject'].includes(operation)?'coupon.manual116':null);
  }
  const lock=(await q(`DECLARE @r int;EXEC @r=sp_getapplock @Resource='WF_NATIVE_DOCUMENTS_V3',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;SELECT @r AS Result`)).recordset?.[0]?.Result;
  if(!Number.isInteger(lock)||lock<0)fail('ND_BUSY');
  const p={request:input(sql.VarChar(36),args.requestId||null)},request=operation==='preview'?null:
   (await q('SELECT * FROM wf.NativeDocumentRequest WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@request',p)).recordset?.[0];
  if(request&&(request.DocuType!==type||Number(request.SourceId)!==Number(sourceId)||request.PolicyVersion!==target.POLICY))fail('ND_REQUEST_CONFLICT');
  if(request&&env.NATIVE_COUPON_BRIDGE_ENABLED==='true'&&['apply','cancel','approve','reject'].includes(operation)
   &&(await q("SELECT TOP 1 PermitId FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@request AND State<>'CANCELLED' AND ReleasedAtUtc IS NULL",p)).recordset?.length)
   fail('ND_REQUEST_IN_WINSPEED');
  const isOwner=request&&Number(request.UserId)===who.effective&&Number(request.ActorUserId)===who.actor
   &&Number(request.PrimaryUserId)===who.primaryEffective&&Number(request.PrimaryActorId)===who.primaryActor;
  if(operation==='apply'&&request?.Status==='CONSUMED'){
   await requirePermission(q,who,type===116?'coupon.manual116':PERMISSIONS[type]);
   const receipt=(await q('SELECT * FROM wf.NativeDocumentReceipt WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@request',p)).recordset?.[0];
   if(type===116&&env.NATIVE_COUPON_BRIDGE_ENABLED==='true'){
    if(!receipt)fail('ND_COMPLETED_IN_WINSPEED');
    const current=await require('./coupon-bridge-proof').currentProof(q,receipt.NativeId);
    if(current&&current.Revision!==1)fail('ND_DOCUMENT_AMENDED');
   }
   if(!receipt||receipt.UserId!==who.effective||receipt.ActorUserId!==who.actor||receipt.PrimaryUserId!==who.primaryEffective||receipt.PrimaryActorId!==who.primaryActor
    ||!receipt.NativeAfterHash||await nativeProof(q,receipt)!==receipt.NativeAfterHash)fail('ND_REQUEST_CONFLICT');
   await source.assertReplayScope(q,receipt,request,who.user);
   const lines=(await q('SELECT * FROM wf.NativeDocumentReceiptLine WHERE RequestId=@request ORDER BY NativeLineNo',p)).recordset;
   return publicReceipt(receipt,lines,true);
  }
  if((['approve','reject','cancel'].includes(operation)||(operation==='apply'&&[104,116].includes(type)))&&!request)fail('ND_REQUEST_NOT_FOUND',404);
  if(request&&['CANCELLED','REJECTED','CONSUMED'].includes(request.Status))fail('ND_REQUEST_CLOSED');
  if(operation==='cancel'){
   if(!isOwner)fail('ND_REQUEST_OWNER_REQUIRED',403);
  }else if(['approve','reject'].includes(operation)){
   if(![104,116].includes(type))fail('ND_OPERATION_INVALID',400);
   if(typeof args.reason!=='string'||args.reason.trim().length<5||args.reason.length>500)fail('ND_REASON_REQUIRED',400);
   await approveAllowed(q,who,request);
  }else await requirePermission(q,who,type===116&&operation==='apply'?'coupon.manual116':PERMISSIONS[type],type===116?'coupon.manual116':null);
  if(['cancel','reject'].includes(operation)){
   if(typeof args.reason!=='string'||args.reason.trim().length<5||args.reason.length>500)fail('ND_REASON_REQUIRED',400);
   const status=operation==='cancel'?'CANCELLED':'REJECTED';
   await q(`UPDATE wf.NativeDocumentRequest SET Status=@s,Revision=Revision+1 WHERE RequestId=@request AND Status IN('PENDING','APPROVED')`,{...p,s:input(sql.VarChar(12),status)});
   await audit(q,who,args.requestId,status,{status:request.Status},{status},args.reason);return {...publicRequest(request),status,revision:request.Revision+1};
  }
  if(request&&operation==='request'){
   if(!isOwner||request.InputHash!==hash({lines:args.lines||[],data:args.data||{}}))fail('ND_REQUEST_CONFLICT');
   return publicRequest(request);
  }
  const saved=request?JSON.parse(request.InputJson):null;
  const lines=saved?saved.lines:(args.lines||[]),data=saved?saved.data:(args.data||{});
  const requester=request?await liveUser(q,request.UserId,request.ActorUserId,request.PrimaryUserId,request.PrimaryActorId):who;
  await requirePermission(q,requester,PERMISSIONS[type],type===116?'coupon.manual116':null);
  const current=await readSource(q,tx,type,sourceId,requester.user,lines,data);
  // The recorder/approver must independently see every original source.
  if(who.effective!==requester.effective||who.actor!==requester.actor)await readSource(q,tx,type,sourceId,who.user,lines,data);
  if(type===119)await assertAiApprover(q,who,current.row);
  if(type===107){
   const parent=(await q('SELECT * FROM wf.NativeDocumentReceipt WITH(UPDLOCK,HOLDLOCK) WHERE DocuType=104 AND NativeId=@n',{n:input(sql.Int,Number(sourceId))})).recordset?.[0];
   if(!parent||!parent.NativeAfterHash||await nativeProof(q,parent)!==parent.NativeAfterHash)fail('ND_DELIVERY_DIVERGED');
   await assertInvoiceCutProof(q,current.plan,nativeProof,{bridge:env.NATIVE_COUPON_BRIDGE_ENABLED==='true'});
  }
  if([104,107].includes(type)&&Number(current.row.tax)>0&&!await readApprovedSalesVat(q,{dbName:actualTarget.database,soid:Number(sourceId),docuType:type===104?103:104,setting:env.NATIVE_SALES_VAT_APPROVAL}))fail('ND_VAT_APPROVAL_REQUIRED');
  const xml=(await q('SELECT CONVERT(nvarchar(max),CONVERT(xml,@plan)) AS CanonicalPlan',{plan:input(sql.Xml,planXml(current.plan,Number(sourceId)))})).recordset?.[0]?.CanonicalPlan;
  if(typeof xml!=='string')fail('ND_PLAN_UNAVAILABLE',503);
  const inputHash=hash({lines,data}),previewHash=hash([target.POLICY,type,Number(sourceId),current.sourceHash,xml,inputHash,requester.effective,requester.actor]);
  if(operation==='preview')return {docuType:type,sourceId:Number(sourceId),fingerprint:previewHash,plan:current.plan,policyVersion:target.POLICY,simulation:actualTarget.simulation};
  if(request&&(request.SourceHash!==current.sourceHash||request.PlanXml!==xml||request.InputHash!==inputHash))
   throw Object.assign(Error('ND_SOURCE_CHANGED'),{code:'ND_SOURCE_CHANGED',status:409,
    changedFields:{source:request.SourceHash!==current.sourceHash,plan:request.PlanXml!==xml,input:request.InputHash!==inputHash}});
  if(operation==='request'||(!request&&operation==='apply'&&[119,107].includes(type))){
   if(!fingerprint(args.fingerprint)||args.fingerprint!==previewHash)fail('ND_PREVIEW_STALE');
   if(typeof args.reason!=='string'||args.reason.trim().length<5||args.reason.length>500)fail('ND_REASON_REQUIRED',400);
   const auto=[119,107].includes(type),key=type===116?`116:${current.plan.slipNo}`:type===107?`107:${hash(current.plan.lines.map(l=>[l.redemptionId,l.redemptionLineNo]))}`:`${type}:${sourceId}`;
   await q(`INSERT wf.NativeDocumentRequest(RequestId,PolicyVersion,DocuType,OperationKey,SourceId,SourceKind,SourceHash,InputHash,PlanXml,InputJson,
    UserId,ActorUserId,PrimaryUserId,PrimaryActorId,Status,Reason,ExpiresAtUtc,ApprovedById,ApproverActorId,ApprovedAtUtc,ApproverPrimaryId,ApproverActorPrimaryId)
    VALUES(@request,@policy,@type,@key,@source,@kind,@sourceHash,@inputHash,@plan,@json,@u,@a,@pu,@pa,@status,@reason,DATEADD(minute,30,GETUTCDATE()),
    @approver,@approverActor,CASE WHEN @approver IS NULL THEN NULL ELSE GETUTCDATE() END,@approverPrimary,@approverActorPrimary)`,{
    ...p,policy:input(sql.VarChar(40),target.POLICY),type:input(sql.Int,type),key:input(sql.VarChar(128),key),source:input(sql.Int,Number(sourceId)),kind:input(sql.VarChar(20),type===116?'CUSTOMER':'SO'),
    sourceHash:input(sql.VarChar(64),current.sourceHash),inputHash:input(sql.VarChar(64),inputHash),plan:input(sql.Xml,xml),json:input(sql.NVarChar(sql.MAX),JSON.stringify({lines,data})),
    u:input(sql.Int,who.effective),a:input(sql.Int,who.actor),pu:input(sql.Int,who.primaryEffective),pa:input(sql.Int,who.primaryActor),
    status:input(sql.VarChar(12),auto?'APPROVED':'PENDING'),reason:input(sql.NVarChar(500),args.reason),
    approver:input(sql.Int,auto?who.effective:null),approverActor:input(sql.Int,auto?who.actor:null),
    approverPrimary:input(sql.Int,auto?who.primaryEffective:null),approverActorPrimary:input(sql.Int,auto?who.primaryActor:null)});
   await audit(q,who,args.requestId,'REQUEST',null,{docuType:type,sourceId,sourceHash:current.sourceHash,inputHash},args.reason);
   if(operation==='request')return publicRequest((await q('SELECT * FROM wf.NativeDocumentRequest WHERE RequestId=@request',p)).recordset[0]);
  }else if(operation==='approve'){
   if(request.Status!=='PENDING')fail('ND_REQUEST_ALREADY_DECIDED');
   const approved=(await q(`UPDATE wf.NativeDocumentRequest SET Status='APPROVED',Revision=Revision+1,ApprovedById=@u,ApproverActorId=@a,
    ApproverPrimaryId=@pu,ApproverActorPrimaryId=@pa,ApprovedAtUtc=GETUTCDATE(),ExpiresAtUtc=DATEADD(minute,30,GETUTCDATE())
    WHERE RequestId=@request AND Status='PENDING' AND ExpiresAtUtc>GETUTCDATE();SELECT @@ROWCOUNT AS Updated`,
    {...p,u:input(sql.Int,who.effective),a:input(sql.Int,who.actor),pu:input(sql.Int,who.primaryEffective),pa:input(sql.Int,who.primaryActor)})).recordset?.[0]?.Updated;
   if(approved!==1)fail('ND_REQUEST_EXPIRED');
   await audit(q,who,args.requestId,'APPROVE',{status:'PENDING'},{status:'APPROVED'},args.reason);
   return publicRequest((await q('SELECT * FROM wf.NativeDocumentRequest WHERE RequestId=@request',p)).recordset[0]);
  }else if(operation==='apply'){
   if(type!==116&&!isOwner)fail('ND_REQUEST_OWNER_REQUIRED',403);
   if(request.Status!=='APPROVED')fail('ND_APPROVAL_REQUIRED');
  }else fail('ND_OPERATION_INVALID',400);
  await (options.verifyMetadata||verifyOperationalMetadata)(q,{ServerName:actualTarget.server,DbName:actualTarget.database},{env});
  const receipt=(await q(`EXEC wf.usp_ApplyNativeDocument @RequestId=@request,@UserId=@u,@ActorId=@a,@PrimaryUserId=@pu,@PrimaryActorId=@pa`,
   {...p,u:input(sql.Int,who.effective),a:input(sql.Int,who.actor),pu:input(sql.Int,who.primaryEffective),pa:input(sql.Int,who.primaryActor)})).recordset?.[0];
  if(!receipt||receipt.DocuType!==type||receipt.SourceBeforeHash!==current.sourceHash)fail('ND_WRITER_INCOMPLETE',503);
  await require('./native-document-verify').verifyNewResult(q,receipt,current.plan);
  const after=await nativeProof(q,receipt);
  const count=(await q(`UPDATE wf.NativeDocumentReceipt SET NativeAfterHash=@h WHERE RequestId=@request AND NativeAfterHash IS NULL;SELECT @@ROWCOUNT AS Updated`,
   {...p,h:input(sql.VarChar(64),after)})).recordset?.[0]?.Updated;
  if(count!==1)fail('ND_RECEIPT_DIVERGED');
  const resultLines=(await q('SELECT * FROM wf.NativeDocumentReceiptLine WHERE RequestId=@request ORDER BY NativeLineNo',p)).recordset;
  if(resultLines.length!==current.plan.lines.length)fail('ND_WRITER_INCOMPLETE');
  if(type===116){
   for(const line of current.plan.lines)if(line.expired)await require('./rule-incidents').recordIncidentTx(tx,{
    key:`NATIVE116_EXPIRY:${args.requestId}:${line.couponId}`,type:'TICKET_USED_EXPIRED',soid:line.deliveryId,docuNo:line.couponNo,
    detail:`ตั๋วหมดอายุ ${line.expiryDate}; ใช้ ${line.quantity} ตันตามนโยบายเตือนและใช้ได้; request=${args.requestId}`});
  }
  await audit(q,who,args.requestId,'APPLY',{sourceHash:current.sourceHash},{nativeId:receipt.NativeId,docuType:type,nativeHash:after},args.reason||request?.Reason||'Native document');
  return publicReceipt(receipt,resultLines,false);
 },{isolationLevel:sql.ISOLATION_LEVEL.SERIALIZABLE});
}
function httpError(e){
 const messages=[e,...[e.originalError,e.originalError?.info,...(e.precedingErrors||[]),...(e.originalError?.precedingErrors||[])]
  .filter(item=>Number(item?.number)===50000)];
 const code=e.code&&(/^(ND_|BRIDGE_|COUPON_BRIDGE_|NATIVE_116_)[A-Z0-9_]+$/.test(e.code)||['LOCK_TIMEOUT','DEADLOCK_RETRY'].includes(e.code))
  ?e.code:messages.map(item=>/\b((?:ND_|BRIDGE_|NATIVE_116_)[A-Z0-9_]+)\b/.exec(String(item?.message||''))?.[1]).find(Boolean);
 return {status:e.status||(code?409:503),code:code||'ND_OPERATION_FAILED'};
}
module.exports={nativeDocument,queryFor,liveUser,permission,requirePermission,approveAllowed,planXml,nativeProof,assertInvoiceCutProof,httpError};
