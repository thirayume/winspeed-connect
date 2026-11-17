'use strict';
const {sql,wfQuery}=require('../db');

// Settlement uses full history for balance correctness. Only document details
// from the configured business window may be returned to an HTTP caller.
async function visibleRedemptionIds(ids,window,queryFn=wfQuery) {
  const values=[...new Set(ids.map(Number).filter(n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647))];
  if(!window?.businessDate)throw Error('DATA_WINDOW_UNAVAILABLE');
  const allowed=new Set();
  for(let offset=0;offset<values.length;offset+=500){
    const inputs={start:{type:sql.Date,value:window.businessDate}};
    const keys=values.slice(offset,offset+500).map((value,i)=>{const k=`redemption${i}`;inputs[k]={type:sql.Int,value};return `@${k}`;});
    const rows=(await queryFn(`SELECT RedemtionID FROM dbo.WFRedemtionHD
      WHERE RedemtionID IN (${keys.join(',')}) AND DocuType=116 AND DocuDate>=@start`,inputs)).recordset || [];
    for(const row of rows)allowed.add(String(row.RedemtionID));
  }
  return allowed;
}

async function presentSettlement(result,window,queryFn=wfQuery){
  const groups=[result.settlements||[],result.ambiguous||[],result.unmatched||[]];
  const ids=groups.flat().map(x=>x.redemptionId).filter(x=>x!=null);
  let visible;
  try{visible=await visibleRedemptionIds(ids,window,queryFn);}catch{
    return {...result,settlements:[],ambiguous:[],unmatched:[],note:[result.note,'ไม่สามารถแสดงรายละเอียดเอกสารได้ กรุณาลองใหม่'].filter(Boolean).join(' · ')};
  }
  const inWindow=x=>visible.has(String(x.redemptionId));
  const settlements=groups[0].filter(inWindow).map(x=>({reservationId:x.reservationId,redemptionId:x.redemptionId,
    redemptionDocuNo:x.redemptionDocuNo,nativeDocuNo:x.nativeDocuNo,docuNo:x.docuNo,matchedQty:x.matchedQty,settledQty:x.settledQty,qty:x.qty}));
  const ambiguous=groups[1].filter(inWindow).map(x=>({redemptionId:x.redemptionId,
    redemptionDocuNo:x.redemptionDocuNo,cutQty:x.cutQty,
    docuNo:x.docuNo ?? x.redemptionDocuNo,qty:x.qty ?? x.cutQty,reason:x.reason}));
  const unmatched=groups[2].filter(inWindow).map(x=>({redemptionId:x.redemptionId,couponId:x.couponId,couponNo:x.couponNo,docuNo:x.docuNo,docuDate:x.docuDate,
    goodQty:x.goodQty,receiver:x.receiver,plate:x.plate,reason:x.reason,candidateReservations:(x.candidateReservations||[]).map(c=>({
    id:c.id,reservedQty:c.reservedQty,remainingReservedQty:c.remainingReservedQty,
  }))}));
  return {...result,settlements,ambiguous,unmatched};
}
module.exports={visibleRedemptionIds,presentSettlement};
