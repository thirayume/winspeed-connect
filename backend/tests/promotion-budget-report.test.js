'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./helpers/route-harness.cjs').installDbStub(()=>[]);
const {run}=require('../services/promotion-budget-report');
test('annual report normalizes BE year, separates annual allocation and warns about missing legacy detail',async()=>{
 const result=await run({year:2569},{readGlobalDataWindow:async()=>({businessDate:'2026-07-01'}),queryFn:async(text,inputs)=>{
  assert.equal(inputs.year.value,2026);assert.equal(inputs.startYear.value,2026);
  if(text.includes('MissingPlanDetailsCount'))return {recordset:[{MissingPlanDetailsCount:1}]};
  if(text.includes('SUM(a.Amount)'))return {recordset:[{Region:'QA North',Amount:1000}]};
  return {recordset:[{PeriodYear:2569,Channel:'ทั่วไป',Category:'QA',ItemName:'QA bags',Region:'QA North',Amount:110}]};
 }});
 assert.equal(result.meta.periodFrom,'2026-01-01');assert.equal(result.meta.periodTo,'2026-12-31');
 assert.equal(result.meta.isPartialScope,true);assert.equal(result.meta.missingPlanDetailsCount,1);
 assert.equal(result.meta.budgetSummary[0].allocatedAmount,1000);assert.equal(result.meta.budgetSummary[0].estimatedAmount,110);
 assert.equal(result.rows[0].Region0,110);
});
test('default annual period uses Bangkok date at the UTC year boundary',async()=>{
 const result=await run({}, {now:new Date('2026-12-31T18:00:00Z'),readGlobalDataWindow:async()=>({businessDate:'2026-01-01'}),queryFn:async(text,inputs)=>{assert.equal(inputs.year.value,2027);return {recordset:[]};}});
 assert.equal(result.meta.periodFrom,'2027-01-01');
});
