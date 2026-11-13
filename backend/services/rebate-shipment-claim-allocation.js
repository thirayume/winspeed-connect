'use strict';

// Internal allocation only. The caller must apply the resulting reservations
// with the claim header/lines in one customer-locked business transaction.
// Source fields below must be redacted when presented as opening balances.
const { shipmentUnits, shipmentMoney }=require('./rebate-shipment-accrual');
const { isValidStartDate }=require('./data-window');
const { parseEvidenceInstant }=require('./rebate-evidence-policy');
function fail(code){throw Object.assign(new Error(code),{code,status:400});}
const cost=(qty,rate)=>(qty*rate+500n)/1000n;
const ton=qty=>`${qty/1000n}.${String(qty%1000n).padStart(3,'0')}`;
function allocateShipmentClaim(rows,lines,{startDate}={}){
  if(!Array.isArray(rows)||!Array.isArray(lines)||!lines.length||lines.length>12||!isValidStartDate(startDate))fail('REBATE_CLAIM_INPUT_INVALID');
  const seen=new Set(),lots=rows.map(r=>{
    const id=Number(r.AccrualId),soid=Number(r.SourceSOID),list=Number(r.SourceListNo),booking=Number(r.BookingSOID),bookingLine=Number(r.BookingLineNo);
    if(![id,soid,list,booking,bookingLine].every(n=>Number.isSafeInteger(n)&&n>0)||r.PlanId!=null||
       Number(r.SourceRefSOID)!==booking||Number(r.SourceRefListNo)!==bookingLine||seen.has(id)||
       !isValidStartDate(String(r.SourceDocuDate||''))||!String(r.GoodCode||'').trim())fail('REBATE_SOURCE_INVALID');
    seen.add(id);let time;try{time=parseEvidenceInstant(r.OccurredAtUtc);}catch(_){fail('REBATE_SOURCE_INVALID');}
    const qty=shipmentUnits(r.RemainingTon,3),amount=shipmentUnits(r.RemainingAmountBaht,2),rate=shipmentUnits(r.RebatePerTon,2);
    if(rate<=0n||rate>30000n||shipmentUnits(r.ListPricePerTon,2)<=0n)fail('REBATE_SOURCE_INVALID');
    shipmentUnits(r.NetPricePerTon,2);
    return {r,id,soid,list,time,qty,amount,rate,taken:0n};
  }).sort((a,b)=>a.time-b.time||a.id-b.id);
  for(const line of lines){
    if(String(line.lineType||'REBATE').toUpperCase()!=='REBATE')fail('REBATE_CLAIM_DIFFERENCE_UNAVAILABLE');
    const good=String(line.goodCode||'').trim(), opening=line.openingBalance===true;
    const soid=line.sourceSOID==null?null:Number(line.sourceSOID),list=line.sourceListNo==null?null:Number(line.sourceListNo);
    if(!good||opening&&(soid!==null||list!==null)||!opening&&((soid===null)!==(list===null))||
       soid!==null&&(!Number.isSafeInteger(soid)||soid<1||!Number.isSafeInteger(list)||list<1))fail('REBATE_CLAIM_INPUT_INVALID');
    let need=shipmentUnits(line.qtyTon,3);if(need<=0n||need>1000000000n)fail('REBATE_CLAIM_INPUT_INVALID');
    for(const lot of lots){
      const isOpening=lot.r.SourceDocuDate<startDate;
      if(!need||String(lot.r.GoodCode).trim()!==good||isOpening!==opening||
          soid!==null&&(lot.soid!==soid||lot.list!==list))continue;
      const max=lot.qty-lot.taken;if(max<=0n)continue;
      let low=0n,high=need<max?need:max;
      // A reservation is per claim/accrual. Price the aggregate once so
      // multiple user lines cannot manufacture extra satang by rounding.
      while(low<high){const mid=(low+high+1n)/2n;
        if(cost(lot.taken+mid,lot.rate)<=lot.amount)low=mid;else high=mid-1n;}
      lot.taken+=low;need-=low;
    }
    if(need>0n)fail('REBATE_CLAIM_INSUFFICIENT');
  }
  const allocations=lots.filter(l=>l.taken>0n).map(l=>{
    const amount=cost(l.taken,l.rate);if(amount<=0n)fail('REBATE_CLAIM_AMOUNT_INVALID');
    return {accrualId:l.id,quantityTon:ton(l.taken),amountBaht:shipmentMoney(amount),isOpeningBalance:l.r.SourceDocuDate<startDate,
      sourceSOID:l.soid,sourceListNo:l.list,sourceDocuNo:l.r.SourceDocuNo,sourceDocuDate:l.r.SourceDocuDate,
      sourceCouponNo:l.r.CouponNo,sourceRefSOID:l.r.SourceRefSOID,sourceRefListNo:l.r.SourceRefListNo,
      sourceBookingDocuNo:l.r.SourceBookingDocuNo,goodCode:l.r.GoodCode,goodName:l.r.GoodName,
      listPricePerTon:l.r.ListPricePerTon,netPricePerTon:l.r.NetPricePerTon,rebatePerTon:l.r.RebatePerTon,planId:null};
  });
  const cents=allocations.reduce((sum,a)=>sum+shipmentUnits(a.amountBaht,2),0n);
  if(cents<=0n||cents>999999999999n)fail('REBATE_CLAIM_AMOUNT_INVALID'); // claim amount is DECIMAL(12,2)
  return {allocations,totalAmount:shipmentMoney(cents)};
}
module.exports={allocateShipmentClaim};
