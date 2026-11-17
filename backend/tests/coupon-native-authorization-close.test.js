'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
h.installDbStub(()=>[]);
const {closeNativeCutAuthorization}=require('../services/coupon-native-authorization');
const actor={sub:4,actorSub:9,role:'MANAGER',actorRole:'ADMIN',isImpersonating:true};
const input={actor,authorizationId:123,reason:'review authorization release',mode:'cancel'};
let state,flags,calls;
function fixture(){
 state={status:'ACTIVE',registry:true,audits:[],reservation:0.2};flags={};calls=[];
 const tx={request(){const v={};return {input(k,t,x){v[k]=x;return this;},async query(text){
  calls.push(text);
  if(text.includes('FROM wf.CouponNativeCutAuthorizationLine'))return {recordset:flags.noLines?[]:[{CouponId:41,ReservationId:11},{CouponId:flags.changed&&text.includes('UPDLOCK')?43:42,ReservationId:12}]};
  if(text.includes('SELECT CouponID FROM dbo.WFCoupon'))return {recordset:[{CouponID:v.cid}]};
  if(text.includes('SELECT Id FROM wf.CouponReservation'))return {recordset:[{Id:v.rid}]};
  if(text.includes('SELECT DocuNo,State'))return {recordset:[{DocuNo:'QA-116',State:state.status,IsExpired:flags.expired?1:0}]};
  if(text.includes('FROM wf.CouponNativeCutEvidence'))return {recordset:flags.pending?[{Found:1}]:[]};
  if(text.includes('FROM dbo.WFRedemtionHD'))return {recordset:flags.source?[{Found:1}]:[]};
  if(text.includes('FROM dbo.SMAudit')){if(flags.auditReadError)throw Error('audit unavailable');return {recordset:flags.nativeAudit?[{Found:1}]:[]};}
  if(text.includes('DELETE FROM wf.CouponNativeActiveDocument')){if(!state.registry)return {rowsAffected:[0]};state.registry=false;return {rowsAffected:[1]};}
  if(text.includes('UPDATE wf.CouponNativeCutAuthorization')){state.status=v.state;return {rowsAffected:[1]};}
  throw Error('unexpected SQL');
 }};}};
 return {currentActorId:()=>9,hasColumn:async()=>true,assertPrimaryDatabase:async()=>{if(flags.secondary)throw Object.assign(Error('secondary'),{status:403});},
  couponVisible:async()=>!flags.scope,reservationsVisible:async()=>!flags.scope,nativeCutEvidenceAvailable:async()=>Boolean(flags.evidence),
  logChangeEvent:async(actual,event)=>{assert.equal(actual,tx);if(flags.audit)throw Error('AUDIT_FAILED');state.audits.push(event);},
  wfTransaction:async fn=>{const before=structuredClone(state);try{return await fn(tx);}catch(e){state=before;throw e;}}};
}
test('cancel releases the document authorization once without touching reservations',async()=>{
 const deps=fixture(),first=await closeNativeCutAuthorization(input,deps);
 assert.deepEqual(first,{id:123,status:'CANCELLED',idempotent:false});assert.equal(state.reservation,0.2);assert.equal(state.registry,false);assert.equal(state.audits.length,1);
 const again=await closeNativeCutAuthorization(input,deps);assert.equal(again.idempotent,true);assert.equal(state.audits.length,1);
 assert.equal(calls.some(t=>/UPDATE wf\.CouponReservation/.test(t)),false);
});
test('durable evidence prevents cancel or expire, including an idempotent close retry',async()=>{
 for(const mode of ['cancel','expire']){
  const deps=fixture();flags.evidence=true;flags.pending=true;flags.expired=true;
  await assert.rejects(closeNativeCutAuthorization({...input,mode},deps),{code:'COUPON_NATIVE_AUTH_SOURCE_REVIEW_REQUIRED'});
  assert.equal(state.status,'ACTIVE');assert.equal(state.registry,true);assert.equal(state.audits.length,0);
 }
 const deps=fixture();state.status='CANCELLED';flags.evidence=true;flags.pending=true;
 await assert.rejects(closeNativeCutAuthorization(input,deps),{code:'COUPON_NATIVE_AUTH_SOURCE_REVIEW_REQUIRED'});
});
test('expire requires server-confirmed expiration and records the transition',async()=>{
 const deps=fixture();await assert.rejects(closeNativeCutAuthorization({...input,mode:'expire'},deps),{code:'COUPON_NATIVE_AUTH_NOT_EXPIRED'});
 flags.expired=true;const result=await closeNativeCutAuthorization({...input,mode:'expire'},deps);assert.equal(result.status,'EXPIRED');assert.equal(state.audits[0].action,'EXPIRED');
});
test('native document, changed lines, missing registry and audit failures retain authorization',async()=>{
 for(const flag of ['source','nativeAudit','auditReadError','changed','scope','secondary','audit','noLines']){
  const deps=fixture();flags[flag]=true;await assert.rejects(closeNativeCutAuthorization(input,deps));assert.deepEqual(state,{status:'ACTIVE',registry:true,audits:[],reservation:0.2});
 }
 const deps=fixture();state.registry=false;await assert.rejects(closeNativeCutAuthorization(input,deps),{code:'COUPON_NATIVE_AUTH_CHANGED'});assert.equal(state.status,'ACTIVE');
});
test('a deleted or attempted document and unavailable native evidence hold the authorization',async()=>{
 let deps=fixture();flags.nativeAudit=true;
 await assert.rejects(closeNativeCutAuthorization(input,deps),{code:'COUPON_NATIVE_AUTH_SOURCE_REVIEW_REQUIRED'});
 const query=calls.find(t=>t.includes('FROM dbo.SMAudit'));assert.ok(query);assert.doesNotMatch(query,/globalStartDate|audit_date/i);
 assert.equal(state.status,'ACTIVE');assert.equal(state.registry,true);assert.equal(state.reservation,0.2);
 deps=fixture();flags.auditReadError=true;
 await assert.rejects(closeNativeCutAuthorization({...input,mode:'expire'},deps),{code:'COUPON_NATIVE_AUTH_NOT_EXPIRED'});
 flags.expired=true;
 await assert.rejects(closeNativeCutAuthorization({...input,mode:'expire'},deps),{code:'COUPON_NATIVE_AUTH_EVIDENCE_UNAVAILABLE'});
 assert.equal(state.status,'ACTIVE');assert.equal(state.registry,true);
});
test('used authorization and unprivileged actor are never released',async()=>{
 const deps=fixture();state.status='USED';await assert.rejects(closeNativeCutAuthorization(input,deps),{code:'COUPON_NATIVE_AUTH_ALREADY_CLOSED'});
 const deps2=fixture();await assert.rejects(closeNativeCutAuthorization({...input,actor:{sub:4,role:'SALES'}},deps2),e=>e.status===403);assert.equal(state.registry,true);
});
