'use strict';

// Allocates only current-epoch verified shipment accruals. The caller holds
// the customer lock, rechecks evidence and reserves each selected accrual in
// the same transaction; this function itself never changes balances.
const { shipmentUnits, shipmentMoney } = require('./rebate-shipment-accrual');
const { isValidStartDate } = require('./data-window');
const { computeCycleExpiryDate } = require('./rebate-pool-models');
const { parseEvidenceInstant } = require('./rebate-evidence-policy');
function fail(code) { throw Object.assign(new Error(code), { code, status:400 }); }
const cost = (qty, rate) => (qty*rate+500n)/1000n;
function maxQty(qty, rate, cents) {
  let lo=0n,hi=qty;
  while(lo<hi){const mid=(lo+hi+1n)/2n;if(cost(mid,rate)<=cents)lo=mid;else hi=mid-1n;}
  return lo;
}
function ton(qty) { return `${qty/1000n}.${String(qty%1000n).padStart(3,'0')}`; }
function allocateShipmentRebate(rows,{requestedAmountBaht=null,convertAll=false,maturedOnly=false,asOfDate,cycleMonths=12}={}) {
  if (!Array.isArray(rows) || !isValidStartDate(asOfDate) || !Number.isInteger(cycleMonths) || cycleMonths<1 || cycleMonths>120 ||
      (requestedAmountBaht!=null)===(convertAll===true)) fail('INVALID_REBATE_ALLOCATION');
  const seen=new Set();
  const lots=rows.map(r=>{
    const id=Number(r.AccrualId), date=String(r.EarnedDate || '');
    if (!Number.isSafeInteger(id)||id<1||!isValidStartDate(date)||seen.has(id)) fail('REBATE_SOURCE_INVALID');
    seen.add(id);
    let occurred; try { occurred=parseEvidenceInstant(r.OccurredAtUtc); } catch (_) { fail('REBATE_SOURCE_INVALID'); }
    if (new Date(occurred+7*60*60*1000).toISOString().slice(0,10)!==date) fail('REBATE_SOURCE_INVALID');
    const qty=shipmentUnits(r.RemainingTon,3), rate=shipmentUnits(r.RebatePerTon,2), remaining=shipmentUnits(r.RemainingAmountBaht,2);
    if (rate<=0n) fail('REBATE_SOURCE_INVALID');
    const usable=maxQty(qty,rate,remaining);
    return {id,date,occurred,qty:usable,rate,available:cost(usable,rate)};
  }).filter(l=>l.qty>0n&&l.available>0n&&l.date<=asOfDate&&(!maturedOnly||computeCycleExpiryDate(l.date,cycleMonths)<=asOfDate))
    .sort((a,b)=>a.occurred-b.occurred||a.id-b.id);
  const available=lots.reduce((sum,l)=>sum+l.available,0n);
  const target=convertAll?available:shipmentUnits(requestedAmountBaht,2);
  if(target<=0n) fail('INVALID_CONVERSION_AMOUNT');
  if(target>available) fail('INSUFFICIENT_REBATE_BALANCE');
  let remaining=target; const allocations=[];
  for(const lot of lots){
    if(remaining===0n)break;
    const qty=maxQty(lot.qty,lot.rate,remaining),amount=cost(qty,lot.rate);
    if(qty===0n||amount===0n)fail('CONVERSION_AMOUNT_NOT_REPRESENTABLE');
    allocations.push({accrualId:lot.id,quantityTon:ton(qty),amountBaht:shipmentMoney(amount)});
    remaining-=amount;
    if(qty<lot.qty&&remaining>0n)fail('CONVERSION_AMOUNT_NOT_REPRESENTABLE');
  }
  if(remaining!==0n)fail('CONVERSION_AMOUNT_NOT_REPRESENTABLE');
  return {allocations,convertedBaht:shipmentMoney(target),remainingBaht:shipmentMoney(available-target)};
}
module.exports={allocateShipmentRebate};
