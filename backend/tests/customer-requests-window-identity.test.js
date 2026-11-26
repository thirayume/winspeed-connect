'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let user,unavailable,managerTeam;
const auth=require.resolve('../middleware/auth');
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;next();},requireRole:()=> (_req,_res,next)=>next(),requireCapability:()=> (_req,_res,next)=>next()}};
const db=h.installDbStub(({text,inputs})=>{
 if(/SELECT Id, EmpId, PositionCode FROM wf.AppUser/.test(text))return [{Id:inputs.id,EmpId:String(inputs.id),PositionCode:managerTeam&&inputs.id===34?'QA-MANAGER':null}];
 if(/SELECT PositionCode,ReportsTo,RecordScope,IsActive/.test(text))return [{PositionCode:'QA-MANAGER',RecordScope:'ORG',IsActive:1}];
 if(/WITH tree AS/.test(text))return [{Id:34,EmpId:'34'},{Id:47,EmpId:'47'}];
 if(/FROM wf\.CustomerRequest cr/.test(text)){
  let rows=[{Id:1,RequestedBy:34,CreatedAt:new Date('2025-12-31T16:59:59Z')},
   {Id:2,RequestedBy:34,CreatedAt:new Date('2025-12-31T17:00:00Z')},
   {Id:3,RequestedBy:47,CreatedAt:new Date('2026-01-01T00:00:00Z')},
   {Id:4,RequestedBy:59,CreatedAt:new Date('2026-01-01T00:00:00Z')}];
  rows=rows.filter(x=>x.CreatedAt>=inputs.globalStartUtc);
  const groups=new Map();for(const [key,value] of Object.entries(inputs)){const match=/^(customerRequest\d+)U\d+$/.exec(key);if(match){if(!groups.has(match[1]))groups.set(match[1],[]);groups.get(match[1]).push(value);}}
  for(const ids of groups.values())rows=rows.filter(x=>ids.includes(x.RequestedBy));
  if(/\b1=0\b/.test(text))return [];
  return rows;
 }
 return [];
});
const windowPath=require.resolve('../services/global-data-window-store');
require.cache[windowPath].exports.readGlobalDataWindow=async()=>{if(unavailable)throw Error('missing');return require('../services/data-window').boundaries('2026-01-01');};
let app;
test.before(async()=>{app=await h.startApp([['/api/master','../../routes/master']]);});
test.after(async()=>app.close());
test.beforeEach(()=>{user={sub:34,role:'SALES'};unavailable=false;managerTeam=false;db.calls.length=0;});
test('request history hides earlier records and uses the Bangkok UTC boundary',async()=>{
 const r=await app.call('GET','/api/master/customer-requests');assert.equal(r.status,200);assert.deepEqual(r.body.map(x=>x.Id),[2]);
 const call=db.calls.find(c=>/FROM wf\.CustomerRequest cr/.test(c.text));
 assert.equal(call.inputs.globalStartUtc.toISOString(),'2025-12-31T17:00:00.000Z');assert.equal(call.inputs.customerRequest0U0,34);
});
test('multi-role managers see own and descendant requests while hiding another branch',async()=>{
 managerTeam=true;user={sub:34,role:'SALES',roles:['SALES','MANAGER']};const r=await app.call('GET','/api/master/customer-requests');
 assert.equal(r.status,200);assert.deepEqual(r.body.map(x=>x.Id),[2,3]);
});
test('Access As scopes by mapped business IDs and intersects actor privileges',async()=>{
 user={sub:22,actorSub:17,role:'SALES',actorRole:'ADMIN',actorRoles:['ADMIN'],isImpersonating:true,
  identityMapping:{primaryEffectiveUserId:22,primaryActorUserId:17,businessEffectiveUserId:34,businessActorUserId:47}};
 let r=await app.call('GET','/api/master/customer-requests');assert.equal(r.status,200);assert.deepEqual(r.body.map(x=>x.Id),[2]);
 let q=db.calls.find(c=>/FROM wf\.CustomerRequest cr/.test(c.text));assert.equal(q.inputs.customerRequest0U0,34);
 user.role='ADMIN';user.actorRole='SALES';user.actorRoles=['SALES'];db.calls.length=0;
 r=await app.call('GET','/api/master/customer-requests');assert.equal(r.status,200);assert.deepEqual(r.body.map(x=>x.Id),[3]);
 q=db.calls.find(c=>/FROM wf\.CustomerRequest cr/.test(c.text));assert.equal(q.inputs.customerRequest0U0,47);assert.equal(q.inputs.customerRequest1U0,47);
});
test('unavailable cutoff or invalid mapping fails closed before reading requests',async()=>{
 unavailable=true;assert.equal((await app.call('GET','/api/master/customer-requests')).status,503);assert.equal(db.calls.length,0);
 unavailable=false;user={sub:22,actorSub:17,role:'SALES',isImpersonating:true,identityMapping:{primaryEffectiveUserId:22,primaryActorUserId:999,businessEffectiveUserId:34,businessActorUserId:47}};
 assert.equal((await app.call('GET','/api/master/customer-requests')).status,409);assert.equal(db.calls.length,0);
});
