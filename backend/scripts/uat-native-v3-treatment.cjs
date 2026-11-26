'use strict';
// Additional authenticated endpoint acceptance. The 103 fixture explicitly
// simulates WinSpeed input; normal Sale-App bill creation is tested separately.
const crypto=require('crypto');
module.exports=async function(ctx){
 const {call,query,check,save,state,fixtures,sql,CUST_ID,RUN,deliveryDate}=ctx;
 const db=require('../db'),{queryFor}=require('../services/native-document-service');
 const reviewer=JSON.parse(require('fs').readFileSync('/review-state/bootstrap.json','utf8'));
 const login=await call('POST','/auth/login',{username:reviewer.username,password:reviewer.password});
 check(login.status===200&&login.data.user?.role==='ADMIN','TREATMENT_ADMIN_ENDPOINT_REVIEWER');
 const endpointUser=login.data.accessToken;
 const {nativeFingerprint}=require('../services/initial-booking-ai');
 const {QA}=require('../services/native-document-target');
 const treatment=require('./native-v3-qa-profile.cjs').assertQaProfile().treatment;
 if(!['ZERO','DISCOUNT'].includes(treatment)||!state.rebate?.approval)throw Error('QA_TREATMENT_REBATE_REQUIRED');
 // Keep separate receipts when the isolated QA runtime rehearses both modes.
 // A profile switch must never reinterpret or replace an earlier mode's proof.
 state.treatmentCases||={};
 if(state.treatmentCase){
  const old=state.treatmentCase;
  if(!['ZERO','DISCOUNT'].includes(old.treatment))throw Error('QA_TREATMENT_CHANGED');
  state.treatmentCases[old.treatment]||=old;
 }
 const c=state.treatmentCases[treatment]||(state.treatmentCases[treatment]={book:'K',treatment});
 if(c.treatment!==treatment)throw Error('QA_TREATMENT_CHANGED');save();
 if(treatment==='ZERO'){
  if(c.converted&&!state.cases.RZ?.invoice)await require('./uat-native-v3-rebate-use.cjs')({...ctx,caseKey:'RZ',rebateState:{...state.rebate,approval:c.converted}});
  const target=state.cases.R.soid;
  const before=(await query('SELECT COUNT(*) N FROM wf.RebateTicketRedemptionReceipt WHERE BookingSOID=@s',{s:{type:sql.Int,value:target}})).recordset[0].N;
  const command={bookingId:target,lineNo:1,requestedTonnage:0.05,requestId:crypto.randomUUID(),expectedDatabase:QA,treatment};
  const wrong=await call('POST','/rebate-pool/tickets/redeem',{...command,treatment:'DISCOUNT'},endpointUser);
  check(wrong.status===409&&wrong.data.code==='TICKET_TREATMENT_MISMATCH','ZERO_ENDPOINT_WRONG_TREATMENT_REJECTED');
  const attempt=await call('POST','/rebate-pool/tickets/redeem',command,endpointUser);
  check(attempt.status===503&&attempt.data.code==='TICKET_FINANCIAL_PROOF_UNAVAILABLE','ZERO_NORMAL_MIXED_BILL_CANNOT_USE_POSTED_SINGLE_LINE_ENDPOINT');
  const after=(await query('SELECT COUNT(*) N FROM wf.RebateTicketRedemptionReceipt WHERE BookingSOID=@s',{s:{type:sql.Int,value:target}})).recordset[0].N;
  check(before===1&&after===before,'ZERO_NO_SECOND_DEBIT_FROM_OTHER_ENDPOINT');return;
 }
 if(!c.soid){
  const f=await db.wfTransaction(async tx=>{
   const q=queryFor(tx);
   if((await q('SELECT DB_NAME() Db')).recordset[0].Db!==QA)throw Error('QA_ONLY');
   const row=(await q('EXEC wf.usp_QaNativeTicketTreatment @Treatment=@t,@SalesUserId=@u',
    {t:{type:sql.VarChar(8),value:treatment},u:{type:sql.Int,value:fixtures.users.sales.id}})).recordset[0];
   if(row.CustId!==CUST_ID||row.GoodID!==state.rebate.goodId)throw Error('QA_FIXTURE_CUSTOMER_GOOD_MISMATCH');
   const hash=await nativeFingerprint(q,row.SOID);
   await q(`INSERT wf.NativeBookingOrigin(SOID,SourceDraftId,SalesUserId,ConfirmedById,ConfirmedActorId,Fingerprint,PolicyVersion)
    VALUES(@s,@d,@u,@u,@u,@h,'NATIVE-DOCUMENTS-v3')`,{s:{type:sql.Int,value:row.SOID},d:{type:sql.Int,value:row.DraftId},
     u:{type:sql.Int,value:fixtures.users.sales.id},h:{type:sql.VarChar(64),value:hash}});
   return row;
  });
  Object.assign(c,{soid:f.SOID,bookingNo:f.DocuNo,goodId:f.GoodID});save();
 }
 const operational=require('./uat-native-v3-phases.cjs')({...ctx,lineTon:0.05,totalTon:0.05});
 // This helper normally checks two-line deliveries. One-line fixture uses the same
 // service with separate explicit financial checks below.
 const request=(op,body,key)=>call('POST','/native-documents/104/'+c.soid+'/'+op,body,key);
 // The synthetic WinSpeed fixture records a listed counter employee as seller.
 // Use the actual QA ADMIN's explicitly allowed self-approval; ordinary counter
 // separation is already checked in both normal Full Loop books.
 if(!c.ai){
  const url='/native-documents/119/'+c.soid+'/';
  const p=await call('POST',url+'preview',{},endpointUser);check(p.status===200,'TREATMENT_ADMIN_AI_PREVIEW_'+treatment);
  const cmd={requestId:crypto.randomUUID(),fingerprint:p.data.fingerprint,reason:RUN+' QA administrator reviews WinSpeed-shaped booking'};
  const r=await call('POST',url+'apply',cmd,endpointUser);check(r.status===200,'TREATMENT_ADMIN_AI_APPLY_'+treatment);c.ai=r.data;save();
 }
 if(!c.delivery){
  const preview=await request('preview',{},'counter');check(preview.status===200,'TREATMENT_104_PREVIEW_'+treatment);
  const cmd={requestId:crypto.randomUUID(),fingerprint:preview.data.fingerprint,reason:RUN+' reviewed treatment financial source'};
  check((await request('request',cmd,'counter')).status===200,'TREATMENT_104_REQUEST_'+treatment);
  check((await request('approve',cmd,'account')).status===200,'TREATMENT_104_CREDIT_APPROVAL_'+treatment);
  const r=await request('apply',cmd,'counter');check(r.status===200,'TREATMENT_104_APPLY_'+treatment);
  c.delivery={...r.data,deliverySoid:r.data.nativeId,deliveryNo:r.data.nativeNo};save();
 }

 if(!c.converted){
  c.conversionCommand||={requestId:crypto.randomUUID(),expectedDatabase:QA,custId:CUST_ID,goodId:c.goodId,
   standingYear:new Date(deliveryDate).getUTCFullYear(),requestedTons:0.05,maturedOnly:false,note:RUN+' endpoint treatment rehearsal'};save();
  const pending=await call('POST','/rebate-pool/conversion-requests',c.conversionCommand,'sales');
  check(pending.status===200,'TREATMENT_SALES_RESERVES_NEW_TICKET_'+treatment);
  const approved=await call('POST','/rebate-pool/conversion-requests/'+pending.data.id+'/approve',
   {expectedDatabase:QA,reason:RUN+' reviewed endpoint ticket'},'manager');
  check(approved.status===200,'TREATMENT_MANAGER_APPROVES_TICKET_'+treatment);c.converted=approved.data;save();
 }
 c.command||={bookingId:c.soid,lineNo:1,requestedTonnage:0.05,requestId:crypto.randomUUID(),treatment,expectedDatabase:QA};save();
 const wrong=await call('POST','/rebate-pool/tickets/redeem',{...c.command,treatment:treatment==='ZERO'?'DISCOUNT':'ZERO'},endpointUser);
 check(wrong.status===409&&wrong.data.code==='TICKET_TREATMENT_MISMATCH','TREATMENT_WRONG_MODE_REJECTED_'+treatment);
 const pair=await Promise.all([call('POST','/rebate-pool/tickets/redeem',c.command,endpointUser),call('POST','/rebate-pool/tickets/redeem',c.command,endpointUser)]);
 for(let i=0;i<pair.length;i++)if(pair[i].status===409&&['DEADLOCK_RETRY','LOCK_TIMEOUT','TICKET_REDEMPTION_CONFLICT'].includes(pair[i].data.code))
  pair[i]=await call('POST','/rebate-pool/tickets/redeem',c.command,endpointUser);
 check(pair.every(r=>r.status===200),'TREATMENT_CONCURRENT_ENDPOINT_'+treatment);
 const receipts=(await query('SELECT Id,Treatment,QuantityTon FROM wf.RebateTicketRedemptionReceipt WHERE BookingSOID=@s AND BookingLineNo=1',
  {s:{type:sql.Int,value:c.soid}})).recordset;
 check(receipts.length===1&&receipts[0].Treatment===treatment&&Number(receipts[0].QuantityTon)===0.05,'TREATMENT_ONE_RECEIPT_'+treatment);
 // The simulated source belongs to the counter employee, so its own counter
 // requests the draw; do not widen the normal salesperson's coupon scope.
 const fixtureCall=async(method,url,body,key)=>{
  if(!url.startsWith('/native-documents/116/'))return call(method,url,body,key);
  if(key==='sales')return call(method,url,body,'counter');
  if(key==='manager'){
   const denied=await call(method,url,body,key);
   check(denied.status===404&&denied.data.code==='ND_COUPON_NOT_FOUND','TREATMENT_OUTSIDE_BRANCH_MANAGER_DENIED_'+treatment);
   // This Counter fixture is outside the sales manager's branch. The real QA
   // administrator reviews it; normal branch approval is tested in both books.
   return call(method,url,body,endpointUser);
  }
  return call(method,url,body,key);
 };
 await require('./uat-native-v3-phases.cjs')({...ctx,call:fixtureCall,lineTon:0.05,totalTon:0.05}).raceRedemption('K',c);
 if(!c.invoice){
  const lines=c.cuts.flatMap(cut=>cut.receipt.lines.map(l=>({redemptionId:cut.receipt.nativeId,lineNo:l.NativeLineNo}))),data={docDate:deliveryDate};
  const url='/native-documents/107/'+c.delivery.nativeId+'/';
  const p=await call('POST',url+'preview',{lines,data},'account');check(p.status===200&&p.data.plan.lines.length===2,'TREATMENT_107_PREVIEW_'+treatment);
  c.invoiceCommand||={requestId:crypto.randomUUID(),fingerprint:p.data.fingerprint,reason:RUN+' complete treatment invoice',lines,data};save();
  const result=await Promise.all([call('POST',url+'apply',c.invoiceCommand,'account'),call('POST',url+'apply',c.invoiceCommand,'account')]);
  check(result.every(r=>r.status===200)&&new Set(result.map(r=>r.data.nativeId)).size===1,'TREATMENT_107_ONCE_'+treatment);
  c.invoice=result[0].data;save();
 }
 check(c.invoice.nativeNo.startsWith('N'),'TREATMENT_107_N_BOOK_'+treatment);
 const stage=await call('GET','/so/'+c.soid,undefined,'sales');
 check(stage.status===200&&stage.data.docStage?.code==='INVOICED','TREATMENT_BILL_CLOSED_'+treatment);
 const rows=(await query(`SELECT h.DocuType,h.SumGoodAmnt,h.BillDiscAmnt,h.BillAftrDiscAmnt,h.NetAmnt,h.RemaAmnt,h.VatAmnt,h.PostGL
  FROM dbo.SOInvHD h WHERE h.SOInvID IN(@finance,@invoice)`,{finance:{type:sql.Int,value:c.delivery.financeId},invoice:{type:sql.Int,value:c.invoice.nativeId}})).recordset;
 check(rows.length===2&&rows.every(r=>Number(r.NetAmnt)===0&&Number(r.RemaAmnt)===0&&Number(r.VatAmnt)===0),'TREATMENT_202_107_ZERO_AR_VAT_'+treatment);
 check(rows.every(r=>Number(r.SumGoodAmnt)===(treatment==='DISCOUNT'?500:0)&&Number(r.BillDiscAmnt)===(treatment==='DISCOUNT'?500:0)),'TREATMENT_DISCOUNT_PRESERVED_'+treatment);
 check(rows.find(r=>Number(r.DocuType)===107)?.PostGL==='N','TREATMENT_GL_HANDOFF_'+treatment);
 const totals=(await query('SELECT COUNT(*) N,SUM(QuantityTon) Qty FROM wf.RebateTicketRedemptionAllocation WHERE ReceiptId=@r',
  {r:{type:sql.BigInt,value:receipts[0].Id}})).recordset[0];
 check(Number(totals.Qty)===0.05,'TREATMENT_NO_DOUBLE_TICKET_DEBIT_'+treatment);
};
