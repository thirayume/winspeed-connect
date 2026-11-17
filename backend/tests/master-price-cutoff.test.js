'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let user={sub:1,role:'ADMIN'},unavailable=false;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;next();},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({text,inputs})=>{
 if(text.includes('FROM dbo.EMSetPriceHD hd WITH')){
  const rows=[{SetPriceID:1,BeginDate:'2025-01-01',EndDate:null},{SetPriceID:2,BeginDate:'2025-01-01',EndDate:'2025-12-31'},{SetPriceID:3,BeginDate:'2025-12-01',EndDate:'2026-01-01'}];
  return rows.filter(r=>!r.EndDate||r.EndDate>=inputs.globalStartDate);
 }
 return [];
});
const windowPath=require.resolve('../services/global-data-window-store');require.cache[windowPath].exports.readGlobalDataWindow=async()=>{if(unavailable)throw Error('missing');return require('../services/data-window').boundaries('2026-01-01');};
let app;test.before(async()=>{app=await h.startApp([['/api/master','../../routes/master']]);});test.after(async()=>app.close());test.beforeEach(()=>{db.calls.length=0;unavailable=false;});
test('expired price list applies cutoff while retaining configurations still effective across the boundary',async()=>{
 const r=await app.call('GET','/api/master/prices?includeExpired=true');assert.equal(r.status,200);assert.deepEqual(r.body.map(x=>x.SetPriceID),[1,3]);const call=db.calls.find(c=>c.text.includes('FROM dbo.EMSetPriceHD hd WITH'));assert.match(call.text,/hd\.EndDate IS NULL OR hd\.EndDate >= @globalStartDate/);assert.equal(call.inputs.globalStartDate,'2026-01-01');
});
test('all users cannot request pre-cutoff or invalid price dates',async()=>{
 for(const date of ['2025-12-31','2026-02-30']){const r=await app.call('GET','/api/master/prices?asOf='+date);assert.equal(r.status,400);assert.ok(!db.calls.some(c=>c.text.includes('FROM dbo.EMSetPriceHD hd WITH')));}
 const r=await app.call('GET','/api/master/prices?asOf=2026-01-01');assert.equal(r.status,200);
});
test('price history fails closed when cutoff is unavailable',async()=>{unavailable=true;const r=await app.call('GET','/api/master/prices');assert.equal(r.status,503);assert.ok(!db.calls.some(c=>c.text.includes('FROM dbo.EMSetPriceHD hd WITH')));});
