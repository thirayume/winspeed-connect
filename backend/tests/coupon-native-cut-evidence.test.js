'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {nativeCutEvidenceAvailable}=require('../services/coupon-native-cut-evidence');
const {classifyNativeAuthorizationEvidence}=require('../services/coupon-native-review-classifier');
const state={EvidenceSchemaState:'NATIVE_CUT_EVIDENCE_SCHEMA_V1',Ledger223:0,EvidenceVisible:0,SchemaSelect:1,EvidenceSelect:null};
const q=row=>async()=>({recordset:[row]});
test('evidence schema is verified against the selected DB ledger and permissions',async()=>{
 assert.equal(await nativeCutEvidenceAvailable(q(state)),false);
 assert.equal(await nativeCutEvidenceAvailable(q({...state,Ledger223:1,EvidenceVisible:1,EvidenceSelect:1})),true);
 for(const row of [{...state,Ledger223:1},{...state,EvidenceVisible:1},{...state,SchemaSelect:0},
  {...state,Ledger223:1,EvidenceVisible:1,EvidenceSelect:0},
  {...state,Ledger223:null},{...state,EvidenceVisible:null},{...state,Ledger223:''},
  {...state,Ledger223:undefined},{...state,Ledger223:false},null])
  await assert.rejects(nativeCutEvidenceAvailable(q(row)),{code:'COUPON_NATIVE_EVIDENCE_SCHEMA_UNAVAILABLE'});
 await assert.rejects(nativeCutEvidenceAvailable(async()=>{throw Error('driver');}),{code:'COUPON_NATIVE_EVIDENCE_SCHEMA_UNAVAILABLE'});
});
test('a pending marker is held even after native source deletion, and applied evidence alone is not atomic proof',()=>{
 const input={authorization:{DocuNo:'QA',State:'ACTIVE',ExpiresAt:'2026-11-17T00:00:00Z'},
  lines:[{ReservationId:1,CouponId:2,AuthorizedQty:0.1}],documents:[],settlements:[],auditObserved:false,
  window:{businessDate:'2026-01-01'},now:'2026-11-16T00:00:00Z'};
 assert.equal(classifyNativeAuthorizationEvidence({...input,evidence:[{EvidenceState:'PREPARED',NativeRedemptionId:5}]}).code,'NATIVE_TRANSACTION_INCOMPLETE');
 assert.equal(classifyNativeAuthorizationEvidence({...input,evidence:[{EvidenceState:'APPLIED',NativeRedemptionId:5}]}).code,'LINKED_SOURCE_MISSING');
 const document={RedemtionID:5,DocuNo:'QA',DocuType:116,DocuStatus:'N',DocuDate:'2026-11-16',lines:[{CouponID:2,GoodQty:0.1}]};
 const settlement={ReservationId:1,CouponId:2,NativeRedemptionId:5,NativeDocuNo:'QA',SettledQty:0.1};
 assert.equal(classifyNativeAuthorizationEvidence({...input,documents:[document],settlements:[settlement],
  evidence:[{EvidenceState:'APPLIED',NativeRedemptionId:6}]}).code,'NATIVE_EVIDENCE_INCONSISTENT');
 assert.equal(classifyNativeAuthorizationEvidence({...input,documents:[document],settlements:[settlement],
  evidence:[{EvidenceState:'APPLIED',NativeRedemptionId:5}]}).code,'LINKED_REQUIRES_TRANSACTION_EVIDENCE');
});
