'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let currentUser;
const auth=require.resolve('../middleware/auth');
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=currentUser;next();},requireRole:()=> (_req,_res,next)=>next()}};
let unavailable=false;
const db=h.installDbStub(({text,inputs})=>{
 if(/FROM wf\.NativeApproverEmployeeHistory h/.test(text))return [
  {Id:1,CreatedAt:new Date('2025-12-31T16:59:59Z')},
  {Id:2,CreatedAt:new Date('2025-12-31T17:00:00Z')},
 ].filter(row=>row.CreatedAt>=inputs.globalStartUtc);
 if(/FROM dbo\.EMEmp e/.test(text))return [{EmpID:5,Listed:1,IsEnabled:1,ApprovalCount:1}];
 if(/SELECT EmpID FROM dbo\.EMEmp WHERE EmpID=@emp/.test(text))return [{EmpID:5}];
 if(/SELECT IsEnabled FROM wf\.NativeApproverEmployee/.test(text))return [{IsEnabled:1}];
 return [];
});
const windowPath=require.resolve('../services/global-data-window-store');
require.cache[windowPath].exports.readGlobalDataWindow=async()=>{
 if(unavailable)throw Error('unavailable');
 return require('../services/data-window').boundaries('2026-01-01');
};
let app;
test.before(async()=>{app=await h.startApp([['/api/native-approvers','../../routes/native-approvers']]);});
test.after(async()=>app.close());
test.beforeEach(()=>{unavailable=false;currentUser={sub:1,role:'ADMIN'};db.calls.length=0;});
test('history and approval count follow the Bangkok cutoff while current employee state stays visible',async()=>{
 const list=await app.call('GET','/api/native-approvers');
 assert.equal(list.status,200);assert.equal(list.body.data[0].enabled,true);assert.equal(list.body.data[0].approvalCount,1);
 const query=db.calls.find(x=>/FROM dbo\.EMEmp e/.test(x.text));
 assert.match(query.text,/d\.RecordedAt >= @globalStartUtc/);
 assert.equal(query.inputs.globalStartUtc.toISOString(),'2025-12-31T17:00:00.000Z');
 const history=await app.call('GET','/api/native-approvers/history');
 assert.deepEqual(history.body.data.map(x=>x.Id),[2]);
 assert.match(db.calls.find(x=>/FROM wf\.NativeApproverEmployeeHistory h/.test(x.text)).text,/h\.ChangedAt >= @globalStartUtc/);
});
test('missing global window fails closed without reading history or aggregate',async()=>{
 unavailable=true;
 assert.equal((await app.call('GET','/api/native-approvers')).status,503);
 assert.equal((await app.call('GET','/api/native-approvers/history')).status,503);
 assert.equal(db.calls.length,0);
});
test('approver writes record mapped effective and actor IDs and reject invalid binding',async()=>{
 currentUser={sub:22,actorSub:17,role:'ADMIN',isImpersonating:true,identityMapping:{primaryEffectiveUserId:22,primaryActorUserId:17,businessEffectiveUserId:34,businessActorUserId:47}};
 assert.equal((await app.call('PUT','/api/native-approvers/5',{body:{enabled:false}})).status,200);
 assert.equal((await app.call('POST','/api/native-approvers/batch-toggle',{body:{empIds:[5],enabled:false}})).status,200);
 const writes=db.calls.filter(x=>/INSERT INTO wf\.NativeApproverEmployeeHistory/.test(x.text));
 assert.equal(writes.length,2);for(const write of writes){assert.equal(write.inputs.user,34);assert.equal(write.inputs.actor,47);}
 db.calls.length=0;currentUser.identityMapping.primaryActorUserId=999;
 assert.equal((await app.call('PUT','/api/native-approvers/5',{body:{enabled:false}})).status,409);
 assert.equal((await app.call('POST','/api/native-approvers/batch-toggle',{body:{empIds:[5],enabled:false}})).status,409);
 assert.equal(db.calls.length,0);
});
