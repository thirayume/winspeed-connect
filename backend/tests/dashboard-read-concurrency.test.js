'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let database='uat',stats=0,aging=0;
const db=h.installDbStub(async({text})=>{
  if(text.includes('SELECT Status, COUNT(*) AS Cnt')) {stats++;await new Promise(r=>setTimeout(r,50));return [{Status:'DRAFT',Cnt:database==='uat'?3:7}];}
  if(text.includes('WITH BaseCandidateSo')) {aging++;await new Promise(r=>setTimeout(r,50));return [{WfRef:database==='uat'?'fixture-uat':'fixture-prod'}];}
  return [];
},{activeUserIds:[1]});
db.stub.getDbName=()=>database;
let app;
test.before(async()=>{app=await h.startApp([['/api/so','../../routes/so'],['/api/master','../../routes/master']]);});
test.after(async()=>{await app.close();});
test('actual dashboard routes collapse cold request bursts and isolate databases',async()=>{
  const user={sub:1,role:'ADMIN'};
  for(const [lane,total] of [['uat',3],['prod',7]]){
    database=lane;
    const rows=await Promise.all(Array.from({length:12},()=>app.call('GET','/api/so/stats',{user})));
    for(const row of rows){assert.equal(row.status,200);assert.equal(row.body.total,total);}
    const old=aging;const reports=await Promise.all(Array.from({length:12},()=>app.call('GET','/api/master/aging',{user})));
    for(const row of reports){assert.equal(row.status,200);assert.equal(row.body[0].WfRef,'fixture-'+lane);}
    assert.equal(aging-old,1);
  }
  assert.equal(stats,2);assert.equal(aging,2);
});
