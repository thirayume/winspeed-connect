'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertEvidenceScope } = require('../services/rebate-evidence-scope');

const user = {sub:1,role:'MANAGER',actorSub:2,actorRole:'MANAGER',isImpersonating:true};
const source = {redemptionId:10,sourceSOID:40};
function fixture({header=true,owner=12,effective=true,actor=true}={}) {
  const calls=[];
  const query=async (sql,inputs)=>{
    calls.push({sql,inputs});
    if (/WFRedemtionHD/.test(sql)) return {recordset:header?[{RedemtionID:10}]:[]};
    if (/dbo\.SOHD/.test(sql)) return {recordset:owner===null?[]:[{EmpID:owner}]};
    throw Error('Unexpected SQL');
  };
  const getScope=async u=>({all:false,userIds:[],empIds:(Number(u.sub)===1?effective:actor)?['12']:[]});
  return {query,calls,getScope};
}
test('evidence access keeps backdated sources available while intersecting both identities',async()=>{
  const f=fixture();
  await assertEvidenceScope(f.query,user,source,{startDate:'2026-01-01',getScope:f.getScope});
  assert.doesNotMatch(f.calls[0].sql,/DocuDate/);
  for(const options of [{header:false},{owner:null},{actor:false},{effective:false}]) {
    const x=fixture(options);
    await assert.rejects(assertEvidenceScope(x.query,user,source,{startDate:'2026-01-01',getScope:x.getScope}),{code:'REBATE_EVIDENCE_NOT_FOUND'});
  }
});
test('invalid cutoff fails closed even for users with unrestricted scope',async()=>{
  const f=fixture();
  await assert.rejects(assertEvidenceScope(f.query,user,source,{startDate:'2026-02-30',getScope:async()=>({all:true})}),{code:'REBATE_EVIDENCE_NOT_FOUND'});
  assert.equal(f.calls.length,0);
});
