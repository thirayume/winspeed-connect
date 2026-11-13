'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {getSharedCustomerQueue}=require('../services/rebate-shared-queue');
test('visibility, opening balance and details all use both identities scoped filter',async()=>{
  const queries=[];
  const query=async(text,params)=>{
    queries.push({text,params});
    if(/SELECT TOP 1/.test(text))return {recordset:[{ok:1}]};
    if(/MaturedBalance/.test(text))return {recordset:[{MaturedBalance:10,UnmaturedBalance:0,OpeningBalance:10,OpeningCount:1,WithoutPlanCount:0}]};
    return {recordset:[]};
  };
  const result=await getSharedCustomerQueue(query,{custId:1,asOfDate:'2026-11-14',cutoff:'2026-01-01',
    scope:{sql:'(SalesEmpId=@actorEmp AND SalesEmpId=@effectiveEmp)',inputs:{actorEmp:'1',effectiveEmp:'1'}}});
  assert.equal(result.openingEligibleBalance,10);assert.equal(queries.length,3);
  for(const q of queries){assert.match(q.text,/SalesEmpId=@actorEmp AND SalesEmpId=@effectiveEmp/);
    assert.equal(q.params.actorEmp,'1');assert.equal(q.params.effectiveEmp,'1');}
});
