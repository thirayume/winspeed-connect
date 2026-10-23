'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('crypto');
require('./helpers/route-harness.cjs').installDbStub(()=>[]);
const {initialDelivery,deliveryHttpError,POLICY}=require('../services/initial-delivery');
const {capabilitiesFor}=require('../services/role-capabilities');
const key='11111111-2222-4333-8444-555555555555';
const sales={sub:11,role:'SALES',actorSub:99,actorRole:'ADMIN'};
const account={sub:22,role:'ACCOUNTING',actorSub:99,actorRole:'ADMIN'};
const base=['SOHD','SODT','SOHDRemark','SODTRemark'].map(t=>'original:'+t);
const originalHash=createHash('sha256').update(JSON.stringify(base)).digest('hex');
function fixture(overrides={}) {
 const calls=[],events=[];
 const state={request:null,receipt:null,applied:false,sourceChanged:false,targetChanged:false,procCalls:0,
  accounts:[{Id:11,Role:'SALES',IsActive:true,MustChangePassword:false},
   {Id:22,Role:'ACCOUNTING',IsActive:true,MustChangePassword:false},{Id:99,Role:'ADMIN',IsActive:true,MustChangePassword:false}],...overrides};
 const q=async(text,p={})=>{
  calls.push({text,p});const rows=recordset=>({recordset});
  if(/SERVERPROPERTY/.test(text))return rows([{ServerName:'AMYOU-YOGA7\\V2008R2',DbName:state.dbName||'dbwins_worldfert9_uat2',DbId:10}]);
  if(/SELECT Id,Role,IsActive/.test(text))return rows(state.accounts);
  if(/sp_getapplock/.test(text))return rows([{LockResult:Object.hasOwn(state,'lockResult')?state.lockResult:0}]);
  if(/SELECT h.SOID/.test(text))return rows([{SOID:501,DocuNo:'TEST-I',AppvDocuNo:'TEST-AI',CustID:100,EmpID:state.owner===12?102:101,SalesUserId:state.owner??11}]);
  if(/SELECT Id, EmpId, PositionCode/.test(text))return rows([{Id:11,EmpId:'101',PositionCode:null}]);
  if(/SELECT \* FROM wf.NativeDeliveryReceipt/.test(text))return rows(state.receipt?[state.receipt]:[]);
  if(/SELECT Fingerprint,PolicyVersion/.test(text))return rows(state.origin===false?[]:[{Fingerprint:originalHash,PolicyVersion:'O11-AI-INITIAL-UAT2-v1'}]);
  if(/SELECT name FROM sys.columns/.test(text))return rows(['SOID','AppvFlag','AppvDocuNo','Appvid','AppvDate'].map(name=>({name})));
  if(/FOR XML RAW/.test(text)){
   const table=/FROM dbo\.([A-Za-z_]+)/.exec(text)?.[1];
   let value='credit:'+table;
   if(['SOHD','SODT','SOHDRemark','SODTRemark'].includes(table)){
    value='original:'+table;
    if(Number(p.soid?.value)===601)value='target:'+table+(state.targetChanged?':changed':'');
    else if(state.sourceChanged)value+=':tampered';
    else if(state.applied)value+=':consumed';
    else if(table==='SOHD'&&!/CAST\('W'/.test(text))value+=':approved';
   }
   if(['WFCoupon','Define_104'].includes(table))value='target:'+table;
   if(state.creditChanged && /EMCust|SOOption|SOInvHD|SOCredit/.test(text))value+=':credit-changed';
   return rows([{Snapshot:value}]);
  }
  if(/EXEC wf.usp_CreateInitialDelivery/.test(text)){
   if(/@Preview=1/.test(text)){if(state.previewError)throw new Error(state.previewError);return rows([{Amount:'18200.0000'}]);}
   state.procCalls++;if(state.procError)throw new Error(state.procError);
   state.applied=true;state.request.Status='CONSUMED';
   state.receipt={SourceSOID:501,RequestId:key,Fingerprint:p.fingerprint.value,DeliverySOID:601,DeliveryNo:'TEST-K',CouponID:701,
    AppliedById:p.user.value,ApplierActorId:p.actor.value,PolicyVersion:POLICY};
   return rows([state.receipt]);
  }
  if(/SELECT TOP 1 \* FROM wf.NativeDeliveryRequest/.test(text))return rows(state.request&&['PENDING','APPROVED'].includes(state.request.Status)?[state.request]:[]);
  if(/SELECT \* FROM wf.NativeDeliveryRequest/.test(text))return rows(state.request?.RequestId===p.request.value?[state.request]:[]);
  if(/INSERT INTO wf.NativeDeliveryRequest/.test(text)){
   state.request={SOID:501,RequestId:p.request.value,Fingerprint:p.fingerprint.value,RequestedById:p.user.value,
    RequesterActorId:p.actor.value,Status:'PENDING',PolicyVersion:POLICY};return rows([]);
  }
  if(/SET Status='APPROVED'/.test(text)){
   state.request={...state.request,Status:'APPROVED',ApprovedById:p.user.value,ApproverActorId:p.actor.value,
    SelfApproval:state.request.RequesterActorId===p.actor.value,Reason:p.reason.value,ExpiresAt:new Date(Date.now()+1800000)};
   return rows([]);
  }
  if(/INSERT INTO wf.SalesOrderAudit/.test(text)){if(state.auditError)throw new Error('private audit error');return rows([]);}
  if(/UPDATE wf.NativeDeliveryReceipt/.test(text)){
   if(state.postWriteError)throw new Error('private post-write fingerprint failure');
   Object.assign(state.receipt,{SourceAfterHash:p.sourceHash.value,DeliveryAfterHash:p.deliveryHash.value});return rows([]);
  }
  if(/SELECT TOP 50/.test(text))return rows([{soid:501}]);
  throw new Error('Unrecognized fixture query: '+text.slice(0,60));
 };
 const tx={request:()=>{const p={};return{input(k,type,value){p[k]={type,value};return this;},query:text=>q(text,p)};}};
 const transaction=async fn=>{const saved=structuredClone(state);events.push('begin');try{const r=await fn(tx);events.push('commit');return r;}catch(e){Object.assign(state,saved);events.push('rollback');throw e;}};
 const call=(operation,extra={})=>initialDelivery({operation,soid:501,user:sales,...extra},{enabled:true,transaction});
 return{state,calls,events,call};
}
async function request(f,user=sales){const p=await f.call('preview',{user});await f.call('request',{user,requestId:key,fingerprint:p.fingerprint});return{user,requestId:key,fingerprint:p.fingerprint};}
async function approved(f,user=sales){const p=await request(f,user);await f.call('approve',{...p,user:account,reason:'UAT approved credit'});return p;}

test('delivery and credit capabilities remain hidden and service closed by default',async()=>{
 const saved=process.env.NATIVE_DELIVERY_104_ENABLED;delete process.env.NATIVE_DELIVERY_104_ENABLED;
 try{assert.ok(!capabilitiesFor('ACCOUNTING').actions.includes('credit.approve-native'));await assert.rejects(initialDelivery({operation:'preview',soid:501,user:sales}),{code:'DO_NOT_ENABLED'});}
 finally{if(saved===undefined)delete process.env.NATIVE_DELIVERY_104_ENABLED;else process.env.NATIVE_DELIVERY_104_ENABLED=saved;}
});
test('preview reconstructs original AI fingerprint, reads exact amount, and performs no writes or allocation',async()=>{
 const f=fixture();const p=await f.call('preview');assert.equal(p.amount,'18200.0000');assert.equal(p.requiresCreditApproval,true);
 assert.match(p.fingerprint,/^[a-f0-9]{64}$/);assert.equal(p.request,null);assert.ok(f.calls.some(c=>/CAST\('W'/.test(c.text)));
 assert.ok(!f.calls.some(c=>/\b(?:UPDATE|INSERT|DELETE)\b/.test(c.text)));assert.equal(f.state.procCalls,0);
});
test('request UUID replay creates one request and one audit; request cannot itself create104',async()=>{
 const f=fixture();const command=await request(f);const before=f.calls.length;
 assert.equal((await f.call('request',command)).status,'PENDING');assert.equal(f.state.procCalls,0);
 assert.ok(!f.calls.slice(before).some(c=>/INSERT|UPDATE/.test(c.text)));
 await assert.rejects(f.call('apply',command),{code:'DO_CREDIT_APPROVAL_REQUIRED'});
});
test('Account self-approval counts the actual actor during Access As; request/approval identities are retained',async()=>{
 const f=fixture();await approved(f,account);const r=f.state.request;
 assert.equal(r.RequestedById,22);assert.equal(r.RequesterActorId,99);assert.equal(r.ApprovedById,22);assert.equal(r.ApproverActorId,99);assert.equal(r.SelfApproval,true);
});
test('different effective request/approver but same actual person is still self approval',async()=>{
 const f=fixture();await approved(f);assert.equal(f.state.request.RequestedById,11);assert.equal(f.state.request.ApprovedById,22);assert.equal(f.state.request.SelfApproval,true);
});
test('approved requester creates104 once; same operation replays with verified source and delivery footprints',async()=>{
 const f=fixture();const command=await approved(f);const first=await f.call('apply',command),again=await f.call('apply',command);
 assert.equal(first.deliveryNo,'TEST-K');assert.equal(first.replayed,false);assert.equal(again.replayed,true);assert.equal(first.shipmentReady,false);assert.equal(f.state.procCalls,1);
 assert.equal(f.state.request.Status,'CONSUMED');f.state.targetChanged=true;
 await assert.rejects(f.call('apply',command),{code:'DO_RECEIPT_DIVERGED'});assert.equal(f.state.procCalls,1);
});
test('changed source or credit invalidates preview and approval before any native apply',async()=>{
 for(const kind of ['source','credit']){const f=fixture();const command=await approved(f);f.state[kind+'Changed']=true;
  await assert.rejects(f.call('apply',command),{code:kind==='source'?'DO_SOURCE_CHANGED':'DO_PREVIEW_STALE'});assert.equal(f.state.procCalls,0);}
});
test('credit approval cannot be reused by another operator or for a different request',async()=>{
 const f=fixture();const command=await approved(f);
 await assert.rejects(f.call('apply',{...command,user:account}),{code:'DO_CREDIT_APPROVAL_REQUIRED'});
 await assert.rejects(f.call('apply',{...command,requestId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}),{code:'DO_REQUEST_CONFLICT'});
 assert.equal(f.state.procCalls,0);
});
test('another authorized user cannot supersede the request owner',async()=>{
 const f=fixture();const command=await request(f);
 await assert.rejects(f.call('request',{...command,user:account,requestId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}),{code:'DO_REQUEST_OWNED_BY_ANOTHER'});
 assert.equal(f.state.request.RequestedById,11);
});
test('SALES cannot approve credit; actual/effective disabled or stale roles fail before mutations',async()=>{
 const f=fixture();const command=await request(f);
 await assert.rejects(f.call('approve',{...command,reason:'not authorized'}),{code:'DO_ROLE_FORBIDDEN'});
 for(const mutate of [s=>{s.accounts[2].IsActive=false;},s=>{s.accounts[0].MustChangePassword=true;},s=>{s.accounts[0].Role='MANAGER';}]){
  const x=fixture();mutate(x.state);await assert.rejects(x.call('preview'),e=>['DO_ACTOR_UNAVAILABLE','DO_ROLE_CHANGED'].includes(e.code));assert.equal(x.state.procCalls,0);}
});
test('scope uses effective user, not the senior Access As actor',async()=>{
 const f=fixture({owner:12});await assert.rejects(f.call('preview'),{code:'DO_SOURCE_NOT_FOUND',status:404});assert.equal(f.state.procCalls,0);
});
test('target, absent locks and insufficient Access As rank fail closed',async()=>{
 for(const [overrides,code] of [[{dbName:'foreign'},'DO_TARGET_NOT_SUPPORTED'],[{lockResult:null},'DO_BUSY'],[{lockResult:-1},'DO_BUSY']]){
  const f=fixture(overrides);await assert.rejects(f.call('preview'),{code});assert.equal(f.state.procCalls,0);
 }
 const f=fixture();f.state.accounts[2].Role='APPROVER';
 await assert.rejects(f.call('preview',{user:{...account,actorRole:'APPROVER'}}),{code:'DO_ACCESS_AS_FORBIDDEN'});
});
test('unsupported credit/expired decision errors propagate and post-write failure reaches transaction owner',async()=>{
 const f=fixture({previewError:'DO_CREDIT_CONTRACT_UNSUPPORTED'});await assert.rejects(f.call('preview'));assert.equal(f.state.procCalls,0);
 const x=fixture();const command=await approved(x);x.state.procError='DO_CREDIT_APPROVAL_REQUIRED';await assert.rejects(x.call('apply',command));assert.equal(x.state.applied,false);
 x.state.procError=null;x.state.postWriteError=true;await assert.rejects(x.call('apply',command));assert.equal(x.state.applied,false);assert.equal(x.state.receipt,null);assert.equal(x.events.at(-1),'rollback');
 assert.deepEqual(deliveryHttpError(new Error('private connection string and password')),{status:503,code:'DO_FAILED'});
 assert.deepEqual(deliveryHttpError(new Error('DO_CREDIT_APPROVAL_REQUIRED')),{status:409,code:'DO_CREDIT_APPROVAL_REQUIRED'});
});
test('audit failure rolls back request creation; malformed commands cannot begin transactions',async()=>{
 const f=fixture({auditError:true});const p=await f.call('preview');await assert.rejects(f.call('request',{requestId:key,fingerprint:p.fingerprint}));assert.equal(f.state.request,null);
 const before=f.events.length;
 await assert.rejects(f.call('apply',{soid:'501x',requestId:key,fingerprint:p.fingerprint}),{code:'DO_SOURCE_ID_INVALID'});
 await assert.rejects(f.call('apply',{soid:2147483648,requestId:key,fingerprint:p.fingerprint}),{code:'DO_SOURCE_ID_INVALID'});
 await assert.rejects(f.call('approve',{user:account,requestId:key,fingerprint:p.fingerprint,reason:'x'}),{code:'DO_REASON_REQUIRED'});
 assert.equal(f.events.length,before);
});
