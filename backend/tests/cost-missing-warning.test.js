'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateSellingPriceFloor}=require('../services/cost-authority');
test('missing started cost is a warning, not a rejection, without exposing price information',async()=>{
 const result=await evaluateSellingPriceFloor({lines:[{key:'line-1',goodId:'11',goodCode:'TEST',pricePerTon:10}],asOfDate:'2026-01-01',queryFn:async()=>({recordset:[]})});
 assert.equal(result.blocked,false);assert.deepEqual(result.missingCost,[{lineIndex:0,key:'line-1'}]);assert.ok(!JSON.stringify(result.missingCost).includes('costPrice'));
});
test('a known price below its cost remains blocked while missing cost is flagged independently',async()=>{
 const queryFn=async(_sql,p)=>({recordset:p.goodId.value==='11'?[{CostBookId:1,GoodId:'11',CostPrice:20}]:[]});
 const result=await evaluateSellingPriceFloor({lines:[{key:'priced',goodId:'11',goodCode:'A',pricePerTon:10},{key:'missing',goodId:'12',goodCode:'B',pricePerTon:10}],queryFn});
 assert.equal(result.blocked,true);assert.equal(result.violations[0].key,'priced');assert.deepEqual(result.missingCost,[{lineIndex:1,key:'missing'}]);
});
