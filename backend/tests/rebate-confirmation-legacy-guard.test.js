'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {assertLegacyRebateAllowed,verifyApprovedLegacyClaim}=require('../services/draft-confirmation');
test('new pool cannot spend a legacy sales ledger balance',()=>{
  assert.throws(()=>assertLegacyRebateAllowed({RebateDiscountAmt:200,ClaimDiscountAmt:50},{REBATE_POOL_103_ENABLED:'true'}),{status:409});
});
test('approved carry-forward claim must be linked to the same draft, customer and exact amount',async()=>{
  const calls=[],query=async(text,params)=>{calls.push({text,params});return {recordset:[{Id:4}]};};
  const so={Id:7,CustId:'103',RebateDiscountAmt:200,ClaimDiscountAmt:200,AppliedRebateClaimId:4};
  await verifyApprovedLegacyClaim(so,query,{REBATE_POOL_103_ENABLED:'true'});
  assert.match(calls[0].text,/AppliedDraftSoId=@draftId/);assert.match(calls[0].text,/CustomerAmount,ClaimAmt/);
  assert.equal(calls[0].params.amount.value,200);
  await assert.rejects(verifyApprovedLegacyClaim({...so,AppliedRebateClaimId:null},query,{REBATE_POOL_103_ENABLED:'true'}),{status:409});
  await assert.rejects(verifyApprovedLegacyClaim(so,async()=>({recordset:[]}),{REBATE_POOL_103_ENABLED:'true'}),{status:409});
});
test('existing approved claim amount and ordinary orders remain eligible',()=>{
  assert.doesNotThrow(()=>assertLegacyRebateAllowed({RebateDiscountAmt:200,ClaimDiscountAmt:200},{REBATE_POOL_103_ENABLED:'true'}));
  assert.doesNotThrow(()=>assertLegacyRebateAllowed({RebateDiscountAmt:0},{REBATE_POOL_103_ENABLED:'true'}));
  assert.doesNotThrow(()=>assertLegacyRebateAllowed({RebateDiscountAmt:200},{REBATE_POOL_103_ENABLED:'false'}));
});
