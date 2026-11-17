'use strict';

// Offline validation of a candidate recovery chain. This does not prove a
// native edit, read SQL, authorize a user, or write anything. A future writer
// must load every record under the same transaction and prove the live 116 and
// balance transition independently before using this result.
const MAX_QTY=999999999999n;
const MAX_BALANCE=999999999999999999n;
function bad() { throw Object.assign(new Error('RECOVERY_CHAIN_INVALID'),{code:'RECOVERY_CHAIN_INVALID'}); }
function id(value) {
  if(typeof value==='number') { if(!Number.isSafeInteger(value) || value<=0) bad(); return BigInt(value); }
  if(typeof value!=='string' || !/^[1-9]\d{0,18}$/.test(value)) bad();
  const result=BigInt(value);if(result>9223372036854775807n) bad();return result;
}
function quantity(value,max) {
  if(typeof value!=='string' || value.length>24 || !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(value)) bad();
  const [whole,fraction='']=value.split('.');const result=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
  if(result>max) bad();return result;
}
function decimal(value) { return `${value/10000n}.${String(value%10000n).padStart(4,'0')}`; }
function validateRecoveryChain({line,evidence,settlement,history}={}) {
  if(!line || !evidence || !settlement || !Array.isArray(history) || evidence.state!=='APPLIED') bad();
  const lineId=id(line.id),reservationId=id(line.reservationId),couponId=id(line.couponId);
  const settlementId=id(settlement.id),redemptionId=id(settlement.nativeRedemptionId);
  if(id(evidence.authorizationLineId)!==lineId || id(evidence.nativeRedemptionId)!==redemptionId ||
    id(settlement.reservationId)!==reservationId || id(settlement.couponId)!==couponId) bad();
  const original=quantity(settlement.settledQty,MAX_QTY),authorized=quantity(line.authorizedQty,MAX_QTY);
  const evidenceBefore=quantity(evidence.balanceBefore,MAX_BALANCE),evidenceAfter=quantity(evidence.balanceAfter,MAX_BALANCE);
  if(original===0n || authorized!==original || evidenceBefore<evidenceAfter || evidenceBefore-evidenceAfter!==original) bad();
  let current=original,previousId=0n;const keys=new Set(),auditIds=new Set();
  for(const row of history) {
    if(!row || id(row.authorizationLineId)!==lineId || id(row.settlementId)!==settlementId) bad();
    const rowId=id(row.id),audit=id(row.auditEventId).toString();
    if(rowId<=previousId || typeof row.recoveryKey!=='string' || !row.recoveryKey.trim() ||
      row.recoveryKey.length>100 || keys.has(row.recoveryKey) || auditIds.has(audit)) bad();
    const before=quantity(row.settledBefore,MAX_QTY),after=quantity(row.settledAfter,MAX_QTY),restored=quantity(row.restoredQty,MAX_QTY);
    const nativeBefore=quantity(row.nativeBefore,MAX_BALANCE),nativeAfter=quantity(row.nativeAfter,MAX_BALANCE);
    if(before!==current || after>=before || before-after!==restored || nativeAfter<nativeBefore || nativeAfter-nativeBefore!==restored) bad();
    current=after;previousId=rowId;keys.add(row.recoveryKey);auditIds.add(audit);
  }
  return {settledQty:decimal(current),returnedQty:decimal(original-current),requiresAtomicProof:true};
}
module.exports={validateRecoveryChain};
