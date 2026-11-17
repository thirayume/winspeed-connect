'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,actorSub:17,role:'ADMIN',roles:['ADMIN'],actorRole:'MANAGER',actorRoles:['MANAGER'],isImpersonating:true,identityMapping:{primaryActorUserId:17,primaryEffectiveUserId:8,businessActorUserId:55,businessEffectiveUserId:34}};
let actorAll=false,effectiveAll=true,memberHit=false;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;next();},requireCapability:()=>((_req,_res,next)=>next()),requireRole:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({text})=>{
 if(/SELECT pa.RequestedBy, so.SalesUserId/.test(text))return [{RequestedBy:34,SalesUserId:34}];
 if(/SELECT a.TripId, a.RequestedBy, st.CreatedBy/.test(text))return [{TripId:10,RequestedBy:34,TripCreatedBy:34}];
 if(/SELECT TOP 1 1 AS ok FROM wf\.v_TripMember/.test(text))return memberHit?[{ok:1}]:[];
 return [];
});
const scope=require.resolve('../services/visible-scope');const original=require(scope);require.cache[scope].exports={...original,getVisibleScope:async u=>{const id=require('../services/business-identity').businessIds(u).effective;return {all:id===55?actorAll:effectiveAll,userIds:[id],empIds:[]};}};
const trip=require.resolve('../services/trip-multi-cust-approval');const originalTrip=require(trip);require.cache[trip].exports={...originalTrip,canUserApproveMultiCustTrip:async()=>({allowed:true})};
let app;test.before(async()=>{app=await h.startApp([['/api/edit-requests','../../routes/edit-requests']]);});test.after(async()=>app.close());
test.beforeEach(()=>{actorAll=false;effectiveAll=true;memberHit=false;db.calls.length=0;});
for(const [path,table] of [['price-approvals','pa'],['trip-approvals','a']])test(`${path} list constrains actual actor when impersonated user sees all`,async()=>{const r=await app.call('GET',`/api/edit-requests/${path}`);assert.equal(r.status,200);const c=db.calls.find(c=>c.text.includes(`SELECT ${table}.*`));assert.ok(c);assert.ok(Object.entries(c.inputs).some(([k,v])=>k.includes('_actor')&&v===55));assert.ok(!Object.keys(c.inputs).some(k=>k.includes('_effective')));});
for(const path of ['price-approvals','trip-approvals'])test(`${path} action refuses actor outside scope before reading target`,async()=>{const r=await app.call('PATCH',`/api/edit-requests/${path}/5/reject`,{body:{note:'synthetic reason'}});assert.equal(r.status,404);assert.ok(!db.calls.some(c=>/SELECT \* FROM wf\.(PriceApproval|TripMultiCustomerApproval)/.test(c.text)));});
test('both restricted scopes are present in the price list query',async()=>{effectiveAll=false;const r=await app.call('GET','/api/edit-requests/price-approvals');assert.equal(r.status,200);const c=db.calls.find(c=>c.text.includes('SELECT pa.*'));assert.ok(Object.entries(c.inputs).some(([k,v])=>k.includes('_actor')&&v===55));assert.ok(Object.entries(c.inputs).some(([k,v])=>k.includes('_effective')&&v===34));});

for(const [path,alias] of [['price-approvals','pa'],['trip-approvals','a']])test(`${path} mine filters by mapped business user`,async()=>{const r=await app.call('GET',`/api/edit-requests/${path}?mine=1`);assert.equal(r.status,200);const c=db.calls.find(c=>c.text.includes(`SELECT ${alias}.*`));assert.equal(c.inputs.me,34);});

test('price approval list requires its source order within cutoff',async()=>{const r=await app.call('GET','/api/edit-requests/price-approvals');assert.equal(r.status,200);const c=db.calls.find(c=>c.text.includes('SELECT pa.*'));assert.match(c.text,/pa\.CreatedAt >= @globalStartUtc AND so\.CreatedAt >= @globalStartUtc/);});
