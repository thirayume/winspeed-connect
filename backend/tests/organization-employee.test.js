'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let state,auditFailure=false;
const db=h.installDbStub(({text,inputs,kind})=>{
 assert.doesNotMatch(text,/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?dbo\./i);
 if(text.includes('ExpectedSnapshot'))return state.profile?[state.profile]:[];
 if(text.includes('EXEC wf.sp_OrganizationSaveEmployee')){
  assert.equal(kind,'tx');
  if(inputs.expected!==(state.profile?.ExpectedSnapshot||'')||!!inputs.create!==!state.profile)throw Error('EMPLOYEE_PROFILE_CHANGED');
  state.profile={EmpID:501,EmpCode:inputs.code,EmpName:inputs.name,EmpTitle:inputs.title,HeadCode:inputs.headCode,ExpectedSnapshot:'QA-'+inputs.name};
  return [{EmployeeId:501}];
 }
 if(text.includes('SELECT Id,DisplayName FROM wf.AppUser'))return state.linked;
 if(text.includes('UPDATE wf.AppUser SET DisplayName'))state.linked.find(u=>u.Id===inputs.id).DisplayName=inputs.name;
 return [];
});
const database={...db.stub,getDbName:()=> 'qa_org',wfTransaction:async fn=>{const before=structuredClone(state);try{return await fn(db.tx);}catch(e){state=before;throw e;}}};
const p=require.resolve('../services/policy-contract');require.cache[p]={id:p,filename:p,loaded:true,exports:{logChangeEvent:async(tx,event)=>{assert.equal(tx,db.tx);if(auditFailure)throw Error('QA_AUDIT_FAILURE');state.audits.push(event);}}};
const employee=require('../services/organization-employee'),admin={sub:99,role:'ADMIN'};
const input=()=>({code:'QA-EMP-001',name:'QA Employee',title:'QA',headCode:'QA-HEAD',expectedSnapshot:state.profile?.ExpectedSnapshot||'',create:!state.profile,expectedDatabase:'qa_org',reason:'QA employee correction',syncLinkedName:true});
test.beforeEach(()=>{state={profile:null,linked:[{Id:10,DisplayName:'QA old'}],audits:[]};auditFailure=false;db.calls.length=0;});
test('native employee creation and linked display name use the native procedure and one audited transaction',async()=>{
 const result=await employee.save(database,admin,input());assert.equal(result.created,true);assert.equal(result.data.EmpID,501);assert.equal(state.linked[0].DisplayName,'QA Employee');assert.equal(state.audits.length,1);
 const q=db.calls.find(c=>c.text.includes('EXEC wf.sp_OrganizationSaveEmployee'));assert.equal(q.inputs.actor,99);assert.equal(q.inputs.code,'QA-EMP-001');
});
test('stale metadata or account audit failure rolls back every change',async()=>{
 await employee.save(database,admin,input());const before=structuredClone(state);
 await assert.rejects(employee.save(database,admin,{...input(),expectedSnapshot:'STALE'}),e=>e.status===409);assert.deepEqual(state,before);
 auditFailure=true;await assert.rejects(employee.save(database,admin,{...input(),name:'QA Changed'}),/QA_AUDIT_FAILURE/);assert.deepEqual(state,before);
});
test('a manager, Access As, changed database or malformed native code cannot write',async()=>{
 for(const user of [{sub:10,role:'MANAGER'},{...admin,actorSub:10,actorRole:'ADMIN',isImpersonating:true}])await assert.rejects(employee.save(database,user,input()),e=>e.status===403);
 await assert.rejects(employee.save(database,admin,{...input(),expectedDatabase:'another'}),e=>e.status===409);
 await assert.rejects(employee.save(database,admin,{...input(),code:'X;DELETE'}),e=>e.status===400);
 assert.equal(db.calls.length,0);
});
