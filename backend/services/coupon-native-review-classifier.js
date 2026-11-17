'use strict';

// Pure classification only: the caller must read a consistent DB snapshot,
// enforce both identities' scopes/capabilities, cutoff and audit before using
// this result. No outcome authorizes a cut or releases a reservation.
const {isValidStartDate}=require('./data-window');
function integer(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0&&n<=2147483647?n:null;}
function quantity(value){
 if(value==null||value==='')return null;
 const n=Number(value),u=Math.round(n*10000);
 return Number.isFinite(n)&&n>0&&Number.isSafeInteger(u)&&u<=999999999999&&u/10000===n?u:null;
}
function review(code){return {code,requiresReview:true};}

function classifyNativeAuthorizationEvidence({authorization,lines,documents,settlements,evidence=[],relatedSourceFound=false,auditObserved,window,now}) {
 if(!authorization||!Array.isArray(lines)||!Array.isArray(documents)||!Array.isArray(settlements)||
    !Array.isArray(evidence)||
    typeof auditObserved!=='boolean'||typeof relatedSourceFound!=='boolean'||!isValidStartDate(window?.businessDate)||
    now==null||now===''||authorization.ExpiresAt==null||authorization.ExpiresAt===''||
    !Number.isFinite(new Date(now).getTime())||!Number.isFinite(new Date(authorization.ExpiresAt).getTime())||
    !['ACTIVE','USED','CANCELLED','EXPIRED'].includes(authorization.State))return review('EVIDENCE_UNAVAILABLE');
 const number=typeof authorization.DocuNo==='string'?authorization.DocuNo.trim():'';
 if(!number||number.length>25)return review('AUTHORIZATION_DOCUMENT_INVALID');
 const expected=lines.map(x=>({reservationId:integer(x.ReservationId),couponId:integer(x.CouponId),units:quantity(x.AuthorizedQty)}));
 if(!expected.length||expected.length>100||expected.some(x=>!x.reservationId||!x.couponId||!x.units)||
    new Set(expected.map(x=>x.reservationId)).size!==expected.length||new Set(expected.map(x=>x.couponId)).size!==expected.length)
  return review('AUTHORIZATION_LINES_INVALID');
 if(evidence.length>expected.length||evidence.some(x=>!['PREPARED','APPLIED'].includes(x.EvidenceState)||!integer(x.NativeRedemptionId))||
    new Set(evidence.map(x=>integer(x.NativeRedemptionId))).size>1)
  return review('NATIVE_EVIDENCE_INCONSISTENT');
 // A committed PREPARED marker is durable evidence that processing started;
 // it cannot prove a balance change or permit a release, even if the native
 // header is missing, changed, old, or its authorization has been closed.
 if(evidence.some(x=>x.EvidenceState==='PREPARED')){
  if(evidence.some(x=>x.EvidenceState==='APPLIED'))return review('NATIVE_PARTIAL_APPLIED');
  return review('NATIVE_TRANSACTION_INCOMPLETE');
 }
 if(documents.length>1)return review('NATIVE_DOCUMENT_AMBIGUOUS');
 if(documents.length===0){
  if(relatedSourceFound&&(settlements.length||evidence.length))return review('NATIVE_SOURCE_REFERENCE_MISMATCH');
  if(settlements.length||evidence.length)return review('LINKED_SOURCE_MISSING');
  if(auditObserved)return review('NATIVE_ATTEMPT_OR_DELETED');
  if(authorization.State!=='ACTIVE')return review('CLOSED_SOURCE_UNCONFIRMED');
  if(new Date(authorization.ExpiresAt).getTime()<=new Date(now).getTime())return review('EXPIRED_SOURCE_UNCONFIRMED');
  return {code:'AWAITING_SOURCE',requiresReview:false};
 }
 const doc=documents[0],docId=integer(doc.RedemtionID);
 if(!docId||Number(doc.DocuType)!==116||!Array.isArray(doc.lines))return review('NATIVE_DOCUMENT_INVALID');
 if(evidence.some(x=>integer(x.NativeRedemptionId)!==docId))return review('NATIVE_EVIDENCE_INCONSISTENT');
 if(typeof doc.DocuNo!=='string'||doc.DocuNo.trim()!==number)return review('NATIVE_DOCUMENT_NUMBER_CHANGED');
 if(authorization.State==='CANCELLED'||authorization.State==='EXPIRED')return review('CLOSED_WITH_NATIVE_SOURCE');
 const date=typeof doc.DocuDate==='string'?doc.DocuDate.slice(0,10):'';
 if(!isValidStartDate(date)||date<window.businessDate)return review('SOURCE_DATE_OUTSIDE_WINDOW');
 if(!['N','Y'].includes(String(doc.DocuStatus||'').trim()))return review('SOURCE_STATUS_UNVERIFIED');
 const actual=doc.lines.map(x=>({couponId:integer(x.CouponID),units:quantity(x.GoodQty)}));
 if(actual.length!==expected.length||actual.some(x=>!x.couponId||!x.units)||
    new Set(actual.map(x=>x.couponId)).size!==actual.length)return review('NATIVE_LINES_INCOMPLETE_OR_AMBIGUOUS');
 const byCoupon=new Map(actual.map(x=>[x.couponId,x.units]));
 if(expected.some(x=>byCoupon.get(x.couponId)!==x.units))return review('NATIVE_LINES_CHANGED');
 if(settlements.length!==expected.length)return review('SETTLEMENT_LINK_INCOMPLETE');
 const seen=new Set();
 for(const s of settlements){
  const rid=integer(s.ReservationId),cid=integer(s.CouponId),red=integer(s.NativeRedemptionId),units=quantity(s.SettledQty);
  const e=expected.find(x=>x.reservationId===rid);
  if(!e||seen.has(rid)||cid!==e.couponId||red!==docId||units!==e.units||
     typeof s.NativeDocuNo!=='string'||s.NativeDocuNo.trim()!==number)return review('SETTLEMENT_LINK_INCONSISTENT');
  seen.add(rid);
 }
 // Even exact current rows do not prove the native balance was changed in the
 // same transaction, or that the source has never been changed and restored.
 return review('LINKED_REQUIRES_TRANSACTION_EVIDENCE');
}
module.exports={classifyNativeAuthorizationEvidence};
