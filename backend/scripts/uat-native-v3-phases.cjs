'use strict';
// Operational phases for the shared Full Loop harness. No credentials or
// document fixtures in source; all identifiers stay in the run's private state.
const crypto=require('crypto');
module.exports=function(ctx){
 const {call,query,check,save,state,fixtures,sql,CUST_ID,RUN,deliveryDate}=ctx;
 const route=(type,id,operation)=>`/native-documents/${type}/${id}/${operation}`;
 const post=(type,id,operation,body,key)=>call('POST',route(type,id,operation),body,key);
 async function concurrent(type,id,command,key,label){
  const results=await Promise.all([post(type,id,'apply',command,key),post(type,id,'apply',command,key)]);
  check(results.some(r=>r.status===200),label+'_A_CREATE_OR_REPLAY_SUCCEEDED');
  for(let i=0;i<results.length;i++)if(results[i].status===409&&['ND_BUSY','LOCK_TIMEOUT','DEADLOCK_RETRY'].includes(results[i].data.code))
   results[i]=await post(type,id,'apply',command,key);
  check(results.every(r=>r.status===200),label+'_CONCURRENT_HTTP');
  check(new Set(results.map(r=>r.data.nativeId)).size===1,label+'_ONE_NATIVE_ID');
  check(results.filter(r=>r.data.replayed===false).length<=1,label+'_AT_MOST_ONE_CREATE');
  return results[0].data;
 }
 async function ai(book,c){
  check((await post(119,c.soid,'preview',{},'sales')).status===403,book+'_SALES_CANNOT_APPROVE_AI');
  if(!c.ai){
   const p=await post(119,c.soid,'preview',{},'counter');check(p.status===200,book+'_V3_AI_PREVIEW');
   c.aiCommand||={requestId:crypto.randomUUID(),fingerprint:p.data.fingerprint,reason:RUN+' booking reviewed'};save();
   c.ai=await concurrent(119,c.soid,c.aiCommand,'counter',book+'_V3_AI');save();
  }
  check((await post(119,c.soid,'apply',c.aiCommand,'counter')).data.replayed===true,book+'_V3_AI_REPLAY');
 }
 async function delivery(book,c){
  for(const operation of ['preview','request','apply'])check((await post(104,c.soid,operation,
   operation==='preview'?{}:{requestId:crypto.randomUUID(),fingerprint:'a'.repeat(64),reason:'QA permission denial'},'sales')).status===403,
   book+'_V3_SALES_DENIED_104_'+operation.toUpperCase());
  let requester='counter';
  if(book==='K'){
   const switched=await call('POST','/auth/access-as',{userId:fixtures.users.counter.id},'account');
   check(switched.status===200&&switched.data.user?.isImpersonating,'K_V3_ACCESS_AS_COUNTER');requester=switched.data.accessToken;
  }
  try{
   if(!c.delivery){
    if(!c.deliveryCommand){
     const preview=await post(104,c.soid,'preview',{},requester);check(preview.status===200&&preview.data.plan.lines.length===2,book+'_V3_TWO_LINE_104_PREVIEW');
     c.deliveryCommand={requestId:crypto.randomUUID(),fingerprint:preview.data.fingerprint,reason:RUN+' native customer credit review'};save();
     check((await post(104,c.soid,'request',c.deliveryCommand,requester)).status===200,book+'_V3_104_REQUEST');
    }
    const held=await post(104,c.soid,'apply',c.deliveryCommand,requester);
    check(held.status===409&&held.data.code==='ND_APPROVAL_REQUIRED',book+'_V3_104_APPROVAL_FENCE');
    for(const key of ['sales','counter','manager','warehouse'])check((await post(104,c.soid,'approve',c.deliveryCommand,key)).status===403,book+'_V3_CREDIT_DENY_'+key.toUpperCase());
    check((await post(104,c.soid,'approve',c.deliveryCommand,'account')).status===200,book+'_V3_ACCOUNT_CREDIT_APPROVAL');
    const r=await concurrent(104,c.soid,c.deliveryCommand,requester,book+'_V3_104');
    c.delivery={...r,deliverySoid:r.nativeId,deliveryNo:r.nativeNo,couponNo:r.lines[0].CouponNo};save();
   }
   check(c.delivery.lines.length===2&&c.delivery.lines.every(l=>l.CouponNo.startsWith(book==='I'?'C':'D')),book+'_V3_TWO_DISTINCT_TICKETS');
  }finally{if(book==='K')check((await call('POST','/auth/access-as/stop',{},requester)).status===200,'K_V3_ACCESS_AS_STOP');}
 }
 async function approvedCut(lines,sequence,c,key='sales'){
  c.cutCommands||={};
  const code=String(sequence);
  if(!c.cutCommands[code]){
   if(!state.slipBase){
    const max=(await query("SELECT MAX(CONVERT(int,DocuNo)) AS LastNo FROM dbo.WFRedemtionHD WHERE LEN(DocuNo)<=9 AND DocuNo NOT LIKE '%[^0-9]%'")).recordset[0].LastNo;
    state.slipBase=Math.max(990000000,Number(max||0)+10);if(state.slipBase>999999900)throw Error('QA_SLIP_RANGE_EXHAUSTED');save();
   }
   const data={docDate:deliveryDate,slipNo:String(state.slipBase+sequence),receiver:'QA FULL LOOP SIMULATION',plate:'QA-V3-'+sequence};
   const preview=await post(116,CUST_ID,'preview',{lines,data},key);check(preview.status===200,'V3_116_PREVIEW_'+sequence);
   c.cutCommands[code]={requestId:crypto.randomUUID(),fingerprint:preview.data.fingerprint,reason:RUN+' manual QA transport evidence',lines,data};save();
   check((await post(116,CUST_ID,'request',c.cutCommands[code],key)).status===200,'V3_116_REQUEST_'+sequence);
  }
  const command=c.cutCommands[code];
  check((await post(116,CUST_ID,'apply',command,'sales')).status===403,'V3_SALES_CANNOT_RECORD_116_'+sequence);
  const held=await post(116,CUST_ID,'apply',command,'warehouse');
  check(held.status===409&&held.data.code==='ND_APPROVAL_REQUIRED','V3_116_APPROVAL_FENCE_'+sequence);
  for(const role of ['sales','counter','warehouse','account'])check((await post(116,CUST_ID,'approve',command,role)).status===403,'V3_116_DENY_'+role.toUpperCase()+'_'+sequence);
  check((await post(116,CUST_ID,'approve',command,'manager')).status===200,'V3_116_MANAGER_APPROVAL_'+sequence);
  return {command,receipt:await concurrent(116,CUST_ID,command,'warehouse','V3_116_'+sequence)};
 }
 async function redemption(book,c){
  c.cuts||=[];
  if(book==='I'&&!state.cases.K?.delivery)throw Error('V3_BOTH_DELIVERIES_REQUIRED_FOR_MIXED_DRAW');
  const own=c.delivery.lines;
  if(c.cuts.length<1){
   const lines=own.map(l=>({couponId:l.CouponId,quantity:book==='I'?'0.2':'0.15'}));
   if(book==='I')lines.push(...state.cases.K.delivery.lines.map(l=>({couponId:l.CouponId,quantity:'0.1'})));
   c.cuts.push(await approvedCut(lines,book==='I'?1:3,c));save();
   if(book==='I')check(c.cuts[0].receipt.lines.length===4&&new Set(c.cuts[0].receipt.lines.map(l=>l.CouponNo[0])).size===2,'V3_MIXED_C_D_FOUR_LINES_ONE_116');
  }
  if(c.cuts.length<2){c.cuts.push(await approvedCut(own.map(l=>({couponId:l.CouponId,quantity:book==='I'?'0.3':'0.25'})),book==='I'?2:4,c));save();}
  c.manual={redemptionId:c.cuts[0].receipt.nativeId,redemptionNo:c.cuts[0].receipt.nativeNo};save();
 }
 async function raceRedemption(book,c){
  c.race||={commands:[],approved:[]};const race=c.race;
  if(!state.slipBase){
   const max=(await query("SELECT MAX(CONVERT(int,DocuNo)) AS LastNo FROM dbo.WFRedemtionHD WHERE LEN(DocuNo)<=9 AND DocuNo NOT LIKE '%[^0-9]%'")).recordset[0].LastNo;
   state.slipBase=Math.max(990000000,Number(max||0)+10);
   if(state.slipBase>999999900)throw Error('QA_SLIP_RANGE_EXHAUSTED');save();
  }
  for(let i=0;i<2;i++){
   if(!race.commands[i]){
    const lines=c.delivery.lines.map(l=>({couponId:l.CouponId,quantity:'0.3'}));
    const data={docDate:deliveryDate,slipNo:String(state.slipBase+20+i),receiver:'QA competing real API requests',plate:'QA-RACE-'+i};
    const p=await post(116,CUST_ID,'preview',{lines,data},'sales');check(p.status===200,'V3_DIFFERENT_KEY_PREVIEW_'+i);
    race.commands[i]={requestId:crypto.randomUUID(),fingerprint:p.data.fingerprint,reason:RUN+' competing cut request',lines,data};save();
    check((await post(116,CUST_ID,'request',race.commands[i],'sales')).status===200,'V3_DIFFERENT_KEY_REQUEST_'+i);
   }
   if(!race.approved[i]){
    check((await post(116,CUST_ID,'approve',race.commands[i],'manager')).status===200,'V3_DIFFERENT_KEY_APPROVED_'+i);
    race.approved[i]=true;save();
   }
  }
  if(!race.winner){
   const results=await Promise.all(race.commands.map(command=>post(116,CUST_ID,'apply',command,'warehouse')));
   for(let i=0;i<2;i++)if(results[i].status===409&&['ND_BUSY','LOCK_TIMEOUT','DEADLOCK_RETRY'].includes(results[i].data.code))
    results[i]=await post(116,CUST_ID,'apply',race.commands[i],'warehouse');
   check(results.filter(r=>r.status===200).length===1&&results.filter(r=>r.status===409).length===1,'V3_DIFFERENT_KEYS_EXACTLY_ONE_CUT');
   const index=results.findIndex(r=>r.status===200),loser=1-index;
   check(['ND_SOURCE_CHANGED','ND_COUPON_INSUFFICIENT'].includes(results[loser].data.code),'V3_DIFFERENT_KEY_LOSER_REVALIDATES_BALANCE');
   race.winner=index+1;c.cuts=[{command:race.commands[index],receipt:results[index].data}];save();
  }
  if(!race.loserCancelled){
   check((await post(116,CUST_ID,'cancel',{requestId:race.commands[2-race.winner].requestId,reason:'QA competing request safely cancelled'},'sales')).status===200,'V3_DIFFERENT_KEY_LOSER_CANCELLED');
   race.loserCancelled=true;save();
  }
  const q=(await query('SELECT MIN(RemaQty) AS MinQty,MAX(RemaQty) AS MaxQty FROM dbo.WFCoupon WHERE DocuID=@id',
   {id:{type:sql.Int,value:c.delivery.nativeId}})).recordset[0];
  if(c.cuts.length===1){
   check(Number(q.MinQty)===0.2&&Number(q.MaxQty)===0.2,'V3_DIFFERENT_KEYS_NO_OVERDRAW');
   c.cuts.push(await approvedCut(c.delivery.lines.map(l=>({couponId:l.CouponId,quantity:'0.2'})),23,c));save();
  }
  c.manual={redemptionId:c.cuts[0].receipt.nativeId,redemptionNo:c.cuts[0].receipt.nativeNo};save();
 }
 async function invoice(book,c){
  if(!c.invoice){
   const couponIds=new Set(c.delivery.lines.map(l=>l.CouponId));
   const lines=Object.values(state.cases).flatMap(other=>(other.cuts||[]).flatMap(cut=>cut.receipt.lines.filter(l=>couponIds.has(l.CouponId))
    .map(l=>({redemptionId:cut.receipt.nativeId,lineNo:l.NativeLineNo}))));
   const data={docDate:deliveryDate},p=await post(107,c.delivery.nativeId,'preview',{lines,data},'account');
   check(p.status===200&&p.data.plan.lines.length>=4,book+'_V3_MULTI_CUT_107_PREVIEW');
   c.invoiceCommand||={requestId:crypto.randomUUID(),fingerprint:p.data.fingerprint,reason:RUN+' Post Invoice from exact transport date',lines,data};save();
   check((await post(107,c.delivery.nativeId,'apply',c.invoiceCommand,'sales')).status===403,book+'_V3_SALES_CANNOT_POST_107');
   const r=await concurrent(107,c.delivery.nativeId,c.invoiceCommand,'account',book+'_V3_107');
   c.invoice={...r,invoiceId:r.nativeId,invoiceNo:r.nativeNo};save();
  }
  check(c.invoice.invoiceNo.startsWith(book==='I'?'J':'N'),book+'_V3_INVOICE_CORRECT_BOOK');
  const status=await call('GET','/so/'+c.soid,undefined,'sales');
  check(status.status===200&&status.data.docStage?.code==='INVOICED'&&status.data.docStage.cutQty===1&&status.data.docStage.invoicedQty===1,book+'_V3_CLOSE_AT_COMPLETE_107');
  const gl=(await query('SELECT PostGL FROM dbo.SOInvHD WHERE SOInvID=@id AND Docutype=107',{id:{type:sql.Int,value:c.invoice.nativeId}})).recordset[0];
  check(gl?.PostGL==='N',book+'_V3_GL_HANDOFF_TO_ACCOUNTING');
 }
 async function audit(){
  for(const [book,c]of Object.entries(state.cases)){
   const native=(await query(`SELECT
    (SELECT COUNT(*) FROM dbo.SODT WHERE SOID=@d AND DocuType=104) AS Lines,
    (SELECT COUNT(*) FROM dbo.WFCoupon WHERE DocuID=@d) AS Coupons,
    (SELECT SUM(RemaQty) FROM dbo.WFCoupon WHERE DocuID=@d) AS Remaining,
    (SELECT COUNT(*) FROM wf.NativeDocumentReceipt WHERE DocuType=104 AND SourceId=@s AND NativeAfterHash IS NOT NULL) AS Receipts,
    (SELECT SUM(GoodQty2) FROM dbo.SOInvDT WHERE SOInvID=@i AND Docutype=107) AS InvoicedQty,
    (SELECT SUM(GoodStockQty) FROM dbo.ICStockDetail WHERE DocuID=@i AND DocuType=107 AND StockFlag=-1) AS StockQty`,{
    s:{type:sql.Int,value:c.soid},d:{type:sql.Int,value:c.delivery.nativeId},i:{type:sql.Int,value:c.invoice.nativeId}})).recordset[0];
   check(native.Lines===2&&native.Coupons===2&&native.Receipts===1&&Number(native.Remaining)===0&&Number(native.InvoicedQty)===1&&Number(native.StockQty)===1,book+'_V3_SQL_QUANTITY_AND_RECEIPTS');
   const products=(await query('SELECT COUNT(DISTINCT GoodID) AS N FROM dbo.SODT WHERE SOID=@d AND DocuType=104',
    {d:{type:sql.Int,value:c.delivery.nativeId}})).recordset[0];
   check(products.N===2,book+'_V3_DISTINCT_NATIVE_PRODUCTS');
   for(const [type,no,key]of [[104,c.delivery.nativeNo,'warehouse'],[116,c.manual.redemptionNo,'warehouse'],[107,c.invoice.nativeNo,'account']]){
    const printed=await call('GET',`/native-print/${type}/${no}`,undefined,key);
    check(printed.status===200&&Array.isArray(printed.data.items)&&printed.data.items.length>=2,book+'_V3_PRINT_MULTILINE_'+type);
    check((await call('POST',`/native-print/${type}/${no}/printed`,{},key)).status===200,book+'_V3_PRINT_AUDIT_'+type);
   }
   for(const line of c.delivery.lines){
    const t=await call('GET',`/master/control-tickets/${line.CouponNo}/trace?entityType=COUPON&exactId=${line.CouponId}`,undefined,'account');
    check(t.status===200&&t.data.isAmbiguous===false&&t.data.truncated===false,book+'_V3_TRACE_EXACT_'+line.NativeLineNo);
    const chain=t.data.chain;
    check(chain.bookings.some(x=>Number(x.soId)===c.soid)&&chain.deliveries.some(x=>Number(x.soId)===c.delivery.nativeId)
     &&chain.coupons.some(x=>Number(x.couponId)===line.CouponId)
     &&chain.invoices.some(x=>Number(x.soInvId)===c.invoice.nativeId),book+'_V3_TRACE_COMPLETE_'+line.NativeLineNo);
   }
  }
  const docs=await call('GET','/reports/native-documents?limit=500',undefined,'account');
  check(docs.status===200,'V3_REPORT_NATIVE_DOCUMENTS_READ');
  for(const [book,c]of Object.entries(state.cases)){
   const rows=(docs.data.rows||[]).filter(r=>r.BookingNo===c.bookingNo);
   const ownIds=new Set(c.delivery.lines.map(l=>l.CouponId));
   const cuts=Object.values(state.cases).flatMap(s=>s.cuts||[]).filter(cut=>cut.receipt.lines.some(l=>ownIds.has(l.CouponId)));
   check(rows.length===cuts.length&&rows.every(r=>r.Stage==='107 แล้ว'&&r.InvoiceNo===c.invoice.nativeNo
    &&r.AiNo===c.ai.nativeNo&&r.DeliveryNo===c.delivery.nativeNo&&r.RecorderEmp&&!r.ApproverEmp),
    book+'_V3_REPORT_SEGMENTS_AND_RECORDER');
   check(cuts.every(cut=>rows.some(r=>r.SlipNo===cut.receipt.nativeNo)),book+'_V3_REPORT_ALL_PHYSICAL_CUTS');
   const bookingAudit=(await query(`SELECT COUNT(*) AS N FROM wf.SalesOrderAudit
    WHERE SoId=CONVERT(varchar(50),@s) AND Action='NATIVE_DOCUMENT_APPLIED'`,{s:{type:sql.Int,value:c.soid}})).recordset[0];
   check(bookingAudit.N===3+cuts.length,book+'_V3_AUDIT_EACH_TYPED_OPERATION_ON_BOOKING');
  }
  const exported=await call('GET','/reports/native-documents/export?limit=500',undefined,'account');
  check(exported.status===200&&Buffer.isBuffer(exported.data.workbook),'V3_REPORT_XLSX_RESPONSE');
  const xlsx=require('xlsx'),wb=xlsx.read(exported.data.workbook,{type:'buffer'});
  const cells=wb.SheetNames.flatMap(name=>xlsx.utils.sheet_to_json(wb.Sheets[name],{header:1}).flat()).map(String);
  check(Object.values(state.cases).every(c=>[c.bookingNo,c.delivery.nativeNo,c.invoice.nativeNo].every(no=>cells.includes(no))),
   'V3_REPORT_XLSX_CONTAINS_BOTH_CHAINS');
  check((await call('GET','/reports/native-documents',undefined,'sales')).status===403,'V3_REPORT_SALES_DENIED');
 }
 return {ai,delivery,redemption,raceRedemption,invoice,audit};
};
