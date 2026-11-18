'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,actorSub:17,role:'MANAGER',actorRole:'MANAGER',isImpersonating:true,identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:17,businessEffectiveUserId:28,businessActorUserId:37}};
const auth=require.resolve('../middleware/auth');
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;require('../services/request-context').runWithUser(user,next);},requireRole:()=>((_req,_res,next)=>next())}};
let audits=0, writes=0;
const db=h.installDbStub(({kind,text,inputs})=>{
 if(text.includes("COL_LENGTH('wf.ChangeEvent'"))return [{HasCol:1}];
 if(text.includes('FROM wf.RuleIncident i WITH'))return [{Id:1,SOID:101,SalesUserId:50,SourceVisible:1},{Id:2,SOID:102,SalesUserId:51,SourceVisible:1},{Id:3,SOID:null,SourceVisible:1},{Id:4,SOID:103,SalesUserId:50,SourceVisible:0,DocuNo:'OLD-REFERENCE',Detail:'OLD-SECRET'}];
 if(text.includes('SELECT * FROM wf.RuleIncident'))return inputs.id===2?[{Id:2,SOID:102}]:inputs.id===4?[{Id:4,SOID:103,DocuNo:'OLD-REFERENCE',Detail:'OLD-SECRET',IncidentKey:'OLD-KEY'}]:[{Id:1,SOID:101}];
 if(text.includes('SELECT h.EmpID, e.SalesUserId'))return [{SalesUserId:inputs.s===102?51:50,SourceVisible:inputs.s===103?0:1}];
 if(text.includes('UPDATE i SET Status')&&text.includes('FROM wf.RuleIncident i')){
  assert.equal(kind,'tx');assert.match(text,/incidentEffectiveU0/);assert.match(text,/incidentActorU0/);
  const owner=inputs.id===2?51:50;const eff=[inputs.incidentEffectiveU0,inputs.incidentEffectiveU1];const actor=[inputs.incidentActorU0];
  const allowed=eff.includes(owner)&&actor.includes(owner);if(allowed)writes++;return [{Affected:allowed?1:0}];
 }
 if(text.includes('INSERT INTO wf.ChangeEvent')){audits++;assert.equal(inputs.userId,'28');assert.equal(inputs.actorUserId,'37');return [];}
 return [];
});
const scopePath=require.resolve('../services/visible-scope'),scope=require('../services/visible-scope');
require.cache[scopePath].exports={...scope,getVisibleScope:async u=>({all:false,userIds:require('../services/business-identity').businessIds(u).effective===28?[50,51]:[50],empIds:[]})};
let app;test.before(async()=>{app=await h.startApp([['/api/incidents','../../routes/incidents']]);});test.after(async()=>app.close());test.beforeEach(()=>{audits=0;writes=0;});
test('list and detail intersect the effective and real actor scopes',async()=>{
 const list=await app.call('GET','/api/incidents');assert.equal(list.status,200);assert.deepEqual(list.body.map(x=>x.Id),[1,3,4]);
 const blocked=await app.call('GET','/api/incidents/2');assert.equal(blocked.status,404);
});
test('recent incidents hide old source references in list and detail and search SQL',async()=>{
 const list=await app.call('GET','/api/incidents?search=OLD');const old=list.body.find(x=>x.Id===4);assert.equal(old.SourceHidden,true);assert.equal(old.DocuNo,null);assert.equal(old.Detail,null);assert.equal(old.SOID,null);
 const call=db.calls.findLast(c=>c.text.includes('FROM wf.RuleIncident i WITH'));assert.match(call.text,/h\.DocuDate >= @globalStartDate/);assert.match(call.text,/AND \(i\.DocuNo LIKE @search OR i\.Detail LIKE @search\)/);
 const detail=await app.call('GET','/api/incidents/4');assert.equal(detail.status,200);assert.equal(detail.body.SourceHidden,true);assert.equal(detail.body.DocuNo,null);assert.equal(detail.body.IncidentKey,null);assert.equal(detail.body.Detail,null);
});
test('ack checks both scopes in the write and records both mapped IDs',async()=>{
 let r=await app.call('PATCH','/api/incidents/2/ack',{body:{note:'Reviewed item'}});assert.equal(r.status,409);assert.equal(writes,0);assert.equal(audits,0);
 r=await app.call('PATCH','/api/incidents/1/ack',{body:{note:'Reviewed item'}});assert.equal(r.status,200);assert.equal(writes,1);assert.equal(audits,1);
});
