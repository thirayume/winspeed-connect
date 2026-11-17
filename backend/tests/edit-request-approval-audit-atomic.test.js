'use strict';const test=require('node:test');const assert=require('node:assert/strict');const h=require('./helpers/route-harness.cjs');
let requestRow,unlocked,audits,failAudit,failHold,reasonActive;
const db=h.installDbStub(({kind,text,inputs})=>{
 if(/SELECT 1 AS ok FROM wf\.EditRequest/.test(text))return [{ok:1}];
 if(/SELECT \* FROM wf\.EditRequest WHERE Id/.test(text))return [{...requestRow}];
 if(/SELECT \* FROM wf\.EditRequest WITH \(UPDLOCK,HOLDLOCK\)/.test(text)){assert.equal(kind,'tx');return [{...requestRow}];}
 if(/FROM\s+dbo\.SOHD s[\s\S]*JOIN\s+dbo\.EMCust/.test(text))return [{SOID:'54321',DocuNo:'QA'}];
 if(/FROM dbo\.WGHD/.test(text))return [{Rows:0}];
 if(/FROM wf\.EditReason WHERE ReasonCode/.test(text))return [{ReasonCode:'QA',ReasonText:'QA',AppliesTo:'CONFIRMED',RequiresHold:0}];
 if(/FROM wf\.EditReason WITH \(UPDLOCK,HOLDLOCK\)/.test(text)){assert.equal(kind,'tx');return [{ReasonCode:'QA',AppliesTo:'CONFIRMED',RequiresHold:0,IsActive:reasonActive?1:0}];}
 if(/SELECT TOP 1 Id FROM wf\.EditRequest WITH \(UPDLOCK,HOLDLOCK\)/.test(text)){assert.equal(kind,'tx');return [];}
 if(/INSERT INTO wf\.EditRequest/.test(text)){assert.equal(kind,'tx');requestRow={Id:2,SOID:'54321',Status:'PENDING',RequestedBy:19};return [{Id:2}];}
 if(/UPDATE wf\.EditRequest SET Status='APPROVED'/.test(text)){assert.equal(kind,'tx');requestRow.Status='APPROVED';return {rowsAffected:[1]};}
 if(/UPDATE wf\.EditRequest SET Status=@status/.test(text)){assert.equal(kind,'tx');requestRow.Status=inputs.status;return {rowsAffected:[1]};}
 if(/UPDATE wf\.SalesOrderExt SET IsUnlocked=1/.test(text)){assert.equal(kind,'tx');unlocked=true;return {rowsAffected:[1]};}
 if(/COL_LENGTH\('wf\.ChangeEvent'/.test(text))return [{HasCol:1}];
 if(/INSERT INTO wf\.ChangeEvent/.test(text)){assert.equal(kind,'tx');if(failAudit)throw Error('AUDIT_FAILED');audits.push(inputs);return {rowsAffected:[1]};}
 return [];
},{activeUserIds:h.TEST_USERS});
db.stub.wfTransaction=async fn=>{const old=structuredClone({requestRow,unlocked,audits});try{return await fn(db.tx);}catch(e){requestRow=old.requestRow;unlocked=old.unlocked;audits=old.audits;throw e;}};
for(const [path,exports] of [['../services/native-status',{findIssuedDelivery:async()=>null}],['../services/truck-hold',{releaseHold:async()=>{if(failHold)throw Error('HOLD_RELEASE_FAILED');}}]]){const p=require.resolve(path);require.cache[p]={id:p,filename:p,loaded:true,exports};}
let app;test.before(async()=>{app=await h.startApp([['/api/edit-requests','../../routes/edit-requests']]);});test.after(async()=>app.close());
test.beforeEach(()=>{requestRow={Id:1,SOID:'54321',Status:'PENDING',RequestedBy:12,HoldTruck:0};unlocked=false;audits=[];failAudit=false;failHold=false;reasonActive=true;});
test('approval, unlock and actor audit commit or roll back together',async()=>{
 failAudit=true;const options={user:{sub:19,role:'ADMIN'},body:{note:'QA'}};let r=await app.call('PATCH','/api/edit-requests/1/approve',options);assert.equal(r.status,500);assert.equal(requestRow.Status,'PENDING');assert.equal(unlocked,false);assert.equal(audits.length,0);
 failAudit=false;r=await app.call('PATCH','/api/edit-requests/1/approve',options);assert.equal(r.status,200);assert.equal(requestRow.Status,'APPROVED');assert.equal(unlocked,true);assert.equal(audits[0].action,'APPROVE');
});
test('approval stays committed with a visible warning if external hold release fails',async()=>{
 requestRow.HoldTruck=1;failHold=true;const r=await app.call('PATCH','/api/edit-requests/1/approve',{user:{sub:19,role:'ADMIN'},body:{}});assert.equal(r.status,200);assert.equal(requestRow.Status,'APPROVED');assert.match(r.body.holdReleaseWarning,/ปลด Hold ไม่สำเร็จ/);
});
test('request creation and audit roll back together',async()=>{
 failAudit=true;const options={user:{sub:19,role:'ADMIN'},body:{soid:54321,reasonCode:'QA'}};let r=await app.call('POST','/api/edit-requests',options);assert.equal(r.status,500);assert.equal(requestRow.Id,1);assert.equal(audits.length,0);
 failAudit=false;r=await app.call('POST','/api/edit-requests',options);assert.equal(r.status,200);assert.equal(requestRow.Id,2);assert.equal(audits[0].action,'CREATE');
});
test('request is rejected if its reason was deactivated before the transaction lock',async()=>{
 reasonActive=false;const r=await app.call('POST','/api/edit-requests',{user:{sub:19,role:'ADMIN'},body:{soid:54321,reasonCode:'QA'}});
 assert.equal(r.status,409);assert.equal(requestRow.Id,1);assert.deepEqual(audits,[]);
});
for(const [action,status,uid] of [['reject','REJECTED',19],['cancel','CANCELLED',12]]) test(`${action} and audit roll back together`,async()=>{
 failAudit=true;const options={user:{sub:uid,role:'ADMIN'},body:{note:'test reason'}};let r=await app.call('PATCH',`/api/edit-requests/1/${action}`,options);assert.equal(r.status,500);assert.equal(requestRow.Status,'PENDING');assert.equal(audits.length,0);
 failAudit=false;r=await app.call('PATCH',`/api/edit-requests/1/${action}`,options);assert.equal(r.status,200);assert.equal(requestRow.Status,status);assert.equal(audits[0].action,action.toUpperCase());
});
