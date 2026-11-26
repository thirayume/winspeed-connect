'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const principal={sub:8,actorSub:17,role:'ADMIN',actorRole:'ADMIN',isImpersonating:true,identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:17,businessEffectiveUserId:28,businessActorUserId:37}};
let state,ready,failAuditAt,deniedId;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=principal;require('../services/request-context').runWithUser(principal,next);},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({kind,text,inputs,proc})=>{
 if(/OBJECT_ID\('wf\.sp_MasterUpdateCustomer'/.test(text)&&/sp_MasterCustomerClassification/.test(text))return [{Ready:ready?1:0}];
 if(/SELECT TOP 1 1 AS ok FROM dbo\.EMCust c WITH/.test(text))return state.rows[String(inputs.visibilityCustId)]&&String(inputs.visibilityCustId)!==deniedId?[{ok:1}]:[];
 if(/SELECT c\.CustID,c\.CustName,c\.ContTel/.test(text)){const row=state.rows[String(inputs.id)];return row?[structuredClone(row)]:[];}
 if(/SELECT u\.Id,u\.DisplayName,u\.EmpId FROM wf\.AppUser/.test(text)){assert.equal(kind,'tx');assert.match(text,/employee\.EmpStatus='1'/);return [{Id:5,DisplayName:'Synthetic',EmpId:77}];}
 if(proc==='wf.sp_MasterUpdateCustomer'){const row=state.rows[String(inputs.CustID)];if(inputs.CustName!=null)row.CustName=inputs.CustName;return {output:{Affected:1}};}
 if(proc==='wf.sp_MasterCustomerClassification'){const row=state.rows[String(inputs.CustID)];if(inputs.HasBillEmp)row.BillEmp=inputs.BillEmp;if(inputs.HasGroup)row.CustGroupID=inputs.GroupId;return {output:{Affected:1}};}
 if(/IF EXISTS \(SELECT 1 FROM wf\.CustomerExt WHERE CustId = @id\)/.test(text)){const row=state.rows[String(inputs.id)];if(inputs.hasSp)row.SalespersonUserId=inputs.spUserId;if(inputs.hasGroup)row.ExtCustGroupId=inputs.groupIdStr;return [];}
 if(/MERGE wf\.CreditMaster/.test(text)){const row=state.rows[String(inputs.id)];if(inputs.hasCreditLimit)row.CreditLimit=inputs.creditLimit;if(inputs.creditHold!==undefined)row.CreditHold=inputs.creditHold;return [];}
 if(/INSERT INTO wf\.ChangeEvent/.test(text)){assert.equal(kind,'tx');if(failAuditAt && state.events.length+1===failAuditAt)throw Error('AUDIT_FAILED');state.events.push(inputs);return {rowsAffected:[1]};}
 return [];
});
db.stub.wfTransaction=async(fn,opts)=>{assert.equal(opts.isolationLevel,db.stub.sql.ISOLATION_LEVEL.SERIALIZABLE);const before=structuredClone(state);try{return await fn(db.tx);}catch(e){state=before;throw e;}};
require('../services/request-context').hasColumn=async()=>true;
let app;test.before(async()=>{app=await h.startApp([['/api/master','../../routes/master']]);});test.after(async()=>app.close());
test.beforeEach(()=>{state={rows:{'1':{CustID:1,CustName:'One',BillEmp:null},'2':{CustID:2,CustName:'Two',BillEmp:null}},events:[]};ready=true;failAuditAt=0;deniedId=null;});
test('single update rolls back native, extension and audit together and maps salesperson to WinSpeed employee',async()=>{
 failAuditAt=1;let r=await app.call('PATCH','/api/master/customers/1',{body:{CustName:'New',salespersonId:5,CreditLimit:100}});assert.equal(r.status,500);assert.equal(state.rows['1'].CustName,'One');assert.equal(state.rows['1'].BillEmp,null);assert.equal(state.events.length,0);
 failAuditAt=0;r=await app.call('PATCH','/api/master/customers/1',{body:{CustName:'New',salespersonId:5,CreditLimit:100}});assert.equal(r.status,200);assert.equal(state.rows['1'].BillEmp,77);assert.equal(state.rows['1'].SalespersonUserId,5);assert.equal(state.events[0].userId,'28');assert.equal(state.events[0].actorUserId,'37');assert.equal(JSON.parse(state.events[0].beforeJson).CustName,'One');assert.equal(JSON.parse(state.events[0].afterJson).CustName,'New');
});
test('batch is all-or-nothing when second customer audit fails or second customer is outside scope',async()=>{
 const body={custIds:[1,2],salespersonUserId:5};failAuditAt=2;let r=await app.call('POST','/api/master/customers/batch-edit',{body});assert.equal(r.status,500);assert.equal(state.rows['1'].BillEmp,null);assert.equal(state.rows['2'].BillEmp,null);assert.equal(state.events.length,0);
 failAuditAt=0;deniedId='2';r=await app.call('POST','/api/master/customers/batch-edit',{body});assert.equal(r.status,404);assert.equal(state.rows['1'].BillEmp,null);assert.equal(state.events.length,0);
 deniedId=null;r=await app.call('POST','/api/master/customers/batch-edit',{body});assert.equal(r.status,200);assert.equal(state.rows['1'].BillEmp,77);assert.equal(state.rows['2'].BillEmp,77);assert.equal(state.events.length,2);
});
test('missing migration and invalid or duplicate batch IDs reject before changes',async()=>{
 ready=false;let r=await app.call('PATCH','/api/master/customers/1',{body:{CustName:'New'}});assert.equal(r.status,503);assert.equal(state.rows['1'].CustName,'One');
 ready=true;r=await app.call('POST','/api/master/customers/batch-edit',{body:{custIds:[1,1],creditHold:true}});assert.equal(r.status,400);assert.equal(state.events.length,0);
});
test('customer reassignment rejects invalid IDs and a manager outside the selected owner branch',async()=>{
 const original=structuredClone(state);
 for(const salespersonUserId of [-1,0,1.5,'bogus']){
  assert.equal((await app.call('POST','/api/master/customers/batch-edit',{body:{custIds:[1],salespersonUserId}})).status,400);
  assert.deepEqual(state,original);
 }
 principal.role='MANAGER';
 try{
  const start=db.calls.length;
  assert.equal((await app.call('POST','/api/master/customers/batch-edit',{body:{custIds:[1],salespersonUserId:5}})).status,404);
  assert.deepEqual(state,original);
  assert.ok(db.calls.slice(start).some(c=>c.kind==='tx'&&c.text.includes('SELECT Id, EmpId, PositionCode')));
  assert.ok(!db.calls.slice(start).some(c=>c.proc==='wf.sp_MasterCustomerClassification'));
 }finally{principal.role='ADMIN';}
});
