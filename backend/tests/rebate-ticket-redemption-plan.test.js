'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planTicketRedemption}=require('../services/rebate-ticket-redemption-plan');
const ticket=(id,expiry,remaining='1.0000')=>({Id:id,CustId:7,GoodId:3,Status:'ACTIVE',
  IssuedDate:'2026-01-01',ExpiryDate:expiry,IssuedTonnage:'1.0000',RemainingTonnage:remaining});
const base={customerId:7,goodId:3,requestedTonnage:'1.2500',asOfDate:'2026-11-14'};
test('FIFO uses soonest expiry and exact four-decimal tonnage',()=>{
  const r=planTicketRedemption({...base,tickets:[ticket(2,'2026-12-31'),ticket(1,'2026-11-14')]});
  assert.deepEqual(r.allocations.map(x=>[x.ticketId,x.quantityTon,x.remainingAfter]),[[1,'1.0000','0.0000'],[2,'0.2500','0.7500']]);
});
test('other customer or product never contribute to a ticket balance',()=>{
  for(const change of [{CustId:8},{GoodId:4}])
    assert.throws(()=>planTicketRedemption({...base,tickets:[{...ticket(1,'2026-12-31'),...change}]}),{code:'TICKET_DATA_INVALID'});
});
test('expired, cancelled and future tickets are excluded; valid extension is used',()=>{
  const expired=ticket(1,'2026-11-13'),cancelled={...ticket(2,'2026-12-31'),Status:'CANCELLED'};
  const future={...ticket(3,'2027-12-31'),IssuedDate:'2026-11-15'};
  const extended={...ticket(4,'2026-10-01'),Status:'EXTENDED_ACTIVE',ExtendedExpiryDate:'2026-12-01'};
  const r=planTicketRedemption({...base,requestedTonnage:'1.0000',tickets:[expired,cancelled,future,extended]});
  assert.deepEqual(r.allocations.map(x=>x.ticketId),[4]);
  assert.throws(()=>planTicketRedemption({...base,tickets:[expired,cancelled,future,extended]}),{code:'INSUFFICIENT_TICKET_BALANCE'});
});
test('duplicate, malformed, excessive precision and overdraw fail closed',()=>{
  assert.throws(()=>planTicketRedemption({...base,tickets:[ticket(1,'2026-12-31'),ticket(1,'2026-12-31')]}),{code:'TICKET_DATA_INVALID'});
  assert.throws(()=>planTicketRedemption({...base,requestedTonnage:'0.00001',tickets:[]}),{code:'TICKET_QUANTITY_INVALID'});
  assert.throws(()=>planTicketRedemption({...base,tickets:[ticket(1,'2026-12-31')]}),{code:'INSUFFICIENT_TICKET_BALANCE'});
});
