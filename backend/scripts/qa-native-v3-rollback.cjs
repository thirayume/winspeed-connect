'use strict';
// SQL integration rehearsal only. Every schema/fixture/native write is rolled
// back, including successful cases. This is not browser/WinSpeed Full Loop.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const sql=require('mssql'),onprem=require('../onprem-target'),runner=require('../run_migrations');
const {QA}=require('../services/native-document-target');
if(process.env.ONPREM_DB_NAME!==QA||process.env.ONPREM_SWITCHABLE_DATABASES!==QA
 ||process.env.DISABLE_BACKGROUND_WORKERS!=='true'||process.env.ONPREM_CONNECTION_PROFILES_DISABLE!=='true')throw Error('QA_ISOLATION_REQUIRED');
const {nativeDocument,queryFor}=require('../services/native-document-service');
const {nativeFingerprint}=require('../services/initial-booking-ai');
let pool,tx;
async function run(){
 const reviewer=await new sql.ConnectionPool(onprem.onpremConnectionConfig(process.env,'migration',false)).connect();
 try{
  await onprem.assertOnpremPools(reviewer,reviewer,{...process.env,DB_OPERATION:'migration'});
  const fixture=fs.readFileSync(path.join(__dirname,'qa-native-v3-fixture.sql'),'utf8');
  const expected=runner.splitBatches(fixture).find(b=>/CREATE PROCEDURE wf.usp_QaNativeV3Fixture/.test(b)).replace(/\r\n/g,'\n').trim();
  const definition=(await reviewer.request().query("SELECT OBJECT_DEFINITION(OBJECT_ID('wf.usp_QaNativeV3Fixture')) AS Definition")).recordset[0]?.Definition;
  assert.equal(String(definition||'').replace(/\r\n/g,'\n').trim(),expected,'Reviewed QA fixture must be installed by its DBA, not by widening app/migrator permissions');
 }finally{await reviewer.close();}
 pool=await new sql.ConnectionPool(onprem.onpremConnectionConfig(process.env,'runtime',false)).connect();
 await onprem.assertOnpremPools(pool,pool,process.env);
 tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 const requestFactory=tx.request.bind(tx);
 tx.request=()=>{const request=requestFactory();for(const method of ['query','batch']){
  const execute=request[method].bind(request);request[method]=async text=>{try{return await execute(text);}catch(e){e.qaStatement=String(text);throw e;}};
 }return request;};
 await tx.request().batch('SET LOCK_TIMEOUT 10000;SET ARITHABORT ON;SET ANSI_WARNINGS ON;SET ANSI_PADDING ON;SET CONCAT_NULL_YIELDS_NULL ON;SET NUMERIC_ROUNDABORT OFF;');
 const q=queryFor(tx);
 const ledger=(await q("SELECT COUNT(*) AS Applied FROM wf.SchemaMigration WHERE FileName IN('263_native_document_operation_contract.sql','264_native_document_allocators.sql','265_native_document_request_writer.sql','266_native_multiline_delivery_104.sql','267_native_partial_invoice_dispatch.sql')")).recordset[0];
 assert.equal(ledger.Applied,5,'QA schema must be applied through the migration runner first');
 assert.equal((await q("SELECT COUNT(*) AS Applied FROM wf.SchemaMigration WHERE FileName='268_native_document_business_audit.sql'")).recordset[0].Applied,1);
 console.log('NATIVE_V3_REAL_SQL_MIGRATION_LEDGER=PASS');
 console.log('NATIVE_V3_REHEARSAL_STEP=FIXTURE');
 const fullDiscount=process.env.QA_NATIVE_FULL_DISCOUNT==='true';
 const floor=process.env.QA_NATIVE_RESERVATION_FLOOR==='true';
 const f=(await q('EXEC wf.usp_QaNativeV3Fixture @FullDiscount=@full,@ReservationFloor=@floor',
  {full:{type:sql.Bit,value:fullDiscount},floor:{type:sql.Bit,value:floor}})).recordset[0];
 console.log('NATIVE_V3_REHEARSAL_STEP=ORIGIN');
 assert(f.SOID>0&&f.UserId>0);
 // Capture an actual, immutable native origin, as confirmation does.
 const origin=await nativeFingerprint(q,f.SOID);
 await q(`INSERT wf.NativeBookingOrigin(SOID,SourceDraftId,SalesUserId,ConfirmedById,ConfirmedActorId,Fingerprint,PolicyVersion)
  VALUES(@s,@d,@u,@u,@u,@hash,'NATIVE-DOCUMENTS-v3')`,{s:{type:sql.Int,value:f.SOID},d:{type:sql.Int,value:f.DraftId},
  u:{type:sql.Int,value:f.UserId},hash:{type:sql.VarChar(64),value:origin}});
 console.log('NATIVE_V3_REHEARSAL_STEP=AI_PREVIEW');
 const user={sub:f.UserId,role:'ADMIN'},options={transaction:async fn=>fn(tx)};
 if(floor){
  assert.equal((await q("SELECT COUNT(*) AS N FROM wf.SchemaMigration WHERE FileName='269_native_reservation_before_debit.sql'")).recordset[0].N,1);
  options.verifyMetadata=async query=>{
   // This explicit SQL test profile permits exactly one reviewed state change.
   // No production verifier or definition hash is bypassed.
   const reviewed=require('../services/native-document-metadata.json');
   const tables=reviewed.tables.map(t=>"OBJECT_ID('dbo."+t+"')").join(',');
   const rows=(await query('SELECT OBJECT_NAME(t.parent_id) AS TableName,t.name,t.is_disabled,m.definition FROM sys.triggers t LEFT JOIN sys.sql_modules m ON m.object_id=t.object_id WHERE t.parent_id IN('+tables+')')).recordset;
   const expected=reviewed.triggers.map(r=>r[1]==='wf_couponreservationguard'?[r[0],r[1],0,r[3]]:r);
   require('../services/initial-invoice-metadata').validateOperationalMetadataRows(rows,expected);
  };
 }
 const act=(type,sourceId,operation,rest={})=>nativeDocument({type,sourceId,operation,user,...rest},options);
 const requestId=()=>crypto.randomUUID();
 const ai=await act(119,f.SOID,'preview');
 console.log('NATIVE_V3_REHEARSAL_STEP=AI_APPLY');
 const aiId=requestId(),aiArgs={requestId:aiId,fingerprint:ai.fingerprint,reason:'QA rollback booking approval'};
 const approved=await act(119,f.SOID,'apply',aiArgs);assert.equal(approved.docuType,119);
 assert.equal((await act(119,f.SOID,'apply',aiArgs)).replayed,true);
 console.log('NATIVE_V3_REAL_SQL_AI_AND_REPLAY=PASS');
 const dp=await act(104,f.SOID,'preview'),did=requestId();
 console.log('NATIVE_V3_REHEARSAL_STEP=104_REQUEST');
 await act(104,f.SOID,'request',{requestId:did,fingerprint:dp.fingerprint,reason:'QA rollback two-line credit review'});
 await q('UPDATE wf.SalesOrderExt SET IsUnlocked=1 WHERE SOID=CONVERT(varchar(50),@s)',{s:{type:sql.Int,value:f.SOID}});
 await assert.rejects(act(104,f.SOID,'approve',{requestId:did,reason:'QA changed source must be refused'}),
  e=>['ND_SOURCE_CHANGED','ND_ORIGIN_CHANGED'].includes(e.code));
 await q('UPDATE wf.SalesOrderExt SET IsUnlocked=0 WHERE SOID=CONVERT(varchar(50),@s)',{s:{type:sql.Int,value:f.SOID}});
 console.log('NATIVE_V3_REAL_SQL_SOURCE_CHANGE_REJECTED_BEFORE_APPROVAL=PASS');
 await q(`SAVE TRANSACTION QA_CREDIT_HOLD;
  MERGE wf.CreditMaster WITH(HOLDLOCK) AS t USING(SELECT CONVERT(nvarchar(20),@c) AS CustId)s ON t.CustId=s.CustId
  WHEN MATCHED THEN UPDATE SET CreditHold=1
  WHEN NOT MATCHED THEN INSERT(CustId,CreditHold) VALUES(s.CustId,1);`,{c:{type:sql.Int,value:f.CustId}});
 await assert.rejects(act(104,f.SOID,'approve',{requestId:did,reason:'QA finance hold must block approval'}),{code:'ND_CUSTOMER_CREDIT_HOLD'});
 await q('ROLLBACK TRANSACTION QA_CREDIT_HOLD');
 console.log('NATIVE_V3_REAL_SQL_LIVE_FINANCE_HOLD_BLOCKS_APPROVAL=PASS');
 console.log('NATIVE_V3_REHEARSAL_STEP=104_APPROVE');
 await act(104,f.SOID,'approve',{requestId:did,reason:'QA exact-source credit approval'});
 console.log('NATIVE_V3_REHEARSAL_STEP=104_APPLY');
 const delivery=await act(104,f.SOID,'apply',{requestId:did});
 assert.equal(delivery.lines.length,2);assert.equal((await act(104,f.SOID,'apply',{requestId:did})).replayed,true);
 console.log('NATIVE_V3_REAL_SQL_MULTILINE_104_202=PASS');
 const context=await require('../services/native-document-context').inspectBooking({soid:f.SOID,user},options);
 assert(context.deliveries.some(r=>r.id===delivery.nativeId));
 assert(delivery.lines.every(l=>context.coupons.some(c=>c.id===l.CouponId)));
 console.log('NATIVE_V3_REAL_SQL_SCOPED_UI_CONTEXT=PASS');
 await q(`INSERT wf.CouponExpiry(CouponId,ExpiryDate,Source,SetBy,SetAt,Note,UpdatedAt)
  VALUES(@c,DATEADD(day,-1,CONVERT(date,DATEADD(hour,7,GETUTCDATE()))),'MANUAL',@u,GETUTCDATE(),'QA rollback expired-use proof',GETUTCDATE())`,
  {c:{type:sql.Int,value:delivery.lines[0].CouponId},u:{type:sql.Int,value:f.UserId}});
 const reservations=new Map();
 for(const l of delivery.lines){
  const result=(await q(`INSERT wf.CouponReservation(CouponId,CouponNo,GoodId,CarrierSoId,BeneficiaryCustId,OwnerCustId,ReservedQty,CreatedBy,IdempotencyKey,ExpiresAt)
   SELECT c.CouponID,c.CouponNo,c.GoodID,CONVERT(varchar(50),@source),@cust,@cust,0.6,@user,@key,DATEADD(hour,1,GETUTCDATE())
   FROM dbo.WFCoupon c WHERE c.CouponID=@coupon;SELECT CONVERT(varchar(30),SCOPE_IDENTITY()) AS Id`,{
   source:{type:sql.Int,value:f.SOID},cust:{type:sql.VarChar(50),value:String(f.CustId)},user:{type:sql.Int,value:f.UserId},
   key:{type:sql.NVarChar(120),value:requestId()},coupon:{type:sql.Int,value:l.CouponId}})).recordset[0];
  reservations.set(l.CouponId,result.Id);
 }
 await assert.rejects(act(116,f.CustId,'preview',{lines:delivery.lines.map(l=>({couponId:l.CouponId,quantity:'0.1'})),
  data:{docDate:f.Today,slipNo:String(f.SlipBase+9),receiver:'QA held balance',plate:'QA-HELD'}}));
 console.log('NATIVE_V3_REAL_SQL_OTHER_RESERVATIONS_NOT_SPENDABLE=PASS');
 async function cut(quantity,sequence){
  const lines=delivery.lines.map(l=>({couponId:l.CouponId,quantity,settlements:[{reservationId:reservations.get(l.CouponId),quantity}]}));
  const data={docDate:f.Today,slipNo:String(f.SlipBase+sequence),receiver:'QA rollback recipient',plate:'QA-ROLLBACK'};
  const preview=await act(116,f.CustId,'preview',{lines,data}),rid=requestId();
  assert.equal(preview.plan.lines.find(l=>l.couponId===delivery.lines[0].CouponId).expired,true);
  await act(116,f.CustId,'request',{requestId:rid,fingerprint:preview.fingerprint,reason:'QA two-line partial native cut',lines,data});
  await act(116,f.CustId,'approve',{requestId:rid,reason:'QA manual evidence reviewed'});
  const result=await act(116,f.CustId,'apply',{requestId:rid});
  assert.equal(result.lines.length,2);assert.equal((await act(116,f.CustId,'apply',{requestId:rid})).replayed,true);
  return result;
 }
 async function invoice(cut){
  const lines=cut.lines.map(l=>({redemptionId:cut.nativeId,lineNo:l.NativeLineNo})),data={docDate:f.Today};
  const preview=await act(107,delivery.nativeId,'preview',{lines,data}),rid=requestId();
  const result=await act(107,delivery.nativeId,'apply',{requestId:rid,fingerprint:preview.fingerprint,reason:'QA allocated partial invoice',lines,data});
  assert.equal(result.lines.length,2);assert.equal((await act(107,delivery.nativeId,'apply',{requestId:rid,lines,data})).replayed,true);
  return preview.plan;
 }
 const first=await cut('0.2',1);console.log('NATIVE_V3_REAL_SQL_MULTILINE_PARTIAL_116=PASS');
 await q('SAVE TRANSACTION QA_MUTATED_CUT');
 await q('EXEC wf.usp_QaNativeV3Fixture @MutateRedemptionId=@r',{r:{type:sql.Int,value:first.nativeId}});
 await assert.rejects(invoice(first),{code:'ND_CUT_DIVERGED'});
 await q('ROLLBACK TRANSACTION QA_MUTATED_CUT');
 console.log('NATIVE_V3_REAL_SQL_EDITED_NATIVE_CUT_REJECTED_BEFORE_107=PASS');
 const firstInvoice=await invoice(first);console.log('NATIVE_V3_REAL_SQL_PARTIAL_107=PASS');
 const last=await cut('0.4',2),lastInvoice=await invoice(last);
 const {fixed}=require('../services/native-document-plan');
 assert.equal(fixed(firstInvoice.gross)+fixed(lastInvoice.gross),180000000n);
 assert.equal(fixed(firstInvoice.discount)+fixed(lastInvoice.discount),fullDiscount?180000000n:1234500n);
 assert.equal(fixed(firstInvoice.net)+fixed(lastInvoice.net),fullDiscount?0n:178765500n);
 assert.equal((await act(104,f.SOID,'apply',{requestId:did})).replayed,true);
 console.log('NATIVE_V3_REAL_SQL_FINAL_DISCOUNT_CONSERVATION_AND_EARLIER_REPLAY=PASS');
 if(fullDiscount)console.log('NATIVE_V3_REAL_SQL_FULL_HEADER_DISCOUNT_THROUGH_202_AND_PARTIAL_107=PASS');
 const settled=(await q(`SELECT COUNT(*) AS Settlements FROM wf.CouponReservationSettlement WHERE ReservationId IN
  (SELECT Id FROM wf.CouponReservation WHERE CreatedBy=@u AND CarrierSoId=CONVERT(varchar(50),@s));
  SELECT COUNT(*) AS Complete FROM wf.CouponReservation WHERE CreatedBy=@u AND CarrierSoId=CONVERT(varchar(50),@s)
   AND Status='CONSUMED' AND ConsumedQty=ReservedQty`,{u:{type:sql.Int,value:f.UserId},s:{type:sql.Int,value:f.SOID}})).recordsets;
 assert.equal(settled[0][0].Settlements,4);assert.equal(settled[1][0].Complete,2);
 console.log('NATIVE_V3_REAL_SQL_RESERVATIONS_SETTLE_PARTIAL_AND_FINAL_ONCE=PASS');
 if(floor)console.log('NATIVE_V3_REAL_SQL_SHARED_RESERVATION_FLOOR_WITH_OWN_PARTIAL_CUTS=PASS');
 const incidents=(await q(`SELECT COUNT(*) AS N FROM wf.RuleIncident WHERE IncidentType='TICKET_USED_EXPIRED' AND DocuNo=@no`,
  {no:{type:sql.NVarChar(30),value:delivery.lines[0].CouponNo}})).recordset[0].N;
 assert.equal(incidents,2,'Each expired cut records one incident, replays record none');
 console.log('NATIVE_V3_REAL_SQL_EXPIRED_TICKET_ALLOWED_INCIDENT_ONCE_PER_CUT=PASS');
 const window=(await q("SELECT SettingValue FROM wf.SystemSetting WHERE SettingKey='GLOBAL_DATA_START_DATE'")).recordset[0];
 if(!window)await q("INSERT wf.SystemSetting(SettingKey,SettingValue,Description) VALUES('GLOBAL_DATA_START_DATE','2026-01-01','QA rollback cutoff fixture')");
 await q(`UPDATE wf.SystemSetting SET SettingValue=CONVERT(varchar(10),DATEADD(day,1,CONVERT(date,DATEADD(hour,7,GETUTCDATE()))),120)
  WHERE SettingKey='GLOBAL_DATA_START_DATE'`);
 await assert.rejects(act(104,f.SOID,'apply',{requestId:did}),{code:'ND_SOURCE_BEFORE_CUTOFF'});
 if(window)await q("UPDATE wf.SystemSetting SET SettingValue=@value WHERE SettingKey='GLOBAL_DATA_START_DATE'",
  {value:{type:sql.NVarChar(sql.MAX),value:window.SettingValue}});
 else await q("DELETE wf.SystemSetting WHERE SettingKey='GLOBAL_DATA_START_DATE'");
 assert.equal((await act(104,f.SOID,'apply',{requestId:did})).replayed,true);
 console.log('NATIVE_V3_REAL_SQL_REPLAY_RECHECKS_CURRENT_CUTOFF=PASS');
 await assert.rejects(cut('0.0001',3));
 const verified=(await q(`SELECT COUNT(*) AS Receipts FROM wf.NativeDocumentReceipt WHERE UserId=@u`,{u:{type:sql.Int,value:f.UserId}})).recordset[0];
 assert.equal(verified.Receipts,6);
 const audits=(await q(`SELECT SoId FROM wf.SalesOrderAudit WHERE UserId=@u AND Action='NATIVE_DOCUMENT_APPLIED'`,
  {u:{type:sql.Int,value:f.UserId}})).recordset;
 assert.equal(audits.length,6);assert(audits.every(r=>String(r.SoId)===String(f.SOID)));
 console.log('NATIVE_V3_REAL_SQL_TYPED_AUDIT_RESOLVES_ORIGINAL_BOOKING=PASS');
 await tx.rollback();tx=null;
 console.log('NATIVE_V3_REAL_SQL_ALL_BUSINESS_WRITES_ROLLED_BACK=PASS');
}
run().catch(e=>{console.error('NATIVE_V3_SQL_REHEARSAL_FAILED '+(e.code||'ERROR')+' number='+(e.number||0)+' detail='+String(e.message).slice(0,500));
 if(e.changedFields)console.error('QA_CHANGED_FIELDS '+JSON.stringify(e.changedFields));
 if(e.qaStatement)console.error('QA_PARAMETERIZED_SQL_TEMPLATE '+e.qaStatement.slice(0,3500));process.exitCode=1;})
 .finally(async()=>{if(tx)try{await tx.rollback();}catch{}if(pool)await pool.close();});
