'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
h.installDbStub(({text})=>text.includes("COL_LENGTH('wf.ChangeEvent'")?[{HasCol:1}]:[]);
const {listNativeCutReview,recordNativeReviewHold,assertNativeHoldPrimary}=require('../services/coupon-native-review-queue');
const actor={sub:4,actorSub:9,role:'MANAGER',actorRole:'ADMIN',isImpersonating:true};
const input={actor,dataWindow:{businessDate:'2026-01-01'},limit:25};
let flags,calls,audits;
function fixture(){
 flags={};calls=[];audits=[];
 const tx={request(){const args={};return {input(k,t,v){args[k]=v;return this;},async query(text){
  calls.push(text);
  if(text.includes('COUPON_RECOVERY_READINESS_V1')) {
   if(flags.editHold)return {recordset:[{...require('./helpers/coupon-bridge-metadata').absent,RecoverySchemaState:'COUPON_RECOVERY_READINESS_V1',Ledger231:1,RecoveryVisible:1,RecoverySelect:1,Ledger232:1,EditHoldVisible:1,EditHoldSelect:1}]};
   return require('./helpers/native-hold-legacy.cjs')(text);
  }
  if(text.includes('AS ReceiptVisible'))return {recordset:[{
   WriterMigration:flags.completedEdit?1:0,ReceiptVisible:flags.completedEdit?1:0,ReceiptSelect:flags.receiptDenied?0:1,
  }]};
  if(text.includes('AS OpeningSourceRestored'))return {recordset:[{
   LineCount:2,RestoredQty:'0.0500',SettledAfter:'0.1500',OpeningSourceRestored:'0.0500',InvalidCount:flags.badRecovery?1:0,
  }]};
  if(text.includes('FROM wf.CouponNativeEditHold'))return {recordset:flags.editHold?[{Completed:flags.completedEdit?1:0}]:[]};
  if(text.includes('FROM wf.SystemSetting'))return {recordset:[{SettingValue:flags.window||'2026-01-01'}]};
  if(text.includes('GETUTCDATE() AS ServerNow'))return {recordset:[{ServerNow:new Date('2026-11-16T10:00:00Z')}]};
  if(text.includes('FROM wf.CouponNativeCutAuthorization WITH'))return {recordset:[{Id:123,DocuNo:'QA-116',State:flags.closed?'CANCELLED':'ACTIVE',ExpiresAt:new Date('2026-11-16T09:00:00Z')}]};
  if(text.includes('FROM wf.CouponNativeCutAuthorizationLine WITH'))return {recordset:flags.mixed?[{ReservationId:11,CouponId:41,AuthorizedQty:0.1},{ReservationId:12,CouponId:42,AuthorizedQty:0.2}]:[{ReservationId:flags.changed&&text.includes('HOLDLOCK')?12:11,CouponId:41,AuthorizedQty:0.1}]};
  if(text.includes('FROM dbo.WFCoupon WITH'))return {recordset:[{CouponID:args.cid}]};
  if(text.includes('FROM wf.CouponReservation WITH'))return {recordset:[{Id:args.rid}]};
  if(text.includes('AS RelatedSource'))return {recordset:flags.related?[{RelatedSource:1}]:[]};
  if(text.includes('FROM dbo.WFRedemtionHD'))return {recordset:flags.source?[{RedemtionID:51,DocuNo:'QA-116',DocuType:116,DocuStatus:'N',DocuDate:flags.old?'2025-12-31':'2026-11-16'}]:[]};
  if(text.includes('FROM dbo.WFRedemtionDT'))return {recordset:[{CouponID:41,GoodQty:flags.mismatch?0.2:0.1}]};
  if(text.includes('FROM wf.CouponReservationSettlement'))return {recordset:[]};
  if(text.includes('FROM wf.CouponNativeCutEvidence'))return {recordset:flags.mixed?[{EvidenceState:'APPLIED',NativeRedemptionId:51},{EvidenceState:'PREPARED',NativeRedemptionId:51}]:flags.pending?[{EvidenceState:flags.applied?'APPLIED':'PREPARED',NativeRedemptionId:51}]:[]};
  if(text.includes('FROM dbo.SMAudit')){if(flags.missingEvidence)return {};return {recordset:flags.auditEvidence?[{Found:1}]:[]};}
  if(text.includes('INSERT INTO wf.ChangeEvent')){audits.push({...args});return {recordset:[],rowsAffected:[1]};}
  throw Error('unexpected SQL');
 }};}};
 return {currentActorId:()=>9,hasColumn:async()=>true,assertPrimaryDatabase:async()=>{if(flags.secondary)throw Object.assign(Error('secondary'),{status:403});},assertHoldPrimary:async()=>{if(flags.secondary)throw Object.assign(Error('secondary'),{status:403});},
  authorizationHoldsAvailable:async()=>true,nativeCutEvidenceAvailable:async()=>Boolean(flags.evidence),couponVisible:async()=>!flags.hidden,reservationsVisible:async()=>!flags.hidden,
  logChangeEvent:async(actual,event)=>{assert.equal(actual,tx);if(flags.auditFailure)throw Error('AUDIT_FAILED');audits.push(event);},
  wfTransaction:async fn=>{const before=structuredClone(audits);try{return await fn(tx);}catch(e){audits=before;throw e;}}};
}
test('expired absent source is held and queue read is audited in the transaction',async()=>{
 const deps=fixture(),result=await listNativeCutReview(input,deps);
 assert.deepEqual(result.items,[{authorizationId:123,code:'EXPIRED_SOURCE_UNCONFIRMED',docuNo:null,sourceHidden:true}]);
 assert.equal(audits.length,1);assert.equal(audits[0].action,'READ');assert.equal(audits[0].userId,'4');
 assert.ok(calls.some(x=>x.includes('wf.SystemSetting WITH (UPDLOCK,HOLDLOCK)')));
});
test('durable incomplete marker is reviewed even when the original source is absent or old',async()=>{
 let deps=fixture();flags.evidence=true;flags.pending=true;
 let result=await listNativeCutReview(input,deps);
 assert.equal(result.items[0].code,'NATIVE_TRANSACTION_INCOMPLETE');assert.equal(result.items[0].docuNo,null);
 deps=fixture();flags.evidence=true;flags.pending=true;flags.source=true;flags.old=true;
 result=await listNativeCutReview(input,deps);
 assert.equal(result.items[0].code,'NATIVE_TRANSACTION_INCOMPLETE');assert.equal(result.items[0].docuNo,null);
 deps=fixture();deps.nativeCutEvidenceAvailable=async()=>{throw Object.assign(Error('evidence unavailable'),{status:503});};
 await assert.rejects(listNativeCutReview(input,deps));assert.equal(audits.length,0);
});
test('partial evidence is reviewable and an old source remains masked with transactional audit',async()=>{
 const deps=fixture();flags.evidence=true;flags.mixed=true;flags.source=true;flags.old=true;
 const result=await listNativeCutReview(input,deps);
 assert.deepEqual(result.items,[{authorizationId:123,code:'NATIVE_PARTIAL_APPLIED',docuNo:null,sourceHidden:true}]);
 assert.equal(audits.length,1);assert.equal(audits[0].action,'READ');
});
test('an interrupted edit is listed after scope checks and its review is audited without reading source details',async()=>{
 let deps=fixture();flags.editHold=true;flags.closed=true;
 const review=await recordNativeReviewHold({...input,authorizationId:123,expectedCode:'NATIVE_EDIT_INCOMPLETE',note:'รอตรวจหลักฐาน'},deps);
 assert.equal(review.code,'NATIVE_EDIT_INCOMPLETE');
 const decision=audits.find(e=>e.action==='HOLD_REVIEWED');
 assert.equal(decision.beforeJson.nativeEditPending,true);
 assert.equal(decision.beforeJson.sourceHidden,true);
 assert.equal(calls.some(text=>text.includes('FROM dbo.WFRedemtionHD')),false);
 deps=fixture();flags.editHold=true;flags.hidden=true;
 assert.deepEqual((await listNativeCutReview(input,deps)).items,[]);
 assert.equal(calls.some(text=>text.includes('FROM wf.CouponNativeEditHold')),false);
});
test('a terminal recovery stays in review with the source hidden',async()=>{
 let deps=fixture();flags.editHold=true;flags.completedEdit=true;
 const code='NATIVE_EDIT_COMPLETED_REVIEW';
 const review=await recordNativeReviewHold({...input,authorizationId:123,expectedCode:code,note:'รอตรวจยอดหลังคืน'},deps);
 assert.equal(review.code,code);
 const decision=audits.find(e=>e.action==='HOLD_REVIEWED');
 assert.equal(decision.beforeJson.nativeEditCompleted,true);
 assert.equal(decision.beforeJson.sourceHidden,true);
 assert.ok(calls.some(text=>text.includes('FROM wf.CouponNativeEditCompletion')));
 assert.equal(calls.some(text=>text.includes('FROM dbo.WFRedemtionHD')),false);
 const queue=await listNativeCutReview(input,deps);
 assert.deepEqual(queue.items[0].recovery,{restoredQty:'0.0500',settledAfter:'0.1500',openingSourceRestored:'0.0500'});
 flags.badRecovery=true;
 await assert.rejects(listNativeCutReview(input,deps),{code:'COUPON_NATIVE_REVIEW_EVIDENCE_UNAVAILABLE'});
 deps=fixture();flags.editHold=true;flags.completedEdit=true;flags.receiptDenied=true;
 await assert.rejects(listNativeCutReview(input,deps),{code:'COUPON_NATIVE_REVIEW_SCHEMA_UNAVAILABLE'});
});
test('a referenced header under a different number is held without exposing source details',async()=>{
 let deps=fixture();flags.evidence=true;flags.pending=true;flags.applied=true;flags.related=true;
 const result=await listNativeCutReview(input,deps);
 assert.equal(result.items[0].code,'NATIVE_SOURCE_REFERENCE_MISMATCH');assert.equal(result.items[0].docuNo,null);
 const query=calls.find(x=>x.includes('AS RelatedSource'));assert.ok(query);
 assert.doesNotMatch(query,/DocuNo|DocuDate/);
 deps=fixture();flags.evidence=true;flags.pending=true;flags.applied=true;
 assert.equal((await listNativeCutReview(input,deps)).items[0].code,'LINKED_SOURCE_MISSING');
});
test('closed authorizations remain reviewable and discovery changes fail closed',async()=>{
 let deps=fixture();flags.closed=true;
 const result=await listNativeCutReview(input,deps);
 assert.equal(result.items[0].code,'CLOSED_SOURCE_UNCONFIRMED');
 assert.ok(calls.some(x=>x.includes("'CANCELLED','EXPIRED'")));
 const coupon=calls.findIndex(x=>x.includes('FROM dbo.WFCoupon WITH'));
 const reservation=calls.findIndex(x=>x.includes('FROM wf.CouponReservation WITH'));
 const auth=calls.findIndex(x=>x.includes('FROM wf.CouponNativeCutAuthorization WITH (UPDLOCK'));
 assert.ok(coupon>=0&&coupon<reservation&&reservation<auth);
 deps=fixture();flags.changed=true;
 await assert.rejects(listNativeCutReview(input,deps),{code:'COUPON_NATIVE_REVIEW_DISCOVERY_CHANGED'});
 assert.equal(audits.length,0);
});
test('actual audit writer records effective and Access As actor IDs',async()=>{
 const deps=fixture();delete deps.currentActorId;delete deps.logChangeEvent;
 const {runWithUser}=require('../services/request-context');
 await runWithUser(actor,()=>listNativeCutReview(input,deps));
 assert.equal(audits.length,1);assert.equal(audits[0].userId,'4');assert.equal(audits[0].actorUserId,'9');
});
test('old or mismatched source details stay hidden; verified current lines can identify the document',async()=>{
 let deps=fixture();flags.source=true;flags.old=true;
 let result=await listNativeCutReview(input,deps);assert.equal(result.items[0].code,'SOURCE_DATE_OUTSIDE_WINDOW');assert.equal(result.items[0].docuNo,null);
 deps=fixture();flags.source=true;flags.mismatch=true;
 result=await listNativeCutReview(input,deps);assert.equal(result.items[0].code,'NATIVE_LINES_CHANGED');assert.equal(result.items[0].docuNo,null);
 deps=fixture();flags.source=true;
 result=await listNativeCutReview(input,deps);assert.equal(result.items[0].code,'SETTLEMENT_LINK_INCOMPLETE');assert.equal(result.items[0].docuNo,'QA-116');
});
test('scope and both identities are checked, and failures cannot return unaudited results',async()=>{
 let deps=fixture();flags.hidden=true;
 const result=await listNativeCutReview(input,deps);assert.deepEqual(result.items,[]);assert.equal(calls.some(x=>x.includes('FROM dbo.WFRedemtionHD')),false);
 for(const flag of ['secondary','missingEvidence','auditFailure']){deps=fixture();flags[flag]=true;await assert.rejects(listNativeCutReview(input,deps));assert.equal(audits.length,0);}
 deps=fixture();flags.window='2027-01-01';await assert.rejects(listNativeCutReview(input,deps),{code:'COUPON_NATIVE_REVIEW_WINDOW_CHANGED'});
 deps=fixture();await assert.rejects(listNativeCutReview({...input,actor:{...actor,actorRole:'SALES'}},deps),{code:'COUPON_NATIVE_REVIEW_FORBIDDEN'});
 deps=fixture();deps.currentActorId=()=>99;await assert.rejects(listNativeCutReview(input,deps),{code:'COUPON_NATIVE_REVIEW_IDENTITY_INVALID'});
});

