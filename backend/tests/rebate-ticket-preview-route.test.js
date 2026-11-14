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
