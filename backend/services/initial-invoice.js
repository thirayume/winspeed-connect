'use strict';
const {isInitialNativeUatTarget}=require('./initial-native-uat-target');
// Restricted UAT simulation: one full zero-tax coupon, ACCOUNTING only.
const {createHash}=require('crypto');
const {sql,wfTransaction}=require('../db');
const {getVisibleScope,inScope}=require('./visible-scope');
const {ACCESS_AS_ACTOR_ROLES,roleRank}=require('./role-capabilities');
const {verifyReceipt,verifyDeliveryAccount,deliverySnapshot}=require('./initial-delivery');
const {verifyCompleted,redemptionSnapshot,redemptionHash}=require('./initial-manual-redemption');
const {verifyInvoiceMetadata}=require('./initial-invoice-metadata');
const {invoiceFingerprint}=require('./initial-invoice-state');
const {invoiceDeliveryTransition,invoiceCutTransition}=require('./invoice-transition');
const {POLICY}=require('./initial-invoice-continuation');
const input=(type,value)=>({type,value});
const hash=v=>createHash('sha256').update(JSON.stringify(v),'utf8').digest('hex');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const sourceInputs=source=>({source:input(sql.Int,source)});
function queryFor(tx){return async(text,inputs={})=>{
 const r=tx.request();for(const [key,{type,value}] of Object.entries(inputs))r.input(key,type,value);
 return r.query('SET ARITHABORT ON; SET ANSI_WARNINGS ON; '+text);
};}
async function identity(q,user){
 const effective=Number(user?.sub),actor=Number(user?.actorSub||user?.sub);
 if(![effective,actor].every(v=>Number.isSafeInteger(v)&&v>0))fail('IP_ACTOR_INVALID',401);
 const rows=(await q('SELECT Id,Role,IsActive,MustChangePassword FROM wf.AppUser WITH(UPDLOCK,HOLDLOCK) WHERE Id IN(@user,@actor)',{
  user:input(sql.Int,effective),actor:input(sql.Int,actor)})).recordset||[];
 const me=rows.find(r=>Number(r.Id)===effective),real=rows.find(r=>Number(r.Id)===actor);
 if(![me,real].every(r=>r&&(r.IsActive===true||r.IsActive===1)&&!r.MustChangePassword))fail('IP_ACTOR_UNAVAILABLE',403);
 if(me.Role!==user.role||real.Role!==(user.actorRole||user.role))fail('IP_ROLE_CHANGED',403);
 if(me.Role!=='ACCOUNTING')fail('IP_ACCOUNT_REQUIRED',403);
 if(actor!==effective&&(!ACCESS_AS_ACTOR_ROLES.includes(real.Role)||roleRank(real.Role)<roleRank(me.Role)))fail('IP_ACCESS_AS_FORBIDDEN',403);
 return {effective,actor};
}
async function context(q,source,user){
 const parent=(await q(`SELECT r.*,h.DocuNo AS SourceNo,h.EmpID,e.SalesUserId FROM wf.NativeDeliveryReceipt r WITH(UPDLOCK,HOLDLOCK)
  JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=r.SourceSOID AND h.DocuType=103 AND h.BrchID=1
  LEFT JOIN wf.SalesOrderExt e ON e.SOID=CONVERT(varchar(50),h.SOID) WHERE r.SourceSOID=@source`,sourceInputs(source))).recordset?.[0];
 if(!parent||!inScope(await getVisibleScope(user,q),{userId:parent.SalesUserId,empId:parent.EmpID}))fail('IP_SOURCE_NOT_FOUND',404);
 try{await verifyDeliveryAccount(q,parent.SourceNo,parent);await verifyReceipt(q,parent);}catch{fail('IP_DELIVERY_DIVERGED');}
 const manual=(await q('SELECT * FROM wf.NativeManualRedemptionReceipt WITH(UPDLOCK,HOLDLOCK) WHERE SourceSOID=@source',sourceInputs(source))).recordset?.[0];
 if(!manual||Number(manual.DeliverySOID)!==Number(parent.DeliverySOID)||Number(manual.CouponID)!==Number(parent.CouponID))fail('IP_MANUAL_116_REQUIRED');
 try{await verifyCompleted(q,parent,manual);}catch{fail('IP_REDEMPTION_DIVERGED');}
 return {parent,manual};
}
async function xml(q,statement,inputs={}){
 const value=(await q(`SELECT COALESCE(CONVERT(nvarchar(max),(${statement} FOR XML RAW,BINARY BASE64,ELEMENTS XSINIL)),N'') AS Snapshot`,inputs)).recordset?.[0]?.Snapshot;
 if(typeof value!=='string')fail('IP_SNAPSHOT_UNAVAILABLE',503);return value;
}
async function costSnapshot(q,good,date,exclude=0){
 const p={good:input(sql.Int,good),date:input(sql.VarChar(10),date),exclude:input(sql.Int,exclude)};
 const parts=[];for(const [table,key] of [['ICStockDetail','StockDetailID'],['ICCostDetail','CostDetailID']]){
  parts.push(await xml(q,`SELECT * FROM dbo.${table} WITH(UPDLOCK,HOLDLOCK) WHERE GoodID=@good AND DocuDate>=CONVERT(datetime,@date,120)${table==='ICStockDetail'?' AND StockDetailID<>@exclude':''} ORDER BY ${key}`,p));
 }return parts;
}
function receiptView(r,replayed){return {soid:r.SourceSOID,invoiceId:r.InvoiceID,invoiceNo:r.InvoiceNo,
 invoiceDate:new Date(r.InvoiceDate).toISOString().slice(0,10),redemptionId:r.RedemptionID,
 completed:true,replayed,policyVersion:r.PolicyVersion,evidenceMode:'UAT_SIMULATION',physicalShipmentVerified:false};}
