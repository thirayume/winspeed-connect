'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
h.installDbStub(()=>[],{activeUserIds:h.TEST_USERS});
function replace(path,exports){const p=require.resolve(path);require(p);require.cache[p].exports=exports;}
let generation=1,calls=0;
replace('../services/rebate-route-fence',{withRebateRouteFence:fn=>fn({environment:'uat',generation,
  resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}),routeParticipantFence:async()=>{},isShipmentEpoch:e=>e.generation>0});
replace('../services/rebate-cycle-policy',{readRebateCycleMonths:async()=>12});
replace('../services/rebate-shipment-queue',{getShipmentCustomerQueue:async(_q,options)=>{
  calls++;assert.equal(options.custId,123);assert.equal(options.cutoff,'2026-01-01');
  assert.equal(options.epoch.generation,1);return {totalFifoEligibleBalance:100,openingEligibleBalance:50};
}});
let app,old;
test.before(async()=>{old=process.env.REBATE_POOL_103_ENABLED;process.env.REBATE_POOL_103_ENABLED='true';
  app=await h.startApp([['/api/rebate-pool','../../routes/rebate-pool']]);});
test.after(async()=>{await app.close();if(old===undefined)delete process.env.REBATE_POOL_103_ENABLED;else process.env.REBATE_POOL_103_ENABLED=old;});
test('new queue calls only the scoped, fenced shipment source',async()=>{
  const r=await app.call('GET','/api/rebate-pool/queue/123?asOfDate=2026-11-14',{user:{sub:1,role:'ADMIN'}});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.openingEligibleBalance,50);assert.equal(calls,1);
});
test('a reset not completed or a user without amount access cannot read the queue',async()=>{
  generation=0;
  let r=await app.call('GET','/api/rebate-pool/queue/123',{user:{sub:1,role:'ADMIN'}});
  assert.equal(r.status,409);assert.equal(r.body.code,'REBATE_RESET_NOT_COMPLETED');assert.equal(calls,1);
  generation=1;
  r=await app.call('GET','/api/rebate-pool/queue/123',{user:{sub:2,role:'SALES'}});
  assert.equal(r.status,403);assert.equal(calls,1);
});
