'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeRebatePricingMode}=require('../services/rebate-draft-mode');
const {calculatePricingFingerprint}=require('../services/price-authority');

test('draft mode accepts explicit pool/cash, preserves missing legacy values, and rejects other input',()=>{
  assert.equal(normalizeRebatePricingMode({}),null);
  assert.equal(normalizeRebatePricingMode({rebatePricingMode:'POOL'}),'POOL');
  assert.equal(normalizeRebatePricingMode({rebatePricingMode:'CASH'}),'CASH');
  for(const value of ['OTHER','pool',true,1]) assert.throws(()=>normalizeRebatePricingMode({rebatePricingMode:value}),{code:'REBATE_PRICING_MODE_INVALID'});
  for(const kind of ['isGiveaway','isCouponDrawn','isControlTicketDrawn'])
    assert.throws(()=>normalizeRebatePricingMode({rebatePricingMode:'POOL',[kind]:true}),{code:'REBATE_PRICING_MODE_NOT_APPLICABLE'});
});
test('changing draft rebate mode changes approval fingerprint without changing legacy fingerprints',()=>{
  const line={goodId:'17',qtyTon:1,pricePerTon:18000,isGiveaway:false};
  const legacy=calculatePricingFingerprint([line]);
  assert.equal(legacy,calculatePricingFingerprint([{...line,rebatePricingMode:null}]));
  assert.notEqual(legacy,calculatePricingFingerprint([{...line,rebatePricingMode:'POOL'}]));
  assert.notEqual(calculatePricingFingerprint([{...line,rebatePricingMode:'POOL'}]),calculatePricingFingerprint([{...line,rebatePricingMode:'CASH'}]));
});
