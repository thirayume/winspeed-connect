'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let unavailable=false;
const auth=require.resolve('../middleware/auth');
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user={sub:1,role:'ADMIN'};next();},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({text,inputs})=>{
  if(text.includes('SELECT 1 AS ok FROM wf.SalesTrip'))return [{ok:1}];
  if(text.includes('FROM wf.v_TripMember WHERE TripId'))return [];
  if(text.includes('SELECT TOP 5 a.*'))return [];
  if(text.includes('SELECT a.*, ru.DisplayName')){
    assert.match(text,/a\.CreatedAt >= @globalStartUtc/);
    return [{Id:2,CreatedAt:inputs.globalStartUtc,Status:'APPROVED'}];
  }
  return [];
});
const store=require('../services/global-data-window-store');
store.readGlobalDataWindow=async()=>{if(unavailable)throw Error('WINDOW_UNAVAILABLE');return require('../services/data-window').boundaries('2026-01-01');};
const approval=require('../services/trip-multi-cust-approval');
const members=[{CustId:'1',CustCode:'ONE'},{CustId:'2',CustCode:'TWO'}];
const fingerprint=approval.computeTripCustomerSnapshot(members).customerFingerprint;
const window=require('../services/data-window').boundaries('2026-01-01');
test('approval summary preserves current decision while hiding an old or undated decision record',async()=>{
  for(const flag of [0,null]){
    const summary=await approval.fetchTripMultiCustStatus({tripId:10,members,minCustomers:2,dataWindow:window,
      queryFn:async(_sql,params)=>{assert.equal(params.globalStartUtc.value.toISOString(),'2025-12-31T17:00:00.000Z');return {recordset:[{Id:5,Status:'APPROVED',CustomerFingerprint:fingerprint,WindowEligible:flag,ReasonText:'OLD SECRET'}]};}});
    assert.equal(summary.isApproved,true);assert.equal(summary.approvalStatus,'APPROVED');assert.equal(summary.latestApproval,null);assert.equal(summary.approvalHistoryHidden,true);
    assert.doesNotMatch(JSON.stringify(summary),/OLD SECRET/);
  }
});
test('approval exactly at cutoff is visible without leaking internal window marker',async()=>{
  const summary=await approval.fetchTripMultiCustStatus({tripId:10,members,minCustomers:2,dataWindow:window,
    queryFn:async()=>({recordset:[{Id:5,Status:'APPROVED',CustomerFingerprint:fingerprint,WindowEligible:1,ReasonText:'CURRENT'}]})});
  assert.equal(summary.latestApproval.reasonText,'CURRENT');assert.equal(summary.latestApproval.windowEligible,undefined);assert.equal(summary.approvalHistoryHidden,false);
});
let app;
test.before(async()=>{app=await h.startApp([['/api/trips','../../routes/trips']]);});
test.after(async()=>app.close());
test('history route applies UTC cutoff without filtering current approval state',async()=>{
  db.calls.length=0;const response=await app.call('GET','/api/trips/10/multi-cust-approval');assert.equal(response.status,200);
  const query=db.calls.find(c=>c.text.includes('SELECT a.*, ru.DisplayName'));assert.ok(query);assert.equal(query.inputs.globalStartUtc.toISOString(),'2025-12-31T17:00:00.000Z');
  assert.equal(response.body.history.length,1);assert.equal(response.body.history[0].id,2);
});
test('history fails closed when primary cutoff cannot be read',async()=>{
  unavailable=true;db.calls.length=0;try{const response=await app.call('GET','/api/trips/10/multi-cust-approval');assert.equal(response.status,500);assert.equal(db.calls.some(c=>c.text.includes('SELECT a.*, ru.DisplayName')),false);}finally{unavailable=false;}
});