test('reviewer can record a hold decision atomically without changing source or balances',async()=>{
 const deps=fixture();flags.evidence=true;flags.pending=true;
 const result=await recordNativeReviewHold({...input,authorizationId:123,expectedCode:'NATIVE_TRANSACTION_INCOMPLETE',note:'รอตรวจหลักฐาน'},deps);
 assert.deepEqual(result,{authorizationId:123,code:'NATIVE_TRANSACTION_INCOMPLETE',hold:'UNCHANGED'});
 assert.equal(audits.length,2);
 assert.equal(audits[0].action,'HOLD_REVIEWED');assert.equal(audits[0].entityId,'123');
 assert.deepEqual(audits[0].beforeJson,{code:'NATIVE_TRANSACTION_INCOMPLETE',sourceHidden:true,
  authorizationState:'ACTIVE',authorizedLines:1,sourceCountUpToTwo:0,settlementCountUpTo101:0,
  preparedEvidence:1,appliedEvidence:0,evidenceCountUpTo101:1,nativeAuditObserved:false,businessDate:'2026-01-01'});
 assert.deepEqual(audits[0].afterJson,{code:'NATIVE_TRANSACTION_INCOMPLETE',hold:'UNCHANGED'});
 assert.equal(audits[0].reasonText,'รอตรวจหลักฐาน');assert.equal(audits[0].userId,'4');
 assert.equal(audits[1].action,'READ');
 assert.ok(calls.every(x=>!/^\s*(UPDATE|DELETE|INSERT)\b/i.test(x)));
});
test('audit snapshot excludes old source details while retaining evidence counts',async()=>{
 const deps=fixture();flags.evidence=true;flags.mixed=true;flags.source=true;flags.old=true;flags.auditEvidence=true;
 await recordNativeReviewHold({...input,authorizationId:123,expectedCode:'NATIVE_PARTIAL_APPLIED',note:'รอตรวจหลักฐาน'},deps);
 const snapshot=audits[0].beforeJson;
 assert.equal(snapshot.preparedEvidence,1);assert.equal(snapshot.appliedEvidence,1);assert.equal(snapshot.sourceCountUpToTwo,1);
 assert.equal(snapshot.nativeAuditObserved,true);assert.equal(snapshot.sourceHidden,true);
 assert.doesNotMatch(JSON.stringify(snapshot),/QA-116|2025-12-31/);
});
test('hold review rejects stale, inaccessible, secondary and invalid requests without audit',async()=>{
 const request={...input,authorizationId:123,expectedCode:'NATIVE_TRANSACTION_INCOMPLETE',note:'รอตรวจหลักฐาน'};
 let deps=fixture();flags.evidence=true;flags.pending=true;
 await assert.rejects(recordNativeReviewHold({...request,expectedCode:'NATIVE_LINES_CHANGED'},deps),{code:'COUPON_NATIVE_REVIEW_CHANGED'});
 assert.equal(audits.length,0);
 deps=fixture();flags.hidden=true;
 await assert.rejects(recordNativeReviewHold(request,deps),{code:'COUPON_NATIVE_REVIEW_NOT_FOUND'});assert.equal(audits.length,0);
 deps=fixture();flags.secondary=true;
 await assert.rejects(recordNativeReviewHold(request,deps));assert.equal(audits.length,0);
 deps=fixture();flags.evidence=true;flags.pending=true;flags.auditFailure=true;
 await assert.rejects(recordNativeReviewHold(request,deps));assert.equal(audits.length,0);
 for(const note of ['x','abcde\n', 'a'.repeat(301)]){
  deps=fixture();await assert.rejects(recordNativeReviewHold({...request,note},deps),{code:'COUPON_NATIVE_REVIEW_HOLD_INVALID'});assert.equal(audits.length,0);
 }
});
test('hold decision and queue audit roll back together if the second audit fails',async()=>{
 const deps=fixture();flags.evidence=true;flags.pending=true;
 const original=deps.logChangeEvent;
 deps.logChangeEvent=async(tx,event)=>{if(event.action==='READ')throw Error('AUDIT_FAILED');return original(tx,event);};
 await assert.rejects(recordNativeReviewHold({...input,authorizationId:123,expectedCode:'NATIVE_TRANSACTION_INCOMPLETE',note:'รอตรวจหลักฐาน'},deps));
 assert.equal(audits.length,0);
});
test('hold decision audit preserves the actual actor and effective user',async()=>{
 const deps=fixture();flags.evidence=true;flags.pending=true;delete deps.currentActorId;delete deps.logChangeEvent;
 const {runWithUser}=require('../services/request-context');
 await runWithUser(actor,()=>recordNativeReviewHold({...input,authorizationId:123,expectedCode:'NATIVE_TRANSACTION_INCOMPLETE',note:'รอตรวจหลักฐาน'},deps));
 assert.equal(audits.length,2);assert.equal(audits[0].userId,'4');assert.equal(audits[0].actorUserId,'9');
});
test('hold audit permits only the explicitly configured on-prem primary database',async()=>{
 const tx=name=>({request:()=>({query:async()=>({recordset:[{DatabaseName:name}]})})});
 const db=(target,selected)=>({DEFAULT_TARGET:target,getTarget:()=>selected});
 await assertNativeHoldPrimary(tx('fz8'),db('onprem','onprem'),'fz8');
 for(const [target,selected,actual,primary] of [['onprem','onprem','fz9','fz8'],['onprem','remote_b','fz8','fz8'],['local','local','fz8','fz8'],['onprem','onprem','fz8','']])
  await assert.rejects(assertNativeHoldPrimary(tx(actual),db(target,selected),primary),{code:'COUPON_NATIVE_REVIEW_PRIMARY_REQUIRED'});
});
