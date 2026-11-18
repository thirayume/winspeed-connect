'use strict';

// Pure planner only. It must not be exposed as a deduction API until the
// verified native 103 financial treatment, idempotent receipt and a single
// transaction with the booking have been implemented.
const { isValidStartDate } = require('./data-window');
function fail(code,status=409){throw Object.assign(Error(code),{code,status});}
function id(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0&&n<=2147483647?n:null;}
function units(value){
  const s=String(value??'');
  if(!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/.test(s))fail('TICKET_QUANTITY_INVALID',400);
  const [whole,fraction='']=s.split('.');
  return BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
}
function quantity(value){return `${value/10000n}.${String(value%10000n).padStart(4,'0')}`;}
function date(value){
  const s=value instanceof Date ? value.toISOString().slice(0,10) : String(value||'').slice(0,10);
  if(!isValidStartDate(s))fail('TICKET_DATA_INVALID');return s;
}
function planTicketRedemption({customerId,goodId,requestedTonnage,asOfDate,tickets}={}) {
  const customer=id(customerId),good=id(goodId),requested=units(requestedTonnage);
  if(!customer||!good||requested<=0n||!isValidStartDate(asOfDate)||!Array.isArray(tickets))fail('TICKET_REQUEST_INVALID',400);
  const seen=new Set();
  const candidates=tickets.map(t=>{
    const ticketId=Number(t.Id);
    if(!Number.isSafeInteger(ticketId)||ticketId<=0||seen.has(ticketId)||
       id(t.CustId)!==customer||id(t.GoodId)!==good)fail('TICKET_DATA_INVALID');
    seen.add(ticketId);
    const status=String(t.Status||'').trim(),remaining=units(t.RemainingTonnage),issued=units(t.IssuedTonnage);
    const issuedDate=date(t.IssuedDate),expiry=date(t.ExtendedExpiryDate||t.ExpiryDate);
    if(issued<=0n||remaining>issued||issuedDate>expiry)fail('TICKET_DATA_INVALID');
    return {id:ticketId,status,remaining,issuedDate,expiry};
  }).filter(t=>['ACTIVE','PARTIALLY_USED','EXTENDED_ACTIVE'].includes(t.status)&&
    t.remaining>0n&&t.issuedDate<=asOfDate&&t.expiry>=asOfDate)
    .sort((a,b)=>a.expiry.localeCompare(b.expiry)||a.issuedDate.localeCompare(b.issuedDate)||a.id-b.id);
  if(candidates.reduce((sum,t)=>sum+t.remaining,0n)<requested)fail('INSUFFICIENT_TICKET_BALANCE');
  let left=requested;const allocations=[];
  for(const ticket of candidates){
    if(!left)break;
    const used=ticket.remaining<left?ticket.remaining:left,remaining=ticket.remaining-used;
    allocations.push({ticketId:ticket.id,quantityTon:quantity(used),remainingBefore:quantity(ticket.remaining),
      remainingAfter:quantity(remaining),status:remaining===0n?'REDEEMED':'PARTIALLY_USED'});
    left-=used;
  }
  return {customerId:customer,goodId:good,quantityTon:quantity(requested),asOfDate,allocations};
}
module.exports={planTicketRedemption,ticketUnits:units,ticketQuantity:quantity};
