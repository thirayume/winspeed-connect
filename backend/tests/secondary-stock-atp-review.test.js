'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
const auth=require.resolve('../middleware/auth');
let user,authorized,failWindow;
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{
  requireAuth:(req,_res,next)=>{req.user=user;next();},
  requireRole:()=> (_req,_res,next)=>next(),requireCapability:()=> (_req,_res,next)=>next()}};
const db=h.installDbStub(({text,inputs})=>{
  const hierarchy=require('./helpers/ownership-hierarchy.cjs').ownershipHierarchy(text,inputs);if(hierarchy)return hierarchy;
  if(/SELECT TOP 1 1 AS ok FROM wf\.SalesOrder o/.test(text))return authorized?[{ok:1}]:[];
  if(/FROM wf\.OperationalStock s/.test(text))return [{GoodId:'TEST-GOOD',WarehouseId:'-',GoodName:'Test',QtyOnHand:10,Unit:'ตัน',Source:'MANUAL',AsOf:new Date()}];
  if(/STOCK_FRESHNESS_DAYS/.test(text))return [{SettingValue:'7'}];
  if(/FROM dbo\.SOHD hd/.test(text))return [];
  if(/FROM wf\.SalesOrderLine l/.test(text))return [{GoodCode:'TEST-GOOD',DraftReservedQty:Number(inputs.exSo)===99?0:8}];
  return [];
});
const win=require.resolve('../services/global-data-window-store');require.cache[win].exports.readGlobalDataWindow=async()=>{
 if(failWindow)throw Error('missing window');return require('../services/data-window').boundaries('2026-01-01');};
let app;test.before(async()=>{app=await h.startApp([['/api/stock','../../routes/stock']]);});test.after(async()=>app.close());
test.beforeEach(()=>{authorized=false;failWindow=false;db.calls.length=0;user={sub:8,actorSub:17,role:'SALES',actorRole:'SALES',isImpersonating:true,
 identityMapping:{primaryActorUserId:17,primaryEffectiveUserId:8,businessActorUserId:47,businessEffectiveUserId:34}};});
test('unowned or missing bill cannot be excluded on secondary',async()=>{
 const baseline=await app.call('GET','/api/stock/atp?goodCode=TEST-GOOD');assert.equal(baseline.body.data[0].totalAvailable,2);
 db.calls.length=0;const r=await app.call('GET','/api/stock/atp?goodCode=TEST-GOOD&excludeSoId=99');
 assert.equal(r.status,404);assert.equal(r.body.code,'ATP_EXCLUSION_NOT_FOUND');assert.equal(db.calls.some(c=>/OperationalStock/.test(c.text)),false);
 const q=db.calls.find(c=>/SELECT TOP 1 1 AS ok FROM wf\.SalesOrder o/.test(c.text));
 assert.equal(q.inputs.atpSoId,99);assert.equal(q.inputs.atpEffectiveU0,34);assert.equal(q.inputs.atpActorU0,47);
 assert.match(q.text,/o\.CreatedAt>=@atpStartUtc/);assert.match(q.text,/o\.Status IN \('DRAFT','SUBMITTED','PRICE_APPROVED'\)/);
});
test('allowed current bill may be excluded only after both identities and cutoff are checked',async()=>{
 authorized=true;const r=await app.call('GET','/api/stock/atp?goodCode=TEST-GOOD&excludeSoId=99');
 assert.equal(r.status,200);assert.equal(r.body.data[0].totalAvailable,10);
 assert.equal(db.calls.find(c=>/FROM wf\.SalesOrderLine l/.test(c.text)).inputs.exSo,99);
});
test('trip exclusion on secondary fails closed even with an otherwise visible bill',async()=>{
 authorized=true;const r=await app.call('GET','/api/stock/atp?goodCode=TEST-GOOD&excludeSoId=99&excludeTripId=77');
 assert.equal(r.status,409);assert.equal(r.body.code,'ATP_SECONDARY_TRIP_EXCLUSION_UNAVAILABLE');assert.equal(db.calls.length,0);
});
test('invalid ID, bad identity mapping and missing cutoff cannot reach stock data',async()=>{
 for(const id of ['0','2147483648','abc','1e2']){db.calls.length=0;const r=await app.call('GET',`/api/stock/atp?excludeSoId=${id}`);assert.equal(r.status,400,id);assert.equal(db.calls.length,0);}
 user.identityMapping.primaryActorUserId=999;db.calls.length=0;assert.equal((await app.call('GET','/api/stock/atp?excludeSoId=99')).status,409);assert.equal(db.calls.some(c=>/OperationalStock/.test(c.text)),false);
 user.identityMapping.primaryActorUserId=17;failWindow=true;db.calls.length=0;const r=await app.call('GET','/api/stock/atp?excludeSoId=99');assert.equal(r.status,503);assert.equal(r.body.code,'SECONDARY_ATP_UNAVAILABLE');assert.ok(!JSON.stringify(r.body).includes('missing window'));assert.equal(db.calls.some(c=>/OperationalStock/.test(c.text)),false);
});
