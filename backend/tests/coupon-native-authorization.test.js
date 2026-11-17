'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const db=h.installDbStub(({text})=>/COL_LENGTH\('wf\.ChangeEvent'/.test(text)?[{HasCol:1}]:[]);
const {createNativeCutAuthorization}=require('../services/coupon-native-authorization');
let state,calls,flags,expiryChecks;
const actor={sub:4,actorSub:9,role:'MANAGER',actorRole:'ADMIN',isImpersonating:true};
const payload={actor,docuNo:'QA-116',expiresAt:'2099-01-01T00:00:00Z',reason:'verified authorization evidence',dataWindow:{businessDate:'2026-01-01'},items:[{couponId:42,reservationId:12,qty:0.1},{couponId:41,reservationId:11,qty:0.2}]};
function fixture(){
 state={headers:[],docs:[],lines:[],audits:[]};calls=[];flags={};expiryChecks=[];
 const tx={request(){const args={};return {input(k,t,v){args[k]=v;return this;},async query(text){
  calls.push({text,args:{...args}});
  const legacyRecovery=require('./helpers/native-hold-legacy.cjs')(text);
  if(text.includes('COUPON_RECOVERY_READINESS_V1'))return legacyRecovery;
  if(text.includes('NATIVE_HOLD_SCHEMA_V1'))return {recordset:[{NativeHoldSchemaState:'NATIVE_HOLD_SCHEMA_V1',Ledger220:1,HeaderVisible:1,LineVisible:1,HeaderSelect:1,LineSelect:1,SchemaSelect:1}]};
  if(text.includes('NATIVE_CUT_EVIDENCE_SCHEMA_V1'))return {recordset:[{EvidenceSchemaState:'NATIVE_CUT_EVIDENCE_SCHEMA_V1',Ledger223:1,EvidenceVisible:1,EvidenceSelect:flags.evidenceUnavailable?0:1,SchemaSelect:1}]};
  if(text.includes('AS ActiveNativeAuthorization'))return {recordset:flags.closedEvidence&&args.rid===11?[{ActiveNativeAuthorization:1}]:[]};
  if(text.includes('FROM wf.SystemSetting'))return {recordset:[{SettingValue:flags.window||'2026-01-01'}]};
  if(text.includes('SELECT CouponID FROM dbo.WFCoupon'))return {recordset:[{CouponID:args.cid}]};
  if(text.includes('SELECT Id FROM wf.CouponReservation'))return {recordset:flags.stale?[]:[{Id:args.rid}]};
  if(text.includes('FROM dbo.WFRedemtionHD'))return {recordset:flags.document?[{Found:1}]:[]};
  if(text.includes('FROM dbo.SMAudit')){if(flags.auditReadError)throw Error('audit unavailable');return {recordset:flags.nativeAudit?[{Found:1}]:[]};}
  if(text.includes('FROM wf.CouponNativeActiveDocument'))return {recordset:flags.docActive?[{Found:1}]:[]};
  if(text.includes('FROM wf.CouponNativeCutAuthorizationLine'))return {recordset:flags.reservationActive?[{Found:1}]:[]};
  if(text.includes('INSERT wf.CouponNativeCutAuthorization(')){state.headers.push({...args});return {recordset:[{Id:123}]};}
  if(text.includes('INSERT wf.CouponNativeActiveDocument')){state.docs.push({...args});return {recordset:[]};}
  if(text.includes('INSERT wf.CouponNativeCutAuthorizationLine')){state.lines.push({...args});return {recordset:[]};}
  if(text.includes('INSERT INTO wf.ChangeEvent')){if(flags.auditFailed)throw Error('AUDIT_FAILED');state.audits.push({...args});return {recordset:[]};}
  throw Error('unexpected SQL');
 }};}};
 const deps={currentActorId:()=>9,hasColumn:async()=>true,assertPrimaryDatabase:async()=>{if(flags.secondary)throw Object.assign(Error('secondary'),{status:403});},
  assertNativeBridgeReady:async actual=>{assert.equal(actual,tx);},
  couponVisible:async()=>!flags.scopeDenied,reservationsVisible:async()=>!flags.scopeDenied,
  assertNoActiveAuthorization:async(actual,rid)=>{assert.equal(actual,tx);if(flags.closedEvidence&&rid===11)throw Object.assign(Error('held'),{code:'COUPON_NATIVE_AUTH_RESERVATION_HELD'});},
  couponService:{checkTicketUseExpiry:async(actual,cid,ctx)=>{assert.equal(actual,tx);if(flags.expiryInvalid)throw Object.assign(Error('COUPON_EXPIRY_INVALID'),{code:'COUPON_EXPIRY_INVALID'});expiryChecks.push({cid,...ctx});return flags.expired?{expired:true,warning:'expired'}:null;},assertCouponReservationCoverage:async()=>{}},
  logChangeEvent:async(actual,event)=>{assert.equal(actual,tx);if(flags.auditFailed)throw Error('AUDIT_FAILED');state.audits.push(event);},
  wfTransaction:async fn=>{const before=structuredClone(state);try{return await fn(tx);}catch(e){state=before;throw e;}}};
 return deps;
}
test('authorization records both identities and all lines with one audit in one transaction',async()=>{
 const deps=fixture(),result=await createNativeCutAuthorization(payload,deps);
 assert.equal(result.id,123);assert.equal(result.lineCount,2);assert.equal(state.headers[0].effective,4);assert.equal(state.headers[0].actor,9);
 assert.deepEqual(state.lines.map(x=>x.cid),[41,42]);assert.equal(state.audits.length,1);assert.equal(state.audits[0].userId,'4');
 assert.equal(calls.filter(x=>x.text.includes('SELECT CouponID FROM dbo.WFCoupon')).every(x=>/UPDLOCK,HOLDLOCK/.test(x.text)),true);
});
test('issuance is unavailable until a completed native bridge replaces the gate',async()=>{
 const deps=fixture();delete deps.assertNativeBridgeReady;
 await assert.rejects(createNativeCutAuthorization(payload,deps),{code:'COUPON_NATIVE_BRIDGE_UNAVAILABLE',status:503});
 assert.deepEqual(state,{headers:[],docs:[],lines:[],audits:[]});
 assert.equal(calls.length,0);
});
test('shared audit writer preserves distinct Access As identities in the same transaction',async()=>{
 const deps=fixture();delete deps.currentActorId;delete deps.logChangeEvent;
 const {runWithUser}=require('../services/request-context');
 await runWithUser(actor,()=>createNativeCutAuthorization(payload,deps));
 assert.equal(state.audits.length,1);assert.equal(state.audits[0].userId,'4');assert.equal(state.audits[0].actorUserId,'9');
});
test('scope, prior use, cutoff and audit failures leave no authorization',async()=>{
 for(const flag of ['secondary','stale','scopeDenied','document','nativeAudit','auditReadError','docActive','reservationActive','expiryInvalid','auditFailed']){
  const deps=fixture();flags[flag]=true;await assert.rejects(createNativeCutAuthorization(payload,deps));assert.deepEqual(state,{headers:[],docs:[],lines:[],audits:[]});
 }
 const deps=fixture();flags.window='2027-01-01';await assert.rejects(createNativeCutAuthorization(payload,deps),{code:'COUPON_NATIVE_AUTH_WINDOW_CHANGED'});
});
test('native audit evidence and missing evidence are held without applying the business cutoff',async()=>{
 let deps=fixture();flags.nativeAudit=true;
 await assert.rejects(createNativeCutAuthorization(payload,deps),{code:'COUPON_NATIVE_AUTH_SOURCE_REVIEW_REQUIRED'});
 const query=calls.find(x=>x.text.includes('FROM dbo.SMAudit'));assert.ok(query);assert.doesNotMatch(query.text,/globalStartDate|audit_date/i);
 assert.deepEqual(state,{headers:[],docs:[],lines:[],audits:[]});
 deps=fixture();flags.auditReadError=true;
 await assert.rejects(createNativeCutAuthorization(payload,deps),{code:'COUPON_NATIVE_AUTH_EVIDENCE_UNAVAILABLE'});
 assert.deepEqual(state,{headers:[],docs:[],lines:[],audits:[]});
});
test('closed authorization with durable evidence cannot authorize its reservation again',async()=>{
 const deps=fixture();delete deps.assertNoActiveAuthorization;flags.closedEvidence=true;
 await assert.rejects(createNativeCutAuthorization(payload,deps),{code:'COUPON_NATIVE_AUTH_RESERVATION_HELD'});
 assert.deepEqual(state,{headers:[],docs:[],lines:[],audits:[]});
 assert.ok(calls.some(x=>x.text.includes('AS ActiveNativeAuthorization')&&x.text.includes('wf.CouponNativeCutEvidence')));
});
test('authorization fails closed when evidence schema cannot be read',async()=>{
 const deps=fixture();delete deps.assertNoActiveAuthorization;flags.evidenceUnavailable=true;
 await assert.rejects(createNativeCutAuthorization(payload,deps),{code:'COUPON_NATIVE_EVIDENCE_SCHEMA_UNAVAILABLE'});
 assert.deepEqual(state,{headers:[],docs:[],lines:[],audits:[]});
});
test('authorization can proceed when migrated evidence is clear',async()=>{
 const deps=fixture();delete deps.assertNoActiveAuthorization;
 const result=await createNativeCutAuthorization(payload,deps);
 assert.equal(result.lineCount,2);assert.equal(state.audits.length,1);
 assert.equal(calls.filter(x=>x.text.includes('NATIVE_HOLD_SCHEMA_V1')).length,1);
 assert.equal(calls.filter(x=>x.text.includes('NATIVE_CUT_EVIDENCE_SCHEMA_V1')).length,1);
});
test('identity, actor permissions, duplicate entries and unsafe quantities fail closed',async()=>{
 for(const invalid of [{...payload,actor:{sub:4,actorSub:9,role:'MANAGER',actorRole:'SALES',isImpersonating:true}},
   {...payload,actor:{...actor,actorSub:4}}, {...payload,items:[payload.items[0],payload.items[0]]},
   {...payload,items:[{couponId:42,reservationId:12,qty:0.00001}]}, {...payload,docuNo:'QA\n116'}]){
  const deps=fixture();await assert.rejects(createNativeCutAuthorization(invalid,deps));assert.deepEqual(state,{headers:[],docs:[],lines:[],audits:[]});
 }
 const deps=fixture();deps.hasColumn=async()=>false;await assert.rejects(createNativeCutAuthorization(payload,deps),{code:'COUPON_NATIVE_AUTH_AUDIT_UNAVAILABLE'});
});
test('an expired ticket is still authorized; each line is checked with its reservation for the incident record',async()=>{
 const deps=fixture();flags.expired=true;const result=await createNativeCutAuthorization(payload,deps);
 assert.equal(result.lineCount,2);assert.deepEqual(expiryChecks.map(x=>[x.cid,x.reservationId]).sort(),[[41,11],[42,12]]);
 assert.ok(expiryChecks.every(x=>/116/.test(x.stage)));
});
