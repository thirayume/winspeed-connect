'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {counterpartyScopes,requireCounterparty,requireSuperiorOverride}=require('../services/giveaway-loan-organization');
const users={1:'A-SALE',2:'A-SALE',3:'B-SALE',4:null,10:'A-MGR',20:'B-MGR'};
const q=async(text,inputs={})=>{
 const p=Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v?.value??v]));
 if(text.includes('SELECT Id, EmpId, PositionCode'))return {recordset:[{Id:p.id,PositionCode:users[p.id],EmpId:null}]};
 if(text.includes('SELECT PositionCode,ReportsTo,RecordScope'))return {recordset:[{PositionCode:p.pos,ReportsTo:p.pos.endsWith('SALE')?p.pos.replace('SALE','MGR'):null,RecordScope:'ORG',IsActive:1}]};
 if(text.includes(';WITH tree AS'))return {recordset:(Number(p.id)===10?[10,1,2]:Number(p.id)===20?[20,3]:[p.id]).map(Id=>({Id}))};
 if(text.includes(';WITH leads AS')){
  assert.match(text,/WITH\(HOLDLOCK\)/);assert.match(text,/ORDER BY l.Depth/);assert.match(text,/MAXRECURSION 32/);
  return {recordset:(Number(p.loanUser)===1?[10,1,2]:Number(p.loanUser)===3?[20,3]:[]).map(Id=>({Id}))};
 }
 if(text.includes('fn_IsOrganizationSuperior'))return {recordset:[{Allowed:Number(p.supervisor)===10&&[1,2].includes(Number(p.employee))?1:0}]};
 throw Error('Unexpected QA SQL');
};
test('loan search admits peers of the nearest lead while withholding another division and unassigned staff',async()=>{
 const sales={sub:1,role:'SALES'};
 assert.deepEqual((await counterpartyScopes(q,sales))[0].userIds,[1,10,2]);
 await requireCounterparty(q,sales,2);
 await assert.rejects(requireCounterparty(q,sales,3),{code:'QUOTA_LOAN_COUNTERPARTY_OUTSIDE_BRANCH'});
 await assert.rejects(requireCounterparty(q,{sub:4,role:'SALES'},2),{code:'QUOTA_LOAN_COUNTERPARTY_OUTSIDE_BRANCH'});
});
test('an Access As manager cannot use the effective division to escape the actual manager scope',async()=>{
 const user={sub:20,role:'MANAGER',actorSub:10,actorRole:'MANAGER',actorRoles:['MANAGER'],isImpersonating:true};
 await assert.rejects(requireCounterparty(q,user,3),{code:'QUOTA_LOAN_COUNTERPARTY_OUTSIDE_BRANCH'});
});
test('lender consent stays personal, while a manager override must be above both quota owners',async()=>{
 await requireSuperiorOverride(q,{sub:1,role:'SALES'},1,2);
 await requireSuperiorOverride(q,{sub:10,role:'MANAGER'},1,2);
 await assert.rejects(requireSuperiorOverride(q,{sub:10,role:'MANAGER'},1,3),{code:'QUOTA_LOAN_APPROVER_OUTSIDE_CHAIN'});
 await requireSuperiorOverride(q,{sub:99,role:'ADMIN'},1,3);
});