async function verifyInvoiceReceipt(q,parent,manual,r){
 if(r.PolicyVersion!==POLICY||Number(r.DeliverySOID)!==Number(parent.DeliverySOID)||Number(r.RedemptionID)!==Number(manual.RedemptionID)
  ||r.DeliveryBeforeHash!==manual.DeliveryAfterHash||r.RedemptionBeforeHash!==manual.RedemptionAfterHash
  ||!r.DeliveryAfterHash||r.DeliveryAfterHash!==parent.DeliveryAfterHash||!r.RedemptionAfterHash
  ||await redemptionHash(q,r.RedemptionID)!==r.RedemptionAfterHash||!r.InvoiceAfterHash
  ||await invoiceFingerprint(q,r.InvoiceID)!==r.InvoiceAfterHash)fail('IP_RECEIPT_DIVERGED');
}
async function initialInvoice({operation='preview',soid,user,requestId,fingerprint,invoiceDate},options={}){
 if(!(options.enabled??(process.env.NATIVE_INVOICE_107_ENABLED==='true')))fail('IP_NOT_ENABLED',503);
 if(!['preview','apply'].includes(operation))fail('IP_OPERATION_INVALID',400);
 if(!/^\d+$/.test(String(soid))||!Number.isSafeInteger(Number(soid))||Number(soid)<=0||Number(soid)>2147483647)fail('IP_SOURCE_INVALID',400);
 if(operation==='apply'&&(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(requestId||''))||!/^[a-f0-9]{64}$/.test(String(fingerprint||''))
  ||!/^\d{4}-\d{2}-\d{2}$/.test(String(invoiceDate||''))))fail('IP_REQUEST_INVALID',400);
 soid=Number(soid);
 return (options.transaction||wfTransaction)(async tx=>{
  const q=queryFor(tx);
  const target=(await q("SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) AS ServerName,DB_NAME() AS DbName,DB_ID() AS DbId")).recordset?.[0];
  if(!isInitialNativeUatTarget(target))fail('IP_TARGET_NOT_SUPPORTED',403);
  const who=await identity(q,user);
  const lock=(await q("DECLARE @r int; EXEC @r=sp_getapplock @Resource='WF_INITIAL_DELIVERY_104',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000; SELECT @r AS LockResult")).recordset?.[0]?.LockResult;
  if(!Number.isInteger(lock)||lock<0)fail('IP_BUSY');
  const {parent,manual}=await context(q,soid,user);
  const old=(await q('SELECT * FROM wf.NativeInitialInvoiceReceipt WITH(UPDLOCK,HOLDLOCK) WHERE SourceSOID=@source',sourceInputs(soid))).recordset?.[0];
  if(old){
   if(operation!=='preview'&&(old.RequestId!==requestId||old.Fingerprint!==fingerprint||Number(old.AppliedById)!==who.effective||Number(old.ApplierActorId)!==who.actor
    ||receiptView(old,true).invoiceDate!==invoiceDate))fail('IP_REQUEST_CONFLICT');
   await verifyInvoiceReceipt(q,parent,manual,old);return receiptView(old,true);
  }
  await (options.verifyMetadata||verifyInvoiceMetadata)(q);
  const p={...sourceInputs(soid),user:input(sql.Int,who.effective),actor:input(sql.Int,who.actor),date:input(sql.VarChar(10),operation==='apply'?invoiceDate:null)};
  const details=(await q('EXEC wf.usp_PostInitialCouponInvoice @SOID=@source,@Preview=1,@RequestId=NULL,@Fingerprint=NULL,@UserId=@user,@ActorId=@actor,@InvoiceDate=@date',p)).recordset?.[0];
  if(!details||!['J','N'].includes(details.InvoiceSeries)||!/^\d{4}-\d{2}-\d{2}$/.test(details.InvoiceDate||'')
   ||![details.Amount,details.Qty].every(v=>typeof v==='string'&&/^\d+\.\d{4}$/.test(v)&&Number(v)>0)
   ||!Number.isSafeInteger(details.GoodID)||!Number.isSafeInteger(details.InveID))fail('IP_PREVIEW_UNAVAILABLE',503);
  const info=(await q(`SELECT CONVERT(varchar(10),DATEADD(day,h.CreditDays,CONVERT(datetime,@date,120)),120) AS DueDate,h.CreditDays
   FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) WHERE h.SOID=@delivery AND h.DocuType=104`,{date:input(sql.VarChar(10),details.InvoiceDate),delivery:input(sql.Int,parent.DeliverySOID)})).recordset?.[0];
  if(!info||!/^\d{4}-\d{2}-\d{2}$/.test(info.DueDate||''))fail('IP_PREVIEW_UNAVAILABLE',503);
  const costs=await costSnapshot(q,details.GoodID,details.InvoiceDate);
  const parts=[POLICY,who.effective,who.actor,parent.DeliveryAfterHash,manual.RedemptionAfterHash,details,info,costs];
  for(const statement of [
   "SELECT * FROM dbo.EMRunBrch WITH(UPDLOCK,HOLDLOCK) WHERE RunCode='creditsale_docuno' AND BrchID=1 ORDER BY RunCode,BrchID",
   "SELECT * FROM dbo.EMRunChar WITH(UPDLOCK,HOLDLOCK) WHERE RunCode='creditsale_docuno' AND BrchID=1 ORDER BY ListNo",
   "SELECT * FROM dbo.EMPeriod WITH(UPDLOCK,HOLDLOCK) WHERE PeriodType='N' AND CONVERT(datetime,@date,120) BETWEEN BeginDate AND EndDate ORDER BY PeriodID",
   'SELECT * FROM dbo.ICOption WITH(UPDLOCK,HOLDLOCK) ORDER BY BrchID',
   'SELECT * FROM dbo.EMOptionExt WITH(UPDLOCK,HOLDLOCK) WHERE SystemID=5 ORDER BY BrchID',
   'SELECT BrchID,HeadOffice FROM dbo.EMBrch WITH(UPDLOCK,HOLDLOCK) ORDER BY BrchID',
  ])parts.push(await xml(q,statement,{date:input(sql.VarChar(10),details.InvoiceDate)}));
  const current=hash(parts);
  if(operation==='preview')return {soid,completed:false,fingerprint:current,invoiceDate:details.InvoiceDate,dueDate:info.DueDate,
   series:details.InvoiceSeries,amount:details.Amount,qty:details.Qty,deliveryNo:parent.DeliveryNo,couponNo:parent.CouponNo,
   redemptionNo:manual.RedemptionNo,evidenceMode:'UAT_SIMULATION',physicalShipmentVerified:false};
  if(fingerprint!==current)fail('IP_PREVIEW_STALE');
  const beforeDelivery=await deliverySnapshot(q,parent.DeliverySOID),beforeCut=await redemptionSnapshot(q,manual.RedemptionID);
  const result=(await q('EXEC wf.usp_PostInitialCouponInvoice @SOID=@source,@Preview=0,@RequestId=@request,@Fingerprint=@fingerprint,@UserId=@user,@ActorId=@actor,@InvoiceDate=@date',{
   ...p,date:input(sql.VarChar(10),details.InvoiceDate),request:input(sql.VarChar(36),requestId),fingerprint:input(sql.VarChar(64),fingerprint)})).recordset?.[0];
  if(!result||Number(result.DeliverySOID)!==Number(parent.DeliverySOID)||Number(result.RedemptionID)!==Number(manual.RedemptionID)
   ||result.DeliveryBeforeHash!==parent.DeliveryAfterHash||result.RedemptionBeforeHash!==manual.RedemptionAfterHash)fail('IP_RECEIPT_UNAVAILABLE',503);
  const afterDelivery=await deliverySnapshot(q,parent.DeliverySOID),afterCut=await redemptionSnapshot(q,manual.RedemptionID);
  if(!invoiceDeliveryTransition(beforeDelivery,afterDelivery)||!invoiceCutTransition(beforeCut,afterCut,result.InvoiceID)
   ||JSON.stringify(await costSnapshot(q,details.GoodID,details.InvoiceDate,result.StockDetailID))!==JSON.stringify(costs))fail('IP_UNEXPECTED_NATIVE_CHANGE');
  const after=hash(afterDelivery),cut=hash(afterCut),invoice=await invoiceFingerprint(q,result.InvoiceID);
  const updated=(await q(`UPDATE wf.NativeDeliveryReceipt SET DeliveryAfterHash=@after WHERE SourceSOID=@source AND DeliveryAfterHash=@before;
   SELECT @@ROWCOUNT AS Updated;
   UPDATE wf.NativeInitialInvoiceReceipt SET DeliveryAfterHash=@after,RedemptionAfterHash=@cut,InvoiceAfterHash=@invoice WHERE SourceSOID=@source AND RequestId=@request;
   IF @@ROWCOUNT<>1 RAISERROR('IP_RECEIPT_DIVERGED',16,1)`,{
   ...sourceInputs(soid),before:input(sql.VarChar(64),parent.DeliveryAfterHash),after:input(sql.VarChar(64),after),cut:input(sql.VarChar(64),cut),invoice:input(sql.VarChar(64),invoice),request:input(sql.VarChar(36),requestId)})).recordset?.[0]?.Updated;
  if(updated!==1)fail('IP_RECEIPT_DIVERGED');
  return receiptView(result,false);
 });
}
function invoiceHttpError(e){
 if(e.status&&/^IP_[A-Z0-9_]+$/.test(e.code||''))return {status:e.status,code:e.code};
 const code=/\b(IP_(?:TARGET_NOT_SUPPORTED|ACCOUNT_REQUIRED|SOURCE_UNAVAILABLE|DATE_OVERRIDE_UNVERIFIED|COST_SCOPE_UNSUPPORTED|PERIOD_UNSUPPORTED|COUNTER_UNSUPPORTED|NUMBER_EXHAUSTED|ID_CONFLICT|ID_EXHAUSTED|METADATA_UNSUPPORTED|SNAPSHOT_UNAVAILABLE))\b/.exec(String(e.message||''))?.[1];
 return {status:code?409:503,code:code||'IP_FAILED'};
}
module.exports={initialInvoice,invoiceHttpError,costSnapshot,verifyInvoiceReceipt,POLICY};
