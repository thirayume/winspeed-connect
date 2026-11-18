'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyNativeAuthorizationEvidence:classify}=require('../services/coupon-native-review-classifier');
function fixture(){return {authorization:{State:'ACTIVE',DocuNo:'QA-116',ExpiresAt:'2026-11-16T10:00:00Z'},
 lines:[{ReservationId:1,CouponId:10,AuthorizedQty:0.2},{ReservationId:2,CouponId:20,AuthorizedQty:0.1}],
 documents:[],settlements:[],auditObserved:false,window:{businessDate:'2026-01-01'},now:'2026-11-16T09:00:00Z'};}
function doc(){return {RedemtionID:100,DocuNo:'QA-116',DocuType:116,DocuDate:'2026-11-16',DocuStatus:'N',lines:[{CouponID:10,GoodQty:0.2},{CouponID:20,GoodQty:0.1}]};}
test('an absent or deleted source is never released merely because audit is absent',()=>{
 let f=fixture();assert.deepEqual(classify(f),{code:'AWAITING_SOURCE',requiresReview:false});
 f.now='2026-11-16T10:00:00Z';assert.equal(classify(f).code,'EXPIRED_SOURCE_UNCONFIRMED');
 f.auditObserved=true;assert.equal(classify(f).code,'NATIVE_ATTEMPT_OR_DELETED');
 f.settlements=[{ReservationId:1}];assert.equal(classify(f).code,'LINKED_SOURCE_MISSING');
 f.relatedSourceFound=true;assert.equal(classify(f).code,'NATIVE_SOURCE_REFERENCE_MISMATCH');
 f=fixture();f.authorization.State='CANCELLED';assert.equal(classify(f).code,'CLOSED_SOURCE_UNCONFIRMED');
});
test('incomplete, duplicate, changed, old and unknown-status sources go to review',()=>{
 let f=fixture();f.documents=[doc(),doc()];assert.equal(classify(f).code,'NATIVE_DOCUMENT_AMBIGUOUS');
 f=fixture();f.documents=[{...doc(),lines:[doc().lines[0]]}];assert.equal(classify(f).code,'NATIVE_LINES_INCOMPLETE_OR_AMBIGUOUS');
 f=fixture();f.documents=[{...doc(),lines:[doc().lines[0],doc().lines[0]]}];assert.equal(classify(f).code,'NATIVE_LINES_INCOMPLETE_OR_AMBIGUOUS');
 f=fixture();f.documents=[{...doc(),lines:[{CouponID:10,GoodQty:0.19},doc().lines[1]]}];assert.equal(classify(f).code,'NATIVE_LINES_CHANGED');
 f=fixture();f.documents=[{...doc(),DocuDate:'2025-12-31'}];assert.equal(classify(f).code,'SOURCE_DATE_OUTSIDE_WINDOW');
 f=fixture();f.documents=[{...doc(),DocuStatus:'P'}];assert.equal(classify(f).code,'SOURCE_STATUS_UNVERIFIED');
 f=fixture();f.documents=[{...doc(),DocuNo:'CHANGED'}];assert.equal(classify(f).code,'NATIVE_DOCUMENT_NUMBER_CHANGED');
});
test('even exact linked rows require transaction evidence and malformed data fails closed',()=>{
 const f=fixture();f.documents=[doc()];
 assert.equal(classify(f).code,'SETTLEMENT_LINK_INCOMPLETE');
 f.settlements=[{ReservationId:1,CouponId:10,NativeRedemptionId:100,NativeDocuNo:'QA-116',SettledQty:0.2},{ReservationId:2,CouponId:20,NativeRedemptionId:100,NativeDocuNo:'QA-116',SettledQty:0.1}];
 assert.deepEqual(classify(f),{code:'LINKED_REQUIRES_TRANSACTION_EVIDENCE',requiresReview:true});
 f.settlements[1].SettledQty=0.09;assert.equal(classify(f).code,'SETTLEMENT_LINK_INCONSISTENT');
 f.lines[1].CouponId=10;assert.equal(classify(f).code,'AUTHORIZATION_LINES_INVALID');
 f.window.businessDate='invalid';assert.equal(classify(f).code,'EVIDENCE_UNAVAILABLE');
});
test('mixed applied and prepared evidence remains held as a partial document',()=>{
 const f=fixture();f.evidence=[{EvidenceState:'APPLIED',NativeRedemptionId:100},{EvidenceState:'PREPARED',NativeRedemptionId:100}];
 assert.deepEqual(classify(f),{code:'NATIVE_PARTIAL_APPLIED',requiresReview:true});
 f.documents=[{...doc(),DocuDate:'2025-12-31'}];
 assert.deepEqual(classify(f),{code:'NATIVE_PARTIAL_APPLIED',requiresReview:true});
 f.evidence[1].NativeRedemptionId=101;
 assert.equal(classify(f).code,'NATIVE_EVIDENCE_INCONSISTENT');
 f.evidence=[{EvidenceState:'PREPARED',NativeRedemptionId:100}];
 assert.equal(classify(f).code,'NATIVE_TRANSACTION_INCOMPLETE');
});
