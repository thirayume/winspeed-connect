'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
const db=h.installDbStub(({text,inputs})=>{
  if(/FROM wf.RebateShipmentEvidence e/.test(text)) {
    assert.equal(inputs.environment,'uat');assert.equal(inputs.startDate,'2026-01-01');
    assert.match(text,/CASE WHEN h.DocuDate>=CAST\(@startDate AS date\) THEN h.DocuNo END/);
    assert.match(text,/AS IsOpeningSource/);
    assert.match(text,/SalesEmpId/);
    return [{Id:5,RedemptionId:10,RedemptionListNo:2,Revision:1,DocuNo:'test',Status:'HELD'}];
  }
  return [];
},{activeUserIds:h.TEST_USERS});
function replace(path,exports) {const p=require.resolve(path);require(p);require.cache[p].exports=exports;}
let stages=0,reviews=0,checks=0;
replace('../services/rebate-route-fence',{
  withRebateRouteFence:fn=>fn({environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}),
  routeParticipantFence:async()=>{},isShipmentEpoch:e=>e.generation>0,
});
replace('../services/rebate-shared-scope',{sharedRebateScopeFilter:async()=>({sql:'SalesEmpId IS NOT NULL',inputs:{}})});
replace('../services/rebate-evidence-scope',{assertEvidenceScope:async(_q,user,source,options)=>{
  checks++;assert.equal(user.sub,1);assert.equal(options.startDate,'2026-01-01');assert.equal(source.redemptionId,10);
}});
replace('../services/rebate-evidence-intake',{stageShipmentEvidence:async(input,options)=>{
  stages++;await options.authorizeSource(()=>{},input);return {id:5,status:'HELD',revision:1};
}});
replace('../services/rebate-evidence-review',{reviewShipmentEvidence:async(user,payload,options)=>{
  reviews++;assert.equal(user.sub,1);await options.authorizeSource(()=>{},{redemptionId:10});return {id:payload.id,status:'REJECTED'};
}});
let app,old;
test.before(async()=>{old=process.env.REBATE_POOL_103_ENABLED;process.env.REBATE_POOL_103_ENABLED='true';app=await h.startApp([['/api/rebate-pool','../../routes/rebate-pool']]);});
test.after(async()=>{await app.close();if(old===undefined)delete process.env.REBATE_POOL_103_ENABLED;else process.env.REBATE_POOL_103_ENABLED=old;});
test('authorized queue uses date, scope and reset fence; stage and review enforce locked source scope',async()=>{
  const user={sub:1,role:'ADMIN'};
  let r=await app.call('GET','/api/rebate-pool/shipment-evidence',{user});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.data.length,1);
  r=await app.call('POST','/api/rebate-pool/shipment-evidence/stage',{user,body:{redemptionId:10,listNo:2}});
  assert.equal(r.status,200,JSON.stringify(r.body));
  r=await app.call('POST','/api/rebate-pool/shipment-evidence/5/review',{user,body:{expectedRevision:1,decision:'REJECT',reason:'test'}});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(stages,1);assert.equal(reviews,1);assert.equal(checks,2);
  assert.ok(db.calls.some(c=>/FROM wf.RebateShipmentEvidence e/.test(c.text)));
});
test('missing permission or feature flag cannot use queue or modify evidence',async()=>{
  const before=[stages,reviews];
  let r=await app.call('POST','/api/rebate-pool/shipment-evidence/stage',{user:{sub:2,role:'SALES'},body:{redemptionId:10,listNo:2}});
  assert.equal(r.status,403);
  process.env.REBATE_POOL_103_ENABLED='false';
  r=await app.call('GET','/api/rebate-pool/shipment-evidence',{user:{sub:1,role:'ADMIN'}});
  assert.equal(r.status,503);
  assert.deepEqual([stages,reviews],before);process.env.REBATE_POOL_103_ENABLED='true';
});
