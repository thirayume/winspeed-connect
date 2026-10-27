'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('crypto');
require('./helpers/route-harness.cjs').installDbStub(()=>[]);
const {initialInvoice:service,invoiceHttpError,POLICY}=require('../services/initial-invoice');
const {verifyCompleted}=require('../services/initial-manual-redemption');
const H=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const key='11111111-2222-4333-8444-555555555555',acct={sub:22,role:'ACCOUNTING'};
function fixture(overrides={}){
 const calls=[],events=[];
 const state={applied:false,receipt:null,cost:'unchanged stock',invoice:['h107','d107','sat107','stock107'],
  parts:Array.from({length:10},(_,i)=>i===1?'<row><RemaQty>1.0000</RemaQty><GoodAmnt>18200.0000</GoodAmnt></row>':'delivery:'+i),
  cut:['<row><DocuStatus>N</DocuStatus><SumGoodQty>1.0000</SumGoodQty></row>','<row><RemaQty>1.0000</RemaQty><PostInv>N</PostInv><SOInvID xsi:nil="true" /><SOListNo xsi:nil="true" /></row>'],
  accounts:[{Id:11,Role:'WAREHOUSE'},{Id:22,Role:'ACCOUNTING'},{Id:44,Role:'MANAGER'},{Id:99,Role:'ADMIN'}].map(r=>({...r,IsActive:1,MustChangePassword:0})),...overrides};
 state.parent={SourceSOID:501,DeliverySOID:601,DeliveryNo:'I69-00601',CouponID:701,CouponNo:'C6900701',ContainQty:50,SackQty:20,
  FinanceSOInvID:801,FinancePostID:901,FinanceVATID:1001,PolicyVersion:'O25-DO104-COMPLETE-UAT2-v2',
  SourceNo:'I69-00501',SourceAfterHash:H(['SOHD','SODT','SOHDRemark','SODTRemark'].map(t=>'source:'+t)),DeliveryAfterHash:H(state.parts)};
 state.request={RequestId:key,Status:'CONSUMED',Reason:'UAT simulation',IssueName:'UAT2 TEST',CarLicense:'UAT2-TEST',EvidenceMode:'UAT_SIMULATION',Evidence:'{}'};
 state.request.ApprovedDataHash=H(['UAT simulation','UAT2 TEST','UAT2-TEST','UAT_SIMULATION','{}']);
 state.manual={SourceSOID:501,DeliverySOID:601,CouponID:701,RedemptionID:1001,RedemptionNo:'69081783',RequestId:key,
  PolicyVersion:'O25-116-MANUAL-UAT2-v1',ApprovedDataHash:state.request.ApprovedDataHash,DeliveryAfterHash:H(state.parts),RedemptionAfterHash:H(state.cut)};
 const rows=recordset=>({recordset});
 const q=async(text,p={})=>{
  calls.push({text,p});
  if(/SERVERPROPERTY/.test(text))return rows([{ServerName:'AMYOU-YOGA7\\V2008R2',DbName:state.dbName||'dbwins_worldfert9_uat2',DbId:10}]);
  if(/SELECT Id,Role,IsActive/.test(text))return rows(state.accounts);
  if(/sp_getapplock/.test(text))return rows([{LockResult:0}]);
  if(/SELECT r\.\*,h.DocuNo AS SourceNo/.test(text))return rows([state.parent]);
  if(/SELECT Id, EmpId, PositionCode/.test(text))return rows([{Id:p.id.value,EmpId:'1001',PositionCode:null}]);
  if(/SELECT DocuNo,DocuType FROM dbo.SOHD/.test(text))return rows([{DocuNo:'I69-00601',DocuType:104}]);
  if(/AS CompleteCouponID/.test(text))return rows([{CompleteCouponID:701}]);
  if(/AS InvoiceReceiptObject/.test(text))return rows([{InvoiceReceiptObject:1}]);
  if(/SELECT \* FROM wf.NativeInitialInvoiceReceipt/.test(text))return rows(state.receipt?[state.receipt]:[]);
  if(/SELECT \* FROM wf.NativeManualRedemptionReceipt/.test(text))return rows(state.noManual?[]:[state.manual]);
  if(/SELECT \* FROM wf.NativeManualRedemptionRequest/.test(text))return rows([state.request]);
  if(/AS DueDate/.test(text))return rows([{DueDate:'2026-11-14',CreditDays:20}]);
  if(/EXEC wf.usp_PostInitialCouponInvoice/.test(text)){
   if(/@Preview=1/.test(text)){
    if(p.date.value&&p.date.value!=='2026-10-25')throw Error('IP_DATE_OVERRIDE_UNVERIFIED');
    return rows([{InvoiceSeries:'J',Amount:'18200.0000',Qty:'1.0000',GoodID:1094,InveID:1000,InvoiceDate:'2026-10-25'}]);
   }
   state.applied=true;
   state.parts[1]=state.parts[1].replace('RemaQty>1.0000','RemaQty>0.0000');
   state.cut[0]=state.cut[0].replace('DocuStatus>N','DocuStatus>Y');
   state.cut[1]=state.cut[1].replace('RemaQty>1.0000','RemaQty>0.0000').replace('PostInv>N','PostInv>Y').replace('<SOInvID xsi:nil="true" />','<SOInvID>2001</SOInvID>').replace('<SOListNo xsi:nil="true" />','<SOListNo>1</SOListNo>');
   if(state.financeDrift)state.parts[6]+='changed';
   if(state.costDrift)state.cost+='changed';
   if(state.cutDrift)state.cut[0]+='changed';
   state.receipt={SourceSOID:501,RequestId:key,Fingerprint:p.fingerprint.value,DeliverySOID:601,RedemptionID:1001,InvoiceID:2001,InvoiceNo:'J69-02001',InvoiceDate:new Date('2026-10-25T00:00:00Z'),GlobalID:3001,StockDetailID:4001,AppliedById:p.user.value,ApplierActorId:p.actor.value,
    DeliveryBeforeHash:state.parent.DeliveryAfterHash,RedemptionBeforeHash:state.manual.RedemptionAfterHash,PolicyVersion:POLICY};return rows([state.receipt]);
  }
  if(/FOR XML RAW/.test(text)){
   const table=/FROM dbo\.([a-z0-9_]+)/i.exec(text)?.[1];let value;
   if(/WHERE GoodID=@good/.test(text))value=table==='ICStockDetail'?state.cost:'';
   else if(table==='WFRedemtionHD'||table==='WFRedemtionDT')value=state.cut[table==='WFRedemtionHD'?0:1];
   else if(p.soid?.value===501)value='source:'+table;
   else if(p.soid?.value===601){const i=['SOHD','SODT','SOHDRemark','SODTRemark','WFCoupon','Define_104','SOInvHD','SOInvDT','VTVAT','SMSat'].indexOf(table);value=state.parts[i];}
   else if(p.id?.value===2001)value=state.invoice[['SOInvHD','SOInvDT','SMSat','ICStockDetail'].indexOf(table)];
   else value='config:'+table+(state.configDrift?':changed':'');
   return rows([{Snapshot:value}]);
  }
  if(/UPDATE wf.NativeDeliveryReceipt SET DeliveryAfterHash/.test(text)){
   if(state.postWriteFailure)throw Error('private sql credentials');
   state.parent.DeliveryAfterHash=p.after.value;
   Object.assign(state.receipt,{DeliveryAfterHash:p.after.value,RedemptionAfterHash:p.cut.value,InvoiceAfterHash:p.invoice.value});return rows([{Updated:1}]);
  }
  throw Error('Unknown fake query: '+text.slice(0,90));
 };
 const tx={request:()=>{const p={};return {input(k,type,value){p[k]={type,value};return this;},query:text=>q(text,p)};}};
 const transaction=async fn=>{const before=structuredClone(state);events.push('begin');try{const r=await fn(tx);events.push('commit');return r;}catch(e){Object.assign(state,before);events.push('rollback');throw e;}};
 const call=(operation,extra={})=>service({operation,soid:501,user:acct,...extra},{enabled:true,transaction,verifyMetadata:async()=>{if(state.metadataChanged)throw Error('IP_METADATA_UNSUPPORTED');}});
 return {state,calls,events,call,q};
}
async function command(f,user=acct){const p=await f.call('preview',{user});return {user,requestId:key,fingerprint:p.fingerprint,invoiceDate:p.invoiceDate};}
test('107 stays closed by default, pins UAT2 and requires a valid request',async()=>{
 await assert.rejects(service({soid:501},{enabled:false}),{code:'IP_NOT_ENABLED'});
 const f=fixture();await assert.rejects(f.call('preview',{soid:'1;DROP'}),{code:'IP_SOURCE_INVALID'});
 await assert.rejects(f.call('apply',{requestId:'x',fingerprint:'x',invoiceDate:'2026-10-25'}),{code:'IP_REQUEST_INVALID'});
 await assert.rejects(fixture({dbName:'production'}).call('preview'),{code:'IP_TARGET_NOT_SUPPORTED'});
});
test('only effective ACCOUNTING may post; live identity and Access As authority are rechecked',async()=>{
 for(const user of [{sub:11,role:'WAREHOUSE'},{sub:44,role:'MANAGER'},{sub:99,role:'ADMIN'}])await assert.rejects(fixture().call('preview',{user}),{code:'IP_ACCOUNT_REQUIRED'});
 const f=fixture();const c=await command(f);f.state.accounts[1].IsActive=0;await assert.rejects(f.call('apply',c),{code:'IP_ACTOR_UNAVAILABLE'});
 const x=fixture();const user={...acct,actorSub:99,actorRole:'ADMIN'};const cmd=await command(x,user);await x.call('apply',cmd);assert.equal(x.state.receipt.ApplierActorId,99);
 const a=fixture();await assert.rejects(a.call('preview',{user:{...acct,actorSub:11,actorRole:'WAREHOUSE'}}),{code:'IP_ACCESS_AS_FORBIDDEN'});
});
test('preview binds actor, native settings and cut date; no native writes occur',async()=>{
 const f=fixture(),c=await command(f);assert.equal(f.state.applied,false);
 f.state.configDrift=true;await assert.rejects(f.call('apply',c),{code:'IP_PREVIEW_STALE'});
 const x=fixture(),d=await command(x);await assert.rejects(x.call('apply',{...d,invoiceDate:'2026-10-26'}),/IP_DATE_OVERRIDE_UNVERIFIED/);
 x.state.metadataChanged=true;await assert.rejects(x.call('apply',d),/IP_METADATA_UNSUPPORTED/);
 await assert.rejects(fixture({noManual:true}).call('preview'),{code:'IP_MANUAL_116_REQUIRED'});
});
test('post creates one107 and preserves116 history; replay and authorized continuation are verified',async()=>{
 const f=fixture(),c=await command(f),before=structuredClone(f.state.manual);
 const first=await f.call('apply',c);assert.equal(first.replayed,false);assert.equal(first.invoiceNo,'J69-02001');assert.equal(first.physicalShipmentVerified,false);
 assert.deepEqual(f.state.manual,before);await verifyCompleted(f.q,f.state.parent,f.state.manual);
 assert.equal((await f.call('apply',c)).replayed,true);assert.equal((await f.call('preview')).completed,true);
 assert.equal(f.calls.filter(c=>/EXEC wf.usp_PostInitialCouponInvoice/.test(c.text)&&/@Preview=0/.test(c.text)).length,1);
 await assert.rejects(f.call('apply',{...c,requestId:'11111111-2222-4333-8444-666666666666'}),{code:'IP_REQUEST_CONFLICT'});
 f.state.invoice[3]+='stock tampered';await assert.rejects(f.call('preview'),{code:'IP_REDEMPTION_DIVERGED'});
});
test('external invoice-like changes or a tampered continuation cannot be adopted',async()=>{
 const f=fixture();f.state.parts[1]=f.state.parts[1].replace('RemaQty>1.0000','RemaQty>0.0000');f.state.parent.DeliveryAfterHash=H(f.state.parts);
 await assert.rejects(f.call('preview'),{code:'IP_REDEMPTION_DIVERGED'});
 for(const field of ['DeliveryBeforeHash','RedemptionBeforeHash','DeliveryAfterHash','RedemptionAfterHash','InvoiceAfterHash']){
  const x=fixture(),c=await command(x);await x.call('apply',c);x.state.receipt[field]='d'.repeat(64);await assert.rejects(x.call('preview'),{code:'IP_REDEMPTION_DIVERGED'});
 }
});
test('unexpected202, cost or116 changes and late receipt failure roll back all mutations',async()=>{
 for(const setting of ['financeDrift','costDrift','cutDrift','postWriteFailure']){
  const f=fixture({[setting]:true}),c=await command(f),before=structuredClone(f.state);
  await assert.rejects(f.call('apply',c));assert.deepEqual(f.state,before);assert.equal(f.events.at(-1),'rollback');
 }
});
test('public errors contain fixed codes and never SQL diagnostics',()=>{
 assert.deepEqual(invoiceHttpError(Error('private password server')),{status:503,code:'IP_FAILED'});
 assert.deepEqual(invoiceHttpError(Error('IP_COST_SCOPE_UNSUPPORTED')),{status:409,code:'IP_COST_SCOPE_UNSUPPORTED'});
});
test('ACCOUNTING invoice capability is advertised only when the107 flag is enabled',()=>{
 const {capabilitiesFor,rolesFor}=require('../services/role-capabilities'),old=process.env.NATIVE_INVOICE_107_ENABLED;
 try{
  assert.deepEqual(rolesFor('invoice.post-native'),['ACCOUNTING']);
  process.env.NATIVE_INVOICE_107_ENABLED='false';assert.equal(capabilitiesFor('ACCOUNTING').actions.includes('invoice.post-native'),false);
  process.env.NATIVE_INVOICE_107_ENABLED='true';assert.equal(capabilitiesFor('ACCOUNTING').actions.includes('invoice.post-native'),true);
  for(const role of ['WAREHOUSE','MANAGER','C_LEVEL','ADMIN'])assert.equal(capabilitiesFor(role).actions.includes('invoice.post-native'),false);
 }finally{if(old===undefined)delete process.env.NATIVE_INVOICE_107_ENABLED;else process.env.NATIVE_INVOICE_107_ENABLED=old;}
});
