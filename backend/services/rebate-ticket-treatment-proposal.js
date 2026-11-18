'use strict';

// Arithmetic for an isolated ticket-only line. This is an internal proposal,
// not an accounting approval or permission to issue/redesign native documents.
// Both methods require WinSpeed UAT, tax and GL verification before exposure.
const {ticketUnits,ticketQuantity}=require('./rebate-ticket-redemption-plan');
const MAX_MONEY=9223372036854775807n; // SQL Server money in 1/10000 baht.
function fail(code){throw Object.assign(Error(code),{code,status:400});}
function money(value){
  const s=String(value??'');
  if(!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/.test(s))fail('TICKET_PRICE_INVALID');
  const [whole,fraction='']=s.split('.');
  const result=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
  if(result>MAX_MONEY)fail('TICKET_PRICE_INVALID');
  return result;
}
function amount(value){return `${value/10000n}.${String(value%10000n).padStart(4,'0')}`;}

function proposeTicketLine({treatment,quantityTon,sellingPricePerTon}={}){
  if(!['ZERO','DISCOUNT'].includes(treatment))fail('TICKET_TREATMENT_INVALID');
  const qty=ticketUnits(quantityTon),price=money(sellingPricePerTon);
  if(qty<=0n||price<=0n)fail('TICKET_PRICE_INVALID');
  const raw=qty*price;
  // No implicit rounding: users must resolve unsupported precision before
  // producing an accounting document or consuming a ticket.
  if(raw%10000n!==0n)fail('TICKET_AMOUNT_PRECISION_UNSUPPORTED');
  const value=raw/10000n;
  if(value>MAX_MONEY)fail('TICKET_AMOUNT_OVERFLOW');
  return {treatment,quantityTon:ticketQuantity(qty),referenceSalesPrice:amount(price),
    linePrice:amount(treatment==='ZERO'?0n:price),
    lineGross:amount(treatment==='ZERO'?0n:value),
    proposedDiscount:amount(treatment==='DISCOUNT'?value:0n),
    payableForTicketLine:'0.0000',readyForNativeWrite:false};
}
module.exports={proposeTicketLine};
