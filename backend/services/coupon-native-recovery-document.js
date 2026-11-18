'use strict';

// Candidate arithmetic only. Before/after must eventually be established from
// the same native transaction under locks; neither this function nor its output
// is evidence of a WinSpeed edit or permission to write recovery.
const {planNativeRecovery}=require('./coupon-native-recovery-plan');
function fail(code) { throw Object.assign(new Error(code),{code}); }
function id(value) {
  if(typeof value!=='string' || !/^[1-9]\d{0,9}$/.test(value) || BigInt(value)>2147483647n)
    fail('RECOVERY_DOCUMENT_INVALID');
  return value;
}
function units(value) {
  if(typeof value!=='string' || value.length>24 || !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(value))
    fail('RECOVERY_DOCUMENT_INVALID');
  const [whole,fraction='']=value.split('.');const n=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
  if(n>999999999999n) fail('RECOVERY_DOCUMENT_INVALID');return n;
}
function planDocumentRecovery({beforeLines,afterLines,links}={}) {
  if(!Array.isArray(beforeLines)||!Array.isArray(afterLines)||!Array.isArray(links)||
    beforeLines.length===0||beforeLines.length>100||afterLines.length>100||links.length!==beforeLines.length)
    fail('RECOVERY_DOCUMENT_INVALID');
  function index(rows) {
    const map=new Map();for(const row of rows) {
      if(!row || typeof row!=='object')fail('RECOVERY_DOCUMENT_INVALID');
      const k=id(row.couponId);if(map.has(k))fail('RECOVERY_DOCUMENT_AMBIGUOUS');map.set(k,row);
    } return map;
  }
  const before=index(beforeLines),after=index(afterLines),byCoupon=index(links);
  for(const [k,row] of after) {
    if(!before.has(k))fail('RECOVERY_NEW_AUTHORIZATION_REQUIRED');
    if(units(row.qty)===0n)fail('RECOVERY_DOCUMENT_INVALID');
  }
  const result=[];
  for(const [couponId,old] of before) {
    const link=byCoupon.get(couponId);if(!link)fail('RECOVERY_DOCUMENT_INVALID');
    const settled=units(link.originalSettledQty),returned=units(link.previouslyReturnedQty);
    if(returned>settled || units(old.qty)!==settled-returned || units(old.qty)===0n)
      fail('RECOVERY_DOCUMENT_SOURCE_MISMATCH');
    const next=after.get(couponId);
    const plan=planNativeRecovery({...link,targetSettledQty:next?next.qty:'0'});
    result.push({couponId,...plan});
  }
  return {lines:result,requiresAtomicProof:true};
}
module.exports={planDocumentRecovery};
