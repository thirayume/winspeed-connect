'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {verifySecondarySpecialPrices}=require('../services/secondary-pricebook-special');
const book={Id:5,Status:'ACTIVE',EffectiveMonth:'2026-11',EffectiveFrom:'2026-11-01',EffectiveTo:'2026-11-30'};
const sp={Id:1,CustId:'123',GoodId:'7',ApprovedPrice:17500,WinSpeedSetPriceId:22};
const native={SetPriceID:22,CustID:123,ListID:7,GoodPriceNet:17500,BeginDate:'2026-11-01',EndDate:'2026-11-30'};
function fake(b=book, a=[sp], n=[native]) {const calls=[];const query=async(text)=>{calls.push(text);if(/FROM wf.PriceBook WHERE/.test(text))return{recordset:b?[b]:[]};if(/FROM wf.PriceBookSpecialPrice/.test(text))return{recordset:a};if(/FROM dbo.EMSetPriceHD/.test(text))return{recordset:n};throw Error('unexpected');};return {query,calls};}
test('same book, customer, good, dates and price are proven by reads only',async()=>{const x=fake();await verifySecondarySpecialPrices(x.query,5,'123');assert.equal(x.calls.length,3);assert.ok(x.calls.every(t=>/^\s*SELECT\b/i.test(t)));});
test('no special prices on either side is safe',async()=>{await verifySecondarySpecialPrices(fake(book,[],[]).query,5,'123');});
test('mismatch, missing, duplicate, unlinked and ambiguous customer code fail closed',async()=>{
 for(const x of [fake(book,[sp],[{...native,GoodPriceNet:17501}]),fake(book,[sp],[]),fake(book,[sp,sp],[native]),fake(book,[],[native]),fake(book,[{...sp,CustId:'CUSTOMER-CODE'}],[native]),fake(book,[sp],[native,native]),fake(book,[sp],[{...native,EndDate:'2026-12-01'}]),fake(null)]) await assert.rejects(verifySecondarySpecialPrices(x.query,5,'123'),{code:'SECONDARY_PRICE_RECONCILE_UNAVAILABLE'});
});
test('customer must be numeric and invalid book periods fail closed',async()=>{await assert.rejects(verifySecondarySpecialPrices(fake().query,5,'abc'),{code:'SECONDARY_PRICE_RECONCILE_UNAVAILABLE'});await assert.rejects(verifySecondarySpecialPrices(fake({...book,EffectiveFrom:'broken'}).query,5,'123'),{code:'SECONDARY_PRICE_RECONCILE_UNAVAILABLE'});});
