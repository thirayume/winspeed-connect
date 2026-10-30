'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('crypto');
require('./helpers/route-harness.cjs').installDbStub(()=>[]);
const {initialManualRedemption:service,manualRedemptionHttpError,POLICY}=require('../services/initial-manual-redemption');
const H=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const key='11111111-2222-4333-8444-555555555555';
const wh={sub:11,role:'WAREHOUSE'},acct={sub:22,role:'ACCOUNTING'},other={sub:33,role:'WAREHOUSE'},manager={sub:44,role:'MANAGER'};
function fixture(overrides={}){
 const calls=[],events=[];
 const state={applied:false,request:null,receipt:null,parts:Array.from({length:10},(_,i)=>i===4?'<row><CouponID>701</CouponID><RemaQty>1.0000</RemaQty><GoodQty>1.0000</GoodQty></row>':'delivery:'+i),
  accounts:[{Id:11,Role:'WAREHOUSE'},{Id:22,Role:'ACCOUNTING'},{Id:33,Role:'WAREHOUSE'},{Id:44,Role:'MANAGER'},{Id:99,Role:'ADMIN'}].map(r=>({...r,IsActive:1,MustChangePassword:0,EmpId:String(1000+r.Id)})),...overrides};
 state.parent={SourceSOID:501,DeliverySOID:601,DeliveryNo:'I69-00601',CouponID:701,CouponNo:'C6900701',ContainQty:50,SackQty:20,
  FinanceSOInvID:801,FinancePostID:901,FinanceVATID:1001,PolicyVersion:'O25-DO104-COMPLETE-UAT2-v2',
  SourceNo:'I69-00501',SourceAfterHash:H(['SOHD','SODT','SOHDRemark','SODTRemark'].map(t=>'source:'+t)),DeliveryAfterHash:H(state.parts)};
 const q=async(text,p)=>{
  calls.push({text,p});const rows=recordset=>({recordset});
  if(/SERVERPROPERTY/.test(text))return rows([{ServerName:'AMYOU-YOGA7\\V2008R2',DbName:state.dbName||'dbwins_worldfert9_uat2',DbId:10}]);
  if(/SELECT Id,Role,IsActive/.test(text))return rows(state.accounts);
  if(/sp_getapplock/.test(text))return rows([{LockResult:0}]);
  if(/AS InvoiceReceiptObject/.test(text))return rows([{InvoiceReceiptObject:null}]);
  if(/SELECT r\.\*,h.DocuNo AS SourceNo/.test(text))return rows([state.parent]);
  if(/SELECT Id, EmpId, PositionCode/.test(text))return rows([{Id:p.id.value,EmpId:'1001',PositionCode:null}]);
  if(/SELECT DocuNo,DocuType FROM dbo.SOHD/.test(text))return rows([{DocuNo:'I69-00601',DocuType:104}]);
  if(/AS CompleteCouponID/.test(text))return rows([{CompleteCouponID:701}]);
  if(/FOR XML RAW/i.test(text)){
   const table=/FROM dbo\.([a-z0-9_]+)/i.exec(text)?.[1];let value;
   if(table==='WFRedemtionHD'||table==='WFRedemtionDT')value='redemption:'+table+(state.redemptionChanged?':tampered':'');
   else if(p.soid?.value===501)value='source:'+table;
   else {const i=['SOHD','SODT','SOHDRemark','SODTRemark','WFCoupon','Define_104','SOInvHD','SOInvDT','VTVAT','SMSat'].indexOf(table);value=state.parts[i];}
   return rows([{Snapshot:value}]);
  }
  if(/SELECT c.GoodQty AS Qty/.test(text))return rows(state.applied?[]:[{Qty:1,CouponNo:'C6900701',DeliveryNo:'I69-00601'}]);
  if(/AS BusinessDate/.test(text))return rows([{BusinessDate:'2026-10-25'}]);
  if(/SELECT \* FROM wf.NativeManualRedemptionReceipt/.test(text))return rows(state.receipt?[state.receipt]:[]);
  if(/SELECT (?:TOP 1 )?\* FROM wf.NativeManualRedemptionRequest/.test(text))return rows(state.request?[state.request]:[]);
  if(/INSERT INTO wf.NativeManualRedemptionRequest/.test(text)){
   state.request={RequestId:p.request.value,SourceSOID:501,Fingerprint:p.fingerprint.value,DeliveryBeforeHash:p.before.value,
    RequestedById:p.user.value,RequesterActorId:p.actor.value,Reason:p.reason.value,IssueName:p.receiver.value,CarLicense:p.plate.value,
    Evidence:p.evidence.value,EvidenceMode:'UAT_SIMULATION',PolicyVersion:POLICY,Status:'PENDING'};return rows([]);
  }
  if(/AS ApproverEnabled FROM dbo.EMEmp/.test(text))return rows(p.emp.value===state.missingEmp?[]:[{EmpID:Number(p.emp.value),ApproverEnabled:p.emp.value===state.unlistedEmp?0:p.emp.value===state.unseededEmp?null:1}]);
  if(/SET Status='APPROVED'/.test(text)){
   Object.assign(state.request,{Status:'APPROVED',ApprovedById:p.user.value,ApproverActorId:p.actor.value,SelfApproval:p.self.value,ApprovedDataHash:p.datahash.value});return rows([]);
  }
  if(/EXEC wf.usp_CreateInitialManualRedemption/.test(text)){
   state.applied=true;state.request.Status='CONSUMED';state.parts[4]=state.parts[4].replace('RemaQty>1.0000','RemaQty>0.0000');
   if(state.financeDrift)state.parts[6]+='tampered';
   state.receipt={SourceSOID:501,RequestId:key,Fingerprint:p.fingerprint.value,DeliverySOID:601,CouponID:701,RedemptionID:801,RedemptionNo:'69081783',AppliedById:p.user.value,ApplierActorId:p.actor.value,DeliveryBeforeHash:state.parent.DeliveryAfterHash,ApprovedDataHash:state.request.ApprovedDataHash,PolicyVersion:POLICY};
   return rows([state.receipt]);
  }
  if(/SELECT d.RedemtionID/.test(text))return rows(state.badProof?[]:[{RedemtionID:801}]);
  if(/UPDATE wf.NativeDeliveryReceipt SET DeliveryAfterHash/.test(text)){
   if(state.postWriteFailure)throw new Error('private SQL connection data');
   state.parent.DeliveryAfterHash=p.after.value;Object.assign(state.receipt,{DeliveryAfterHash:p.after.value,RedemptionAfterHash:p.native.value});return rows([{Updated:1}]);
  }
  throw Error('Unknown fake query: '+text.slice(0,90));
 };
 const tx={request:()=>{const p={};return {input(k,type,value){p[k]={type,value};return this;},query:text=>q(text,p)};}};
 const transaction=async fn=>{const before=structuredClone(state);events.push('begin');try{const r=await fn(tx);events.push('commit');return r;}catch(e){Object.assign(state,before);events.push('rollback');throw e;}};
 const call=(operation,extra={})=>service({operation,soid:501,user:wh,...extra},{enabled:true,transaction});
 return {state,calls,events,call};
}
async function request(f,user=wh){const p=await f.call('preview',{user});const command={user,requestId:key,fingerprint:p.fingerprint,reason:'UAT simulation without a physical scale',receiver:'UAT2 TEST',plate:'UAT2-TEST'};await f.call('request',command);return command;}
async function approved(f,user=wh,approver=wh){const c=await request(f,user);await f.call('approve',{...c,user:approver});return c;}
test('manual116 is closed by default and refuses invalid IDs and simulation details',async()=>{
 await assert.rejects(service({soid:501},{enabled:false}),{code:'MR_NOT_ENABLED'});
 const f=fixture();await assert.rejects(f.call('preview',{soid:'1;DROP'}),{code:'MR_SOURCE_INVALID'});
 const p=await f.call('preview');await assert.rejects(f.call('request',{requestId:key,fingerprint:p.fingerprint,reason:'real delivery',receiver:'Real customer',plate:'REAL-1'}),{code:'MR_SIMULATION_DETAILS_REQUIRED'});
});
test('Warehouse and Account may self approve; another Warehouse or Account cannot approve',async()=>{
 for(const user of [wh,acct]){const f=fixture();await approved(f,user,user);assert.equal(f.state.request.SelfApproval,true);}
 for(const approver of [other,acct]){const f=fixture();const c=await request(f);await assert.rejects(f.call('approve',{...c,user:approver}),{code:'MR_APPROVAL_FORBIDDEN'});}
 const f=fixture();await approved(f,other,manager);assert.equal(f.state.request.SelfApproval,false);
});
test('Access As counts the actual person even with different effective requester and approver',async()=>{
 const f=fixture();await approved(f,{...wh,actorSub:99,actorRole:'ADMIN'},{...acct,actorSub:99,actorRole:'ADMIN'});assert.equal(f.state.request.SelfApproval,true);
 assert.equal(f.state.request.RequestedById,11);assert.equal(f.state.request.ApprovedById,22);assert.equal(f.state.request.RequesterActorId,99);
});
test('request/approval never mutate native data; apply before approval is blocked',async()=>{
 const f=fixture();const c=await request(f);await assert.rejects(f.call('apply',c),{code:'MR_APPROVAL_REQUIRED'});
 assert.equal(f.state.applied,false);assert.ok(!f.calls.some(c=>/EXEC wf.usp_CreateInitialManualRedemption/.test(c.text)));
});
test('apply advances only coupon remaining, keeps a before/after receipt and verifies replay',async()=>{
 const f=fixture();const c=await approved(f);const before=f.state.parent.DeliveryAfterHash;
 const first=await f.call('apply',c);assert.equal(first.physicalShipmentVerified,false);assert.equal(first.evidenceMode,'UAT_SIMULATION');assert.equal(first.replayed,false);
 assert.equal(f.state.receipt.DeliveryBeforeHash,before);assert.notEqual(f.state.parent.DeliveryAfterHash,before);
 assert.equal((await f.call('apply',c)).replayed,true);assert.equal((await f.call('preview')).completed,true);
 await assert.rejects(f.call('apply',{...c,fingerprint:'d'.repeat(64)}),{code:'MR_REQUEST_CONFLICT'});
 f.state.redemptionChanged=true;await assert.rejects(f.call('apply',c),{code:'MR_RECEIPT_DIVERGED'});
});
test('finance drift, bad native proof, or receipt update failure roll back the whole write',async()=>{
 for(const setting of ['financeDrift','badProof','postWriteFailure']){
  const f=fixture({[setting]:true});const c=await approved(f);const before=f.state.parent.DeliveryAfterHash;
  await assert.rejects(f.call('apply',c));assert.equal(f.state.applied,false);assert.equal(f.state.receipt,null);assert.equal(f.state.parent.DeliveryAfterHash,before);assert.equal(f.state.request.Status,'APPROVED');assert.equal(f.events.at(-1),'rollback');
 }
});
test('reason, receiver, plate or evidence cannot change after approval',async()=>{
 for(const field of ['Reason','IssueName','CarLicense','Evidence']){
  const f=fixture();const c=await approved(f);f.state.request[field]+='changed';await assert.rejects(f.call('apply',c),{code:'MR_REQUEST_CHANGED'});assert.equal(f.state.applied,false);
 }
});
test('revoked users, roles, mappings and a non-UAT target cannot reach native apply',async()=>{
 const f=fixture();const c=await approved(f);f.state.accounts[0].IsActive=0;await assert.rejects(f.call('apply',c),{code:'MR_ACTOR_UNAVAILABLE'});
 const x=fixture({missingEmp:'1044'});const r=await request(x);await assert.rejects(x.call('approve',{...r,user:manager}),{code:'MR_APPROVER_MAPPING_REQUIRED'});
 const p=fixture({dbName:'dbwins_worldfert9'});await assert.rejects(p.call('preview'),{code:'MR_TARGET_NOT_SUPPORTED'});
 const m=fixture();await assert.rejects(m.call('request',{user:manager,requestId:key,fingerprint:'a'.repeat(64),reason:'UAT simulation only',receiver:'UAT2 TEST',plate:'UAT2-1'}),{code:'MR_ROLE_FORBIDDEN'});
});
test('the requester must map to an employee, who becomes the native recorder',async()=>{
 const f=fixture({missingEmp:'1011'});const p=await f.call('preview');
 await assert.rejects(f.call('request',{requestId:key,fingerprint:p.fingerprint,reason:'UAT simulation without a physical scale',receiver:'UAT2 TEST',plate:'UAT2-TEST'}),{code:'MR_RECORDER_MAPPING_REQUIRED'});
 assert.equal(f.state.request,null);
 const g=fixture();const c=await approved(g,wh,manager);g.state.missingEmp='1011';
 await assert.rejects(g.call('apply',c),{code:'MR_RECORDER_MAPPING_REQUIRED'});assert.equal(g.state.applied,false);
});
test('only employees enabled in the approver list may approve',async()=>{
 for(const setting of ['unlistedEmp','unseededEmp']){
  const f=fixture({[setting]:'1044'});const c=await request(f);
  await assert.rejects(f.call('approve',{...c,user:manager}),{code:'MR_APPROVER_NOT_LISTED'});assert.equal(f.state.request.Status,'PENDING');
 }
 const f=fixture({unlistedEmp:'1044'});await approved(f,wh,wh);assert.equal(f.state.request.Status,'APPROVED');
});
test('native proof requires the recorder in SaveEmpID, no AppvEmpID and the wf approval row',async()=>{
 const f=fixture();const c=await approved(f,wh,manager);await f.call('apply',c);
 const proof=f.calls.find(x=>/SELECT d.RedemtionID/.test(x.text)).text;
 assert.match(proof,/h\.SaveEmpID=rec\.EmpID AND h\.AppvEmpID IS NULL/);
 assert.match(proof,/JOIN wf\.NativeDocumentApproval na ON na\.DocuType=116 AND na\.NativeDocID=h\.RedemtionID/);
 assert.match(proof,/na\.RecorderEmpID=rec\.EmpID[\s\S]*na\.ApproverEmpID=apv\.EmpID/);
 assert.doesNotMatch(proof,/h\.AppvEmpID=/);
});
test('public errors contain only fixed codes',()=>{
 assert.deepEqual(manualRedemptionHttpError(Error('private host password')),{status:503,code:'MR_FAILED'});
 assert.deepEqual(manualRedemptionHttpError(Error('MR_COUNTER_UNSUPPORTED')),{status:409,code:'MR_COUNTER_UNSUPPORTED'});
 assert.deepEqual(manualRedemptionHttpError(Error('MR_APPROVER_NOT_LISTED')),{status:409,code:'MR_APPROVER_NOT_LISTED'});
 assert.deepEqual(manualRedemptionHttpError(Error('MR_RECORDER_MAPPING_REQUIRED')),{status:409,code:'MR_RECORDER_MAPPING_REQUIRED'});
});
