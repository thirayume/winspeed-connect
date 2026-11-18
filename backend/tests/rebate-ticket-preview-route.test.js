'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
const db=h.installDbStub(({text})=>/SELECT DB_NAME\(\) AS DatabaseName/.test(text)?[{DatabaseName:'dbwins_worldfert9_uat_fz'}]:[],{activeUserIds:h.TEST_USERS});
function replace(path,exports){const p=require.resolve(path);require(p);require.cache[p].exports=exports;}
let calls=[];
replace('../services/rebate-route-fence',{withRebateRouteFence:fn=>fn({environment:'uat',generation:1}),
  routeParticipantFence:async()=>{calls.push('participant');},isShipmentEpoch:e=>e.generation>0});
replace('../services/rebate-ticket-booking-proof',{prepareTicketBookingProof:async(_q,input)=>{calls.push(input);return {
  bookingId:input.bookingId,lineNo:input.lineNo,financial:{price:'secret'},plan:{quantityTon:'1.0000',asOfDate:'2026-11-14',allocations:[{ticketId:1}]}};}});
const postedVerifier=async()=>true;
replace('../services/rebate-ticket-financial-verifier',{verifyPostedTicketSale:postedVerifier});
replace('../services/rebate-ticket-redemption-transaction',{executeTicketRedemption:async(user,payload,options)=>{
  await options.verifyTarget(async()=>({recordset:[{DatabaseName:'dbwins_worldfert9_uat_fz'}]}),{generation:1});
  assert.equal(options.verifyFinancialTreatment,postedVerifier);
  calls.push({actor:user.sub,payload});
  return {id:10,replayed:false};
}});
let app,oldPool,oldPreview;
test.before(async()=>{oldPool=process.env.REBATE_POOL_103_ENABLED;oldPreview=process.env.REBATE_TICKET_PREVIEW_ENABLED;
  app=await h.startApp([['/api/rebate-pool','../../routes/rebate-pool']]);});
test.after(async()=>{await app.close();if(oldPool===undefined)delete process.env.REBATE_POOL_103_ENABLED;else process.env.REBATE_POOL_103_ENABLED=oldPool;
  if(oldPreview===undefined)delete process.env.REBATE_TICKET_PREVIEW_ENABLED;else process.env.REBATE_TICKET_PREVIEW_ENABLED=oldPreview;});
test('preview stays closed unless both UAT flags are enabled',async()=>{
  delete process.env.REBATE_POOL_103_ENABLED;delete process.env.REBATE_TICKET_PREVIEW_ENABLED;calls=[];
  const r=await app.call('POST','/api/rebate-pool/tickets/redemption-preview',{user:{sub:1,role:'ADMIN'},body:{}});
  assert.equal(r.status,503);assert.deepEqual(calls,[]);
});
test('ticket issuance and redemption remain closed without writing business data',async()=>{
  delete process.env.REBATE_POOL_103_ENABLED;delete process.env.REBATE_TICKET_PREVIEW_ENABLED;
  const before=db.calls.length;
  for(const [path,code] of [['issue','TICKET_ISSUANCE_UNAVAILABLE'],['redeem','TICKET_REDEMPTION_UNAVAILABLE']]){
    const response=await app.call('POST',`/api/rebate-pool/tickets/${path}`,{user:{sub:1,role:'ADMIN'},body:{bookingId:4,lineNo:1,requestedTonnage:'1.0000'}});
    assert.equal(response.status,503);assert.equal(response.body.code,code);
  }
  assert.ok(!db.calls.slice(before).some(c=>/\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i.test(c.text)));
});
test('preview verifies target and participant and does not return financial data',async()=>{
  process.env.REBATE_POOL_103_ENABLED='true';process.env.REBATE_TICKET_PREVIEW_ENABLED='true';calls=[];
  const r=await app.call('POST','/api/rebate-pool/tickets/redemption-preview',{user:{sub:1,role:'ADMIN'},
    body:{bookingId:4,lineNo:1,requestedTonnage:'1.0000',expectedDatabase:'dbwins_worldfert9_uat_fz'}});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.readyForRedemption,false);
  assert.equal(r.body.quantityTon,'1.0000');assert.equal(r.body.ticketCount,1);
  assert.ok(!JSON.stringify(r.body).includes('secret'));assert.equal(calls[0],'participant');
  assert.equal(calls[1].startDate,'2026-01-01');
  assert.ok(!db.calls.some(c=>/INSERT|UPDATE|DELETE/i.test(c.text)));
});
test('a stale selected database never reaches booking proof',async()=>{
  calls=[];const r=await app.call('POST','/api/rebate-pool/tickets/redemption-preview',{user:{sub:1,role:'ADMIN'},
    body:{bookingId:4,lineNo:1,requestedTonnage:'1',expectedDatabase:'dbwins_worldfert2'}});
  assert.equal(r.status,409);assert.equal(r.body.code,'REBATE_TARGET_MISMATCH');assert.equal(calls.length,1);
});
test('redeem uses the configured treatment and verifies target before permitting a writer',async()=>{
  process.env.REBATE_POOL_103_ENABLED='true';
  const key='REBATE_TICKET_REDEMPTION_TREATMENT';
  const saved=process.env[key];
  process.env[key]='dbwins_worldfert9_uat_fz:ZERO';
  calls=[];
  const redeem=body=>app.call('POST','/api/rebate-pool/tickets/redeem',{user:{sub:1,role:'ADMIN'},body});
  const request={bookingId:4,lineNo:1,requestedTonnage:'1.0000',expectedDatabase:'dbwins_worldfert9_uat_fz',
    requestId:'d64a1c67-34a3-4b32-8aeb-737451068f51',startDate:'1900-01-01',verified:true};
  try {
    assert.equal((await redeem({...request,expectedDatabase:'dbwins_worldfert2'})).body.code,'REBATE_TARGET_MISMATCH');
    assert.equal((await redeem({...request,treatment:'DISCOUNT'})).body.code,'TICKET_TREATMENT_MISMATCH');
    assert.deepEqual(calls,[]);
    const response=await redeem(request);
    assert.equal(response.status,200);
    assert.deepEqual(response.body,{id:10,replayed:false});
    assert.deepEqual(calls[0].payload,{bookingId:4,lineNo:1,requestedTonnage:'1.0000',
      requestId:request.requestId,treatment:'ZERO'});
  } finally {
    if(saved===undefined)delete process.env[key];else process.env[key]=saved;
  }
});
