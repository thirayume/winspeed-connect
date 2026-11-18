'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
const oldFlag=process.env.REBATE_POOL_103_ENABLED;
process.env.REBATE_POOL_103_ENABLED='true';
let revision=3,price=9750;
const db=h.installDbStub(({text,inputs})=>{
  if(/FROM wf\.SalesOrder WITH\(UPDLOCK,HOLDLOCK\)/.test(text)) {
    assert.equal(inputs.windowStartUtc.toISOString(),'2025-12-31T17:00:00.000Z');
    return [{Id:51,Status:'DRAFT',DocumentRevision:revision,SalesUserId:99,SaleDate:'2026-11-13'}];
  }
  if(/FROM wf\.SalesOrderLine WITH\(UPDLOCK,HOLDLOCK\)/.test(text))return [{SoId:51,LineNum:1,GoodId:12,QtyTon:2,PricePerTon:price,RebatePricingMode:'POOL'}];
  if(/FROM dbo\.EMSetPriceHD/.test(text))return [{SetPriceID:8,ListNo:1,GoodId:12,BeginDate:'2026-01-01',EndDate:'2026-12-31',BasePrice:10000,DatabaseName:'uat',ServerName:'server'}];
  if(/SELECT Id,Decision,ActorPrimaryId/.test(text))return [];
  if(/INSERT wf\.RebatePriceApprovalEvidence/.test(text))return [{Id:7}];
  return [];
},{activeUserIds:h.TEST_USERS,strictTypedInputs:true});
let app;
test.before(async()=>{app=await h.startApp([['/api/so','../../routes/so']]);});
test.after(async()=>{await app.close();if(oldFlag===undefined)delete process.env.REBATE_POOL_103_ENABLED;else process.env.REBATE_POOL_103_ENABLED=oldFlag;});
const admin={sub:1,role:'ADMIN'};

test('preview and approval use a server price, reviewed fingerprint and both identity fields',async()=>{
  const preview=await app.call('GET','/api/so/51/rebate-pricing-preview',{user:admin});
  assert.equal(preview.status,200,JSON.stringify(preview.body));
  assert.equal(preview.body.lines[0].basePrice,'10000.00');assert.equal(preview.body.lines[0].requiresManagerApproval,true);
  const response=await app.call('POST','/api/so/51/rebate-pricing-approval',{user:admin,body:{lineNo:1,expectedRevision:3,
    expectedFingerprint:preview.body.lines[0].fingerprint,reason:'approved',basePrice:1}});
  assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.id,7);
  const inserted=db.calls.find(c=>/INSERT wf\.RebatePriceApprovalEvidence/.test(c.text));
  assert.equal(inserted.inputs.actorPrimary,1);assert.equal(inserted.inputs.effectivePrimary,1);
  assert.equal(inserted.inputs.actorBusiness,1);assert.equal(inserted.inputs.effectiveBusiness,1);
  assert.equal(inserted.inputs.basePrice,undefined);
});
test('stale price is refused and disabled workflow makes no database writes',async()=>{
  const preview=await app.call('GET','/api/so/51/rebate-pricing-preview',{user:admin});
  price=9700;
  try {
    const before=db.calls.length;
    const result=await app.call('POST','/api/so/51/rebate-pricing-approval',{user:admin,body:{lineNo:1,expectedRevision:3,
      expectedFingerprint:preview.body.lines[0].fingerprint,reason:'approved'}});
    assert.equal(result.status,409);assert.equal(result.body.code,'REBATE_APPROVAL_STALE');
    assert.equal(db.calls.slice(before).some(c=>/INSERT wf\.RebatePriceApprovalEvidence/.test(c.text)),false);
    process.env.REBATE_POOL_103_ENABLED='false';
    const disabled=await app.call('GET','/api/so/51/rebate-pricing-preview',{user:admin});
    assert.equal(disabled.status,503);assert.equal(disabled.body.code,'REBATE_POOL_103_UNAVAILABLE');
  } finally {price=9750;process.env.REBATE_POOL_103_ENABLED='true';}
});
test('sales users cannot read approval prices or approve',async()=>{
  for(const method of ['GET','POST']) {
    const endpoint=method==='GET'?'/api/so/51/rebate-pricing-preview':'/api/so/51/rebate-pricing-approval';
    const result=await app.call(method,endpoint,{user:{sub:2,role:'SALES'},...(method==='POST'?{body:{}}:{})});
    assert.equal(result.status,403,JSON.stringify(result.body));
  }
});
