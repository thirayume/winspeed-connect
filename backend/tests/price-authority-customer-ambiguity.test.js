'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let customers=[],seen=[];h.installDbStub(({text,inputs})=>{seen.push({text,inputs});if(/FROM dbo\.EMCust/.test(text))return customers;if(/FROM dbo\.EMSetPriceHD/.test(text))return [{SetPriceID:7,ListNo:1,AnnouncedPrice:123,PriceSource:'EMSetPrice'}];return [];});
const {resolveAuthoritativePrice}=require('../services/price-authority');
test('a numeric code matching a different customer ID is rejected before price lookup',async()=>{customers=[{CustID:1},{CustID:2}];seen=[];await assert.rejects(resolveAuthoritativePrice({custId:'123',goodId:'3'}),{code:'AMBIGUOUS_CUSTOMER_ID',statusCode:409});assert.equal(seen.filter(x=>/FROM dbo\.EMSetPriceHD/.test(x.text)).length,0);});
test('an unambiguous customer is passed to the native price query',async()=>{customers=[{CustID:42}];seen=[];const r=await resolveAuthoritativePrice({custId:'123',goodId:'3',asOfDate:'2026-01-01'});assert.equal(r.announcedPrice,123);assert.equal(seen.find(x=>/FROM dbo\.EMSetPriceHD/.test(x.text)).inputs.custId,42);});
