'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let rows=[],settings=[],failSettings=false,beneficiaries=[],metadata=[];
const db=h.installDbStub(({text})=>{
 if(text.includes("'TICKET_EXPIRY_DEFAULT_DAYS','TICKET_EXPIRY_WARNING_LEAD_DAYS'")){if(failSettings)throw Error('SETTINGS_UNAVAILABLE');return settings;}
 if(text.includes('PagingCTE AS'))return structuredClone(rows);
 if(text.includes('SELECT OwnerCustId,BeneficiaryCustId'))return beneficiaries;
 if(text.includes('SELECT c.CouponID,cu.CustCode'))return metadata;
 return [];
});
const {couponExpiry}=require('../services/coupon-expiry-policy');
const {readControlTickets,legacyCouponRows}=require('../services/control-ticket-list');
const user={sub:1,role:'ADMIN'};
const base={CouponID:1,CouponNo:'C-QA',CustID:2,CustName:'QA customer',GoodID:3,GoodName:'QA product',GoodPrice:100,
 TotalQtyTon:5,NativeRemainingQtyTon:3,ReservedQtyTon:1,AvailableQtyTon:2,DocuDate:null,DeliveryDocuNo:null,
 Lifecycle:'ISSUED',BalanceState:'POSITIVE',ControlExpiryDate:null,TicketExpiryDate:null,ExpiryIssueDate:'2025-01-01',ControlExpiryRows:0,TotalFilteredCount:1};
test.beforeEach(()=>{rows=[base];settings=[];failSettings=false;beneficiaries=[];metadata=[];db.calls.length=0;});
test('expiry uses calendar dates in Bangkok with disjoint past/today/near categories',()=>{
 const input={ticketDate:'2026-11-25',warningDays:30};
 assert.equal(couponExpiry(input,new Date('2026-11-24T16:59:59Z')).status,'NEAR_EXPIRY');
 assert.equal(couponExpiry(input,new Date('2026-11-24T17:00:00Z')).status,'TODAY');
 assert.equal(couponExpiry(input,new Date('2026-11-25T17:00:00Z')).status,'EXPIRED');
 assert.equal(couponExpiry({issueDate:'2024-02-28',lifeDays:2},'2024-02-29').expiryDate,'2024-03-01');
 assert.equal(couponExpiry({ticketDate:'2026-12-01',warningDays:0},'2026-11-30').status,'VALID');
});
test('source precedence matches transactional checks, expired stays usable and unissued has no invented date',()=>{
 const e=couponExpiry({controlDate:'2020-01-01',ticketDate:'2030-01-01',issueDate:'2026-01-01'},'2026-11-24');
 assert.equal(e.source,'CONTROL_TICKET');assert.equal(e.expired,true);assert.equal(e.blocked,false);
 assert.equal(couponExpiry({ticketDate:'2030-01-01',issueDate:'2026-01-01'}).source,'TICKET');
 assert.equal(couponExpiry({}).status,'UNKNOWN');
 assert.throws(()=>couponExpiry({controlRows:2}),{code:'COUPON_EXPIRY_AMBIGUOUS'});
 assert.throws(()=>couponExpiry({ticketDate:'invalid'}),{code:'COUPON_EXPIRY_INVALID'});
});
test('opening ticket derives expiry before source metadata is redacted and shares native/held/available quantities',async()=>{
 const r=await readControlTickets(user,{paginated:'true'}),item=r.data[0];
 assert.equal(item.AvailableQtyTon,2);assert.equal(item.ReservedQtyTon,1);assert.equal(item.NativeRemainingQtyTon,3);
 assert.equal(item.expiryDate,'2025-04-01');assert.equal(item.expirySource,'DEFAULT');assert.equal(item.isBlocked,false);
 assert.equal(item.DocuDate,null);assert.equal(item.DeliveryDocuNo,null);
 for(const key of ['ExpiryIssueDate','ControlExpiryDate','TicketExpiryDate','ControlExpiryRows'])assert.equal(key in item,false,key);
});
test('expiry filtering and ordering apply in SQL before counts and pagination, including fully reserved warnings',async()=>{
 await readControlTickets(user,{tab:'ALERTS',expiry:'TODAY',page:'2',pageSize:'5'});
 const q=db.calls.find(c=>c.text.includes('PagingCTE AS'));
 assert.equal(q.inputs.expiryFilter,'TODAY');assert.equal(q.inputs.offset,5);
 assert.match(q.text,/FROM AllControlItems WHERE \(@expiryFilter/);assert.match(q.text,/ORDER BY ExpiryDate ASC/);
 assert.match(q.text,/c\.RemaQty-ISNULL\(res.TotalReserved,0\)\)>=0/);
 assert.match(q.text,/COALESCE\(ov\.ExpiryDate, ticketExpiry\.ExpiryDate, DATEADD/);
 assert.match(q.text,/WHERE ov.DocuId=c.CouponID/);assert.doesNotMatch(q.text,/ov\.DocuNo = h103/);
 await assert.rejects(readControlTickets(user,{expiry:'SQL;'}),{status:400});
});
test('compatibility customer rows keep beneficiaries, FIFO and scoped balances without exposing prices to SALES',async()=>{
 beneficiaries=[{OwnerCustId:2,BeneficiaryCustId:4,Scope:'3',BeneficiaryCustName:'QA member'},{OwnerCustId:2,BeneficiaryCustId:5,Scope:'99'}];
 metadata=[{CouponID:1,CustCode:'QA-2',EmpID:7,EmpName:'QA employee'}];
 const result=await legacyCouponRows({...user,role:'SALES'});
 assert.equal(result.length,1);assert.equal(result[0].remaQty,3);assert.equal(result[0].availableQty,2);assert.equal(result[0].reservedQty,1);
 assert.equal(result[0].beneficiaries.length,1);assert.equal(result[0].GoodPrice,undefined);assert.equal(result[0].custCode,'QA-2');
 assert.match(db.calls.find(c=>c.text.includes('PagingCTE AS')).text,/ORDER BY ExpiryIssueDate ASC/);
 assert.equal(db.calls.some(c=>/\b(INSERT|UPDATE|DELETE|MERGE)\b/.test(c.text)),false);
});
test('settings read errors fail closed rather than silently advertising a different life policy',async()=>{
 failSettings=true;await assert.rejects(readControlTickets(user),/SETTINGS_UNAVAILABLE/);
 assert.equal(db.calls.some(c=>c.text.includes('FROM dbo.WFCoupon')),false);
});
