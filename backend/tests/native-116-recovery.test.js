'use strict';
const {test,mock}=require('node:test'),assert=require('node:assert/strict');
const metadata=require('../services/initial-invoice-metadata'),target=require('../services/native-document-target');
const {native116Recovery}=require('../services/native-116-recovery');
function harness(overrides={}){
 const log=[];let values={};
 const state={Id:1,Role:'ADMIN',EmpId:null,IsActive:1,MustChangePassword:0,...overrides.user};
 const row={StageId:'11111111-1111-4111-8111-111111111111',State:'PENDING',DocuNo:'QA-116',DocuDate:'2026-11-27',BeforeHead:'',CurrentHead:'<head/>',CurrentLines:'<line/>',CurrentBalances:'<coupon/>',ConnectionOpen:0,...overrides.row};
 const query=async text=>{
  log.push({text,values:{...values}});
  if(text.includes('SELECT Id,Role,EmpId'))return {recordset:[state]};
  if(text.includes('SELECT DISTINCT p.BaseRole'))return {recordset:[{BaseRole:overrides.role||'ADMIN'}]};
  if(text.includes('fn_UserHasPermission'))return {recordset:[{Allowed:1}]};
  if(text.includes('sp_getapplock'))return {recordset:[{Result:0}]};
  if(text.includes('SELECT s.*'))return {recordset:[row]};
  if(text.includes('SELECT TOP 100'))return {recordset:[{stageId:row.StageId,docuNo:row.DocuNo,connectionOpen:0}]};
  if(text.includes('restoreBalance'))return {recordset:[{couponId:1,couponNo:'QA-C',restoreBalance:'1.0000',currentBalance:'0.9000'}]};
  if(text.includes('EXEC wf.sp_Native116RecoverBefore'))return {recordset:[]};
  throw Error('Unexpected QA query: '+text.slice(0,80));
 };
 const tx={request(){values={};return {input(k,_t,v){values[k]=v;return this;},query}}};
 return {row,log,options:{env:{NATIVE_COUPON_BRIDGE_DIRECT_ENABLED:'true'},transaction:async fn=>fn(tx)},args:{user:{sub:1,role:'ADMIN'},stageId:row.StageId,reason:'QA reviewed interrupted native save'}};
}
async function setup(t){
 mock.method(target,'assertTarget',async()=>{});mock.method(metadata,'verifyOperationalMetadata',async()=>{});t.after(()=>mock.restoreAll());
}
test('native recovery previews are private, then restore only a matching current snapshot with both actor IDs',async t=>{
 await setup(t);const h=harness();const preview=await native116Recovery({...h.args,operation:'inspect'},h.options);
 assert.match(preview.fingerprint,/^[a-f0-9]{64}$/);assert.equal(preview.restoreExisting,false);
 assert.ok(!JSON.stringify(preview).includes('<head/>'));
 assert.equal(h.log.filter(c=>c.text.includes('EXEC wf.sp_Native116RecoverBefore')).length,0);
 await assert.rejects(native116Recovery({...h.args,operation:'restore',fingerprint:'a'.repeat(64)},h.options),{code:'ND_PREVIEW_STALE'});
 const result=await native116Recovery({...h.args,operation:'restore',fingerprint:preview.fingerprint},h.options);
 assert.equal(result.restoredBefore,true);
 const write=h.log.find(c=>c.text.includes('EXEC wf.sp_Native116RecoverBefore'));
 assert.equal(write.values.u,1);assert.equal(write.values.a,1);assert.equal(write.values.head,'<head/>');
 h.row.CurrentBalances='<coupon changed="1"/>';
 await assert.rejects(native116Recovery({...h.args,operation:'restore',fingerprint:preview.fingerprint},h.options),{code:'ND_PREVIEW_STALE'});
});
test('native recovery keeps a pending save held while its original connection remains open',async t=>{
 await setup(t);const h=harness({row:{ConnectionOpen:1}}),p=await native116Recovery({...h.args,operation:'inspect'},h.options);
 assert.equal(p.connectionOpen,true);
 await assert.rejects(native116Recovery({...h.args,operation:'restore',fingerprint:p.fingerprint},h.options),{code:'ND_NATIVE116_CLOSE_ORIGINAL_CONNECTION'});
 assert.ok(!h.log.some(c=>c.text.includes('EXEC wf.sp_Native116RecoverBefore')));
});
test('native recovery rechecks active admin roles, settled state and target feature before preview or restore',async t=>{
 await setup(t);
 for(const overrides of [{role:'MANAGER'},{user:{IsActive:0}}]){
  const h=harness(overrides);await assert.rejects(native116Recovery({...h.args,operation:'queue'},h.options),e=>e.status===403);
  assert.ok(!h.log.some(c=>c.text.includes('SELECT TOP 100')));
 }
 const h=harness({row:{State:'RECOVERED'}});
 await assert.rejects(native116Recovery({...h.args,operation:'inspect'},h.options),{code:'ND_NATIVE116_RECOVERY_STAGE_CHANGED'});
 await assert.rejects(native116Recovery({...h.args,operation:'restore',reason:'short'},h.options),{code:'ND_REASON_REQUIRED'});
 await assert.rejects(native116Recovery({...h.args,operation:'inspect'},{...h.options,env:{}}),{code:'ND_NATIVE116_DIRECT_DISABLED'});
});
