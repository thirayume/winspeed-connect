'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {prepareTicketBookingProof}=require('../services/rebate-ticket-booking-proof');
const user={sub:1,role:'ADMIN',actorSub:1};
const input={user,bookingId:10,lineNo:2,requestedTonnage:'0.5000',startDate:'2026-01-01'};
function fixture(patch={},otherLines=[]){
  const calls=[];const native={SOID:10,CustID:7,EmpID:9,DocuStatus:'N',DocuDate:'2026-11-14',Today:'2026-11-14',
    ListNo:2,GoodID:3,GoodQty2:'1.000',GoodUnitID2:4,GoodUnitCode:'ตัน',GoodUnitName:'ตัน',
    DocuNo:'TEST',GoodPrice2:'100.00',GoodAmnt:'100.00',BillDiscAmnt:'0.00',NetAmnt:'100.00',
    SumGoodAmnt:'100.00',SumIncludeAmnt:'100.00',SumExcludeAmnt:'0.00',BaseDiscAmnt:'0.00',
    BillAftrDiscAmnt:'100.00',TotaBaseAmnt:'100.00',TotaExcludeAmnt:'0.00',MiscChargAmnt:'0.00',
    VATAmnt:'0.00',VatType:'0',BillDiscFormula:'',VatRateBits:'0x0000000000000000',...patch};
  const ticket={Id:5,CustId:7,GoodId:3,IssuedTonnage:'1.0000',RemainingTonnage:'1.0000',
    IssuedDate:'2026-01-01',ExpiryDate:'2026-12-31',Status:'ACTIVE'};
  const query=async(text,params)=>{calls.push({text,params});
    if(/FROM dbo.SOHD/.test(text))return {recordset:[native]};
    if(/FROM dbo.SODT d WITH/.test(text))return {recordset:[{
      DocuType:103,ListNo:native.ListNo,GoodID:native.GoodID,GoodUnitID2:native.GoodUnitID2,GoodQty2:native.GoodQty2,
      GoodPrice2:native.GoodPrice2,GoodAmnt:native.GoodAmnt,GoodDiscAmnt:'0.0000',
      GoodDiscFormula:null,GoodDiscType:'N',FreeFlag:'N',VatType:'3',VatRateBits:null},...otherLines]};
    if(/FROM wf.FertilizerTicket/.test(text))return {recordset:[ticket]};
    throw Error('unexpected SQL');
  };
  return {calls,query,overrides:{getVisibleScope:async()=>({all:true}),assertAging:async()=>{}}};
}
test('native booking, customer, product, ton unit, cutoff and ticket are bound under locks',async()=>{
  const f=fixture();const r=await prepareTicketBookingProof(f.query,input,f.overrides);
  assert.equal(r.plan.customerId,7);assert.equal(r.plan.goodId,3);assert.equal(r.plan.allocations[0].quantityTon,'0.5000');
  assert.equal(r.financial.nativeFields.VATAmnt,'0.0000');
  assert.equal(r.financial.nativeFields.GoodPrice2,'100.0000');
  assert.match(f.calls[0].text,/DocuDate>=CAST\(@startDate AS date\)/);
  // Native WinSpeed amounts are SQL Server money: direct conversion to text
  // silently rounds to two decimals even though the column stores four.
  for(const field of ['d.GoodQty2','d.GoodPrice2','d.GoodAmnt','h.BillDiscAmnt','h.NetAmnt',
    'h.SumGoodAmnt','h.SumIncludeAmnt','h.SumExcludeAmnt','h.BaseDiscAmnt','h.BillAftrDiscAmnt',
    'h.TotaBaseAmnt','h.TotaExcludeAmnt','h.MiscChargAmnt','h.VATAmnt'])
    assert.ok(f.calls[0].text.includes(`CAST(${field} AS decimal(19,4))`),field);
  assert.match(f.calls[1].text,/FROM dbo.SODT d WITH\(UPDLOCK,HOLDLOCK\)/);
  assert.match(f.calls[2].text,/CustId=@customer AND GoodId=@good/);
  assert.equal(f.calls.some(c=>/INSERT|UPDATE|DELETE/.test(c.text)),false);
});
test('unit mismatch, overdraw and missing scope cannot produce a proof',async()=>{
  let f=fixture({GoodUnitCode:'กระสอบ'});
  await assert.rejects(prepareTicketBookingProof(f.query,input,f.overrides),{code:'TICKET_BOOKING_SOURCE_UNCONFIRMED'});
  f=fixture();await assert.rejects(prepareTicketBookingProof(f.query,{...input,requestedTonnage:'2.0000'},f.overrides),{code:'TICKET_BOOKING_QUANTITY_INVALID'});
  f=fixture();f.overrides.getVisibleScope=async()=>({all:false,empIds:[],userIds:[]});
  await assert.rejects(prepareTicketBookingProof(f.query,input,f.overrides),{code:'TICKET_BOOKING_NOT_FOUND'});
});
test('an Access As actor without permission is refused before querying data',async()=>{
  const f=fixture();
  await assert.rejects(prepareTicketBookingProof(f.query,{...input,user:{sub:1,role:'ADMIN',isImpersonating:true,actorSub:2,actorRole:'WAREHOUSE'}},f.overrides),
    {code:'TICKET_PERMISSION_REQUIRED'});
  assert.equal(f.calls.length,0);
});
test('locked financial fingerprint changes with native price or discount',async()=>{
  const a=fixture(),b=fixture({BillDiscAmnt:'10.00'}),c=fixture({GoodPrice2:'90.00'});
  const first=await prepareTicketBookingProof(a.query,input,a.overrides);
  const changedDiscount=await prepareTicketBookingProof(b.query,input,b.overrides);
  const changedPrice=await prepareTicketBookingProof(c.query,input,c.overrides);
  assert.notEqual(first.nativeFingerprint,changedDiscount.nativeFingerprint);
  assert.notEqual(first.nativeFingerprint,changedPrice.nativeFingerprint);
});
test('fingerprint detects fractional-cent changes, tax, other charges and document totals',async()=>{
  const original=fixture();
  const base=await prepareTicketBookingProof(original.query,input,original.overrides);
  for(const patch of [{GoodPrice2:'100.0001'},{GoodAmnt:'100.0001'},{VATAmnt:'0.0001'},
    {VatRateBits:'0x0000000000000001'},{VatType:'1'},{MiscChargAmnt:'0.0001'},
    {BillAftrDiscAmnt:'99.9999'},{TotaBaseAmnt:'99.9999'},{SumGoodAmnt:'99.9999'},
    {BillDiscFormula:'1%'}]){
    const f=fixture(patch);
    assert.notEqual((await prepareTicketBookingProof(f.query,input,f.overrides)).nativeFingerprint,base.nativeFingerprint);
  }
  const f=fixture({VATAmnt:null});
  await assert.rejects(prepareTicketBookingProof(f.query,input,f.overrides),{code:'TICKET_BOOKING_FINANCIAL_SOURCE_UNCONFIRMED'});
});
test('equivalent fixed-point representations produce the same fingerprint',async()=>{
  const a=fixture(),b=fixture({GoodPrice2:'100.0000',VATAmnt:'0.0000'});
  assert.equal((await prepareTicketBookingProof(a.query,input,a.overrides)).nativeFingerprint,
    (await prepareTicketBookingProof(b.query,input,b.overrides)).nativeFingerprint);
});
test('fingerprint includes other native lines even when header totals stay unchanged',async()=>{
  const other={DocuType:103,ListNo:3,GoodID:4,GoodUnitID2:4,GoodQty2:'1.0000',GoodPrice2:'0.0000',
    GoodAmnt:'0.0000',GoodDiscAmnt:'0.0000',GoodDiscFormula:null,GoodDiscType:'N',FreeFlag:'Y',VatType:'3',VatRateBits:null};
  const a=fixture({},[other]),b=fixture({},[{...other,GoodQty2:'2.0000'}]),c=fixture({},[{...other,GoodID:5}]);
  const first=(await prepareTicketBookingProof(a.query,input,a.overrides)).nativeFingerprint;
  assert.notEqual(first,(await prepareTicketBookingProof(b.query,input,b.overrides)).nativeFingerprint);
  assert.notEqual(first,(await prepareTicketBookingProof(c.query,input,c.overrides)).nativeFingerprint);
  const tax=fixture({},[{...other,VatType:'2'}]);
  assert.notEqual(first,(await prepareTicketBookingProof(tax.query,input,tax.overrides)).nativeFingerprint);
});
test('duplicate lines or inconsistent selected native line fail closed',async()=>{
  let f=fixture({},[{DocuType:103,ListNo:2,GoodID:3,GoodUnitID2:4,GoodQty2:'1.0000',GoodPrice2:'0.0000',GoodAmnt:'0.0000',GoodDiscAmnt:'0.0000'}]);
  await assert.rejects(prepareTicketBookingProof(f.query,input,f.overrides),{code:'TICKET_BOOKING_FINANCIAL_SOURCE_UNCONFIRMED'});
  f=fixture();const original=f.query;
  f.query=async(text,params)=>/FROM dbo.SODT d WITH/.test(text)?{recordset:[{DocuType:103,ListNo:2,GoodID:9,GoodUnitID2:4,
    GoodQty2:'1.0000',GoodPrice2:'100.0000',GoodAmnt:'100.0000',GoodDiscAmnt:'0.0000'}]}:original(text,params);
  await assert.rejects(prepareTicketBookingProof(f.query,input,f.overrides),{code:'TICKET_BOOKING_FINANCIAL_SOURCE_UNCONFIRMED'});
  f=fixture({},[{DocuType:104,ListNo:3,GoodID:4,GoodUnitID2:4,GoodQty2:'1.0000',GoodPrice2:'0.0000',GoodAmnt:'0.0000',GoodDiscAmnt:'0.0000'}]);
  await assert.rejects(prepareTicketBookingProof(f.query,input,f.overrides),{code:'TICKET_BOOKING_FINANCIAL_SOURCE_UNCONFIRMED'});
});
