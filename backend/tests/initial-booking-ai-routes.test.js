'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db=h.installDbStub(({text,inputs}) => /SELECT \* FROM wf.v_AllSalesOrders WHERE/.test(text)
  ? [{Id:inputs.id,Status:'CONFIRMED'}] : [], { activeUserIds: [11, 99] });
const calls = [];
const service = require.resolve('../services/initial-booking-ai');
require.cache[service] = { id: service, filename: service, loaded: true, exports: {
  captureBookingOrigin: async () => false,
  assertInitialAiShipmentReady: async id => {
    if(Number(id)===501)throw Object.assign(new Error('AI_DOWNSTREAM_NOT_READY'),{code:'AI_DOWNSTREAM_NOT_READY',status:409});
  },
  initialBookingAi: async c => { calls.push(c); return { approvalNo: 'TEST-AI', replayed: false }; },
  aiHttpError: () => ({ status: 503, code: 'AI_APPROVAL_FAILED' }),
} };
let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so']]); });
test.after(async () => { await app.close(); });
test('native AI permits the approved roles and preserves actual/effective actor context', async () => {
  for (const role of ['SALES','COUNTER_SALES','MANAGER','C_LEVEL','ADMIN']) {
    const user = { sub: 11, role, actorSub: 99, actorRole: 'ADMIN' };
    assert.equal((await app.call('GET','/api/so/501/native-ai/preview',{user})).status,200);
    assert.equal(calls.at(-1).preview,true);
    assert.equal(calls.at(-1).user.actorSub,99); assert.equal(calls.at(-1).user.sub,11);
    assert.equal((await app.call('POST','/api/so/501/native-ai',{user,body:{fingerprint:'test',requestId:'test'}})).status,200);
    assert.equal(calls.at(-1).fingerprint,'test'); assert.equal(calls.at(-1).soid,'501');
  }
});
test('ACCOUNTING and operational roles gain no AI permission from the separate credit policy', async () => {
  for (const role of ['ACCOUNTING','WAREHOUSE','WEIGHBRIDGE','APPROVER']) {
    const before=calls.length;
    for (const method of ['GET','POST']) {
      const path='/api/so/501/native-ai'+(method==='GET'?'/preview':'');
      assert.equal((await app.call(method,path,{user:{sub:11,role},body:method==='POST'?{}:undefined})).status,403);
    }
    assert.equal(calls.length,before);
  }
});
test('missing and disabled real/effective accounts cannot reach the approval service', async () => {
  for (const user of [undefined,{sub:12,role:'ADMIN'},{sub:11,role:'SALES',actorSub:12,actorRole:'ADMIN'}]) {
    const before=calls.length;
    assert.equal((await app.call('POST','/api/so/501/native-ai',{user,body:{}})).status,401);
    assert.equal(calls.length,before);
  }
});
test('pilot shipment is blocked before extension/rebate/outbox mutation',async()=>{
  const before=db.calls.length;
  const r=await app.call('PATCH','/api/so/501/ship',{user:{sub:11,role:'WAREHOUSE'},body:{}});
  assert.equal(r.status,409);assert.equal(r.body.code,'AI_DOWNSTREAM_NOT_READY');
  assert.ok(!db.calls.slice(before).some(c=>/\b(?:UPDATE|INSERT|DELETE|MERGE)\b/i.test(c.text)));
});
test('non-pilot shipments still require the original loading state',async()=>{
  const r=await app.call('PATCH','/api/so/502/ship',{user:{sub:11,role:'WAREHOUSE'},body:{}});
  assert.equal(r.status,400);assert.match(r.body.message,/LOADED/);
});
