'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
const db=h.installDbStub(({text})=>/SELECT DB_NAME\(\) AS DatabaseName/.test(text)?[{DatabaseName:'dbwins_worldfert9_uat'}]:/SELECT TOP \(50\) r.Id/.test(text)?[{
  Id:8,CustId:7,ConversionId:10,Status:'PENDING',ActorPrimaryId:1,EffectivePrimaryId:1,
  CustCode:'C7',CustName:'Fixture',GoodName:'Fixture fertilizer',ConvertedValueBaht:100,ConvertedTons:0.1,
}]:[],{activeUserIds:h.TEST_USERS});
function replace(path,exports){const p=require.resolve(path);require(p);require.cache[p].exports=exports;}
const {authorizeConversionAction}=require('../services/rebate-conversion-approval-policy');
let generation=1,calls=[];
replace('../services/rebate-route-fence',{withRebateRouteFence:fn=>fn({environment:'uat',generation,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}),
  isShipmentEpoch:e=>e.generation>0,routeParticipantFence:async()=>{}});
replace('../services/rebate-conversion-approval-request',{createConversionApprovalRequest:async(_q,user,body,epoch,options)=>{
  authorizeConversionAction(user,'REQUEST');calls.push({action:'REQUEST',body,epoch,options});return {id:8,status:'PENDING'};}});
replace('../services/rebate-conversion-approval-issue',{approveConversionRequest:async(_q,user,input,epoch,options)=>{
  authorizeConversionAction(user,'APPROVE');calls.push({action:'APPROVE',input,epoch,options});return {id:8,status:'APPROVED'};}});
replace('../services/rebate-conversion-approval-release',{releaseConversionApprovalRequest:async(_q,user,input,epoch,options)=>{
  authorizeConversionAction(user,input.action==='CANCEL'?'REQUEST':'REJECT');calls.push({action:input.action,input,epoch,options});return {id:8,status:input.action};}});
replace('../services/rebate-conversion-approval-scope',{authorizeConversionRequestScope:async()=>({sql:'1=1',inputs:{}})});
let app,oldPool,oldApproval;
test.before(async()=>{oldPool=process.env.REBATE_POOL_103_ENABLED;oldApproval=process.env.REBATE_CONVERSION_APPROVAL_ENABLED;
  app=await h.startApp([['/api/rebate-pool','../../routes/rebate-pool']]);});
test.after(async()=>{await app.close();if(oldPool===undefined)delete process.env.REBATE_POOL_103_ENABLED;else process.env.REBATE_POOL_103_ENABLED=oldPool;
  if(oldApproval===undefined)delete process.env.REBATE_CONVERSION_APPROVAL_ENABLED;else process.env.REBATE_CONVERSION_APPROVAL_ENABLED=oldApproval;});
test('workflow is closed by default and requires both switches',async()=>{
  delete process.env.REBATE_POOL_103_ENABLED;delete process.env.REBATE_CONVERSION_APPROVAL_ENABLED;
  let r=await app.call('POST','/api/rebate-pool/conversion-requests',{user:{sub:1,role:'SALES'},body:{}});
  assert.equal(r.status,503);assert.equal(calls.length,0);
  process.env.REBATE_POOL_103_ENABLED='true';
  r=await app.call('POST','/api/rebate-pool/conversion-requests',{user:{sub:1,role:'SALES'},body:{}});
  assert.equal(r.status,503);assert.equal(calls.length,0);
});
test('requests and decisions use fenced epoch and global UTC cutoff with role permissions',async()=>{
  process.env.REBATE_CONVERSION_APPROVAL_ENABLED='true';calls=[];
  let r=await app.call('POST','/api/rebate-pool/conversion-requests',{user:{sub:1,role:'SALES'},body:{requestId:'fixture',expectedDatabase:'dbwins_worldfert9_uat'}});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(calls[0].epoch.generation,1);
  assert.equal(calls[0].options.windowStartUtc.toISOString(),'2025-12-31T17:00:00.000Z');
  r=await app.call('POST','/api/rebate-pool/conversion-requests/8/approve',{user:{sub:2,role:'MANAGER'},body:{reason:'test',expectedDatabase:'dbwins_worldfert9_uat'}});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(calls[1].action,'APPROVE');
  assert.equal(typeof calls[1].options.authorizeScope,'function');
  r=await app.call('POST','/api/rebate-pool/conversion-requests/8/approve',{user:{sub:1,role:'SALES'},body:{reason:'test',expectedDatabase:'dbwins_worldfert9_uat'}});
  assert.equal(r.status,403);assert.equal(calls.length,2);
  generation=0;
  r=await app.call('POST','/api/rebate-pool/conversion-requests/8/reject',{user:{sub:2,role:'MANAGER'},body:{reason:'test',expectedDatabase:'dbwins_worldfert9_uat'}});
  assert.equal(r.status,409);assert.equal(calls.length,2);generation=1;
});
test('request list hides currency from sales, limits owner and includes decision action for approver',async()=>{
  process.env.REBATE_POOL_103_ENABLED='true';process.env.REBATE_CONVERSION_APPROVAL_ENABLED='true';
  let r=await app.call('GET','/api/rebate-pool/conversion-requests',{user:{sub:1,role:'SALES'}});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.items[0].amount,undefined);
  assert.equal(r.body.database,'dbwins_worldfert9_uat');
  assert.equal(r.body.items[0].canCancel,true);assert.equal(r.body.items[0].canDecide,false);
  const query=db.calls.find(c=>/SELECT TOP \(50\) r.Id/.test(c.text));
  assert.match(query.text,/r.CreatedAtUtc>=@windowStartUtc/);assert.equal(query.inputs.reviewer,false);
  r=await app.call('GET','/api/rebate-pool/conversion-requests',{user:{sub:2,role:'MANAGER'}});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.items[0].amount,100);
  assert.equal(r.body.items[0].canDecide,true);assert.equal(r.body.items[0].canCancel,false);
});
test('changing the selected database cannot apply a stale request or decision',async()=>{
  process.env.REBATE_POOL_103_ENABLED='true';process.env.REBATE_CONVERSION_APPROVAL_ENABLED='true';calls=[];
  for(const [path,role] of [['/api/rebate-pool/conversion-requests','SALES'],['/api/rebate-pool/conversion-requests/8/approve','MANAGER']]){
    const r=await app.call('POST',path,{user:{sub:1,role},
      body:{expectedDatabase:'dbwins_worldfert2',reason:'test'}});
    assert.equal(r.status,409,JSON.stringify(r.body));assert.equal(r.body.code,'REBATE_TARGET_MISMATCH');
  }
  assert.equal(calls.length,0);
});
