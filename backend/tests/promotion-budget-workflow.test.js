'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let state,failAudit=false,queue=Promise.resolve();
const db=h.installDbStub(({kind,text,inputs:p})=>{
 assert.doesNotMatch(text,/\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+(?:dbo\.|wf\.(?:GiveawayBudget|Rebate))/i);
 if(text.includes('SELECT * FROM wf.BudgetPlan')){assert.match(text,/@id/);return state.plan?[state.plan]:[];}
 if(text.includes('SELECT * FROM wf.PromotionBudgetLine'))return state.lines;
 if(text.includes('SELECT Region,Amount FROM wf.PromotionBudgetAllocation'))return state.allocations;
 if(text.includes('SELECT PlanId FROM wf.BudgetPlan'))return state.plan&&state.plan.PlanId!==p.id?[{PlanId:state.plan.PlanId}]:[];
 if(text.includes('INSERT INTO wf.BudgetPlan')){state.plan={PlanId:1,PeriodYear:p.periodYear,Channel:p.channel,Title:p.title,PreparedBy:p.preparedBy,PreparedActorId:p.preparedActorId,Status:'DRAFT',EditVersion:1};return [{PlanId:1}];}
 if(text.includes('UPDATE wf.BudgetPlan')){
  assert.equal(kind,'tx');const b=state.plan;b.EditVersion++;
  if(text.includes("Status='DRAFT'"))Object.assign(b,{Status:'DRAFT',Title:p.title,PeriodYear:p.periodYear,Channel:p.channel,AssignedReviewerId:p.reviewer,AssignedApproverId:p.approver,ReviewedBy:null,ReviewedAt:null,ApprovedBy:null,ApprovedAt:null});
  else if(text.includes("Status='PENDING'"))Object.assign(b,{Status:'PENDING',PreparedAt:'2026-11-23',ReviewedBy:null,ReviewedActorId:null,ReviewedAt:null,ApprovedBy:null,ApprovedActorId:null,ApprovedAt:null});
  else if(text.includes("Status='APPROVED'"))Object.assign(b,{Status:'APPROVED',ApprovedBy:p.uid,ApprovedActorId:p.actor,ApprovedAt:'2026-11-23'});
  else if(text.includes("Status='REJECTED'"))b.Status='REJECTED';
  else if(text.includes("Status='CLOSED'"))b.Status='CLOSED';
  else Object.assign(b,{ReviewedBy:p.uid,ReviewedActorId:p.actor,ReviewedAt:'2026-11-23'});
 }
 if(text.includes('DELETE FROM wf.PromotionBudgetLine'))state.lines=[];
 if(text.includes('DELETE FROM wf.PromotionBudgetAllocation'))state.allocations=[];
 if(text.includes('INSERT INTO wf.PromotionBudgetLine'))state.lines.push({Region:p.region,Amount:p.amount,Category:p.category,ItemName:p.itemName});
 if(text.includes('INSERT INTO wf.PromotionBudgetAllocation'))state.allocations.push({Region:p.region,Amount:p.amount});
 if(text.includes('wf.fn_UserHasPermission'))return [20,30].includes(p.uid)?[{Id:p.uid}]:[];
 return [];
});
db.stub.wfTransaction=fn=>{const run=queue.then(async()=>{const before=structuredClone(state);try{return await fn(db.tx);}catch(e){state=before;throw e;}});queue=run.catch(()=>{});return run;};
const auditPath=require.resolve('../services/policy-contract');require.cache[auditPath]={id:auditPath,filename:auditPath,loaded:true,exports:{logChangeEvent:async(tx,event)=>{assert.equal(tx,db.tx);if(failAudit)throw Error('AUDIT_FAILED');state.events.push(event);}}};
const budget=require('../services/promotion-budget');
const users={sales:{sub:10,role:'SALES'},reviewer:{sub:20,role:'MANAGER'},approver:{sub:30,role:'C_LEVEL'},other:{sub:40,role:'SALES'}};
const payload=()=>({periodYear:2569,channel:'ทั่วไป',title:'QA annual plan',assignedReviewerId:20,assignedApproverId:30,lines:[{region:'QA North',category:'1.1',itemName:'QA bag',quantity:10,unitPrice:11,amount:110}],allocations:[{region:'QA North',amount:1000}]});
const write=(user,action,input={})=>budget.write(db.stub,user,{expectedVersion:state.plan?.EditVersion,...input},state.plan?.PlanId||null,action,'QA test',null);
test.beforeEach(()=>{state={plan:null,lines:[],allocations:[],events:[]};failAudit=false;});
test('annual years normalize and quantities/amounts are exact without mixing giveaway quotas',()=>{
 assert.equal(budget.year(2569),2026);assert.equal(budget.year(2026),2026);
 for(const p of [{...payload(),periodYear:0},{...payload(),lines:[{...payload().lines[0],amount:109}]},{...payload(),allocations:[{region:'N',amount:1},{region:'N',amount:2}]}])assert.throws(()=>budget.validate(p));
});
test('full prepare/review/approve chain; stale and out-of-order approvals cannot spend or overwrite',async()=>{
 await write(users.sales,'save',payload());await write(users.sales,'submit');
 await assert.rejects(write(users.approver,'approve'),e=>e.status===409);
 await assert.rejects(write(users.other,'review'),e=>e.status===403);
 const version=state.plan.EditVersion;
 const result=await Promise.allSettled([write(users.reviewer,'review',{expectedVersion:version}),write(users.reviewer,'review',{expectedVersion:version})]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.status,409);
 await write(users.approver,'approve');assert.equal(state.plan.Status,'APPROVED');assert.equal(state.events.length,4);
 await assert.rejects(write(users.sales,'save',payload()),e=>e.status===409);
});
test('audit failure restores plan, allocations and lines; cancellation retains history',async()=>{
 await write(users.sales,'save',payload());const before=structuredClone(state);failAudit=true;
 await assert.rejects(write(users.sales,'save',{...payload(),lines:[{...payload().lines[0],amount:220,quantity:20}]}),/AUDIT_FAILED/);assert.deepEqual(state,before);
 failAudit=false;await write(users.sales,'cancel');assert.equal(state.plan.Status,'CLOSED');assert.equal(state.lines.length,1);
});
test('rejected after review must start the review chain again when resubmitted',async()=>{
 await write(users.sales,'save',payload());await write(users.sales,'submit');await write(users.reviewer,'review');await write(users.approver,'reject');
 await write(users.sales,'submit');assert.equal(state.plan.ReviewedAt,null);await assert.rejects(write(users.approver,'approve'),e=>e.status===409);
});
test('owner/assignment checks and Access As require an auditable actual identity',async()=>{
 await write(users.sales,'save',payload());assert.equal(budget.canRead(users.other,state.plan),false);
 await assert.rejects(write({...users.sales,isImpersonating:true,actorSub:40,actorRole:'SALES'},'save',payload()),e=>e.status===503);
 await assert.rejects(write(users.other,'submit'),e=>e.status===403);
});
test('Budget Plan menu follows assigned permissions, including custom reviewers and revoked access',()=>{
 const menu=user=>require('../services/role-profiles').filteredCapabilities(user).menus;
 assert.ok(menu({role:'APPROVER',permissions:['budget.plan.review']}).includes('budget-plan'));
 assert.ok(!menu({role:'SALES',permissions:[]}).includes('budget-plan'));
 assert.ok(menu({role:'ACCOUNTING',permissions:[]}).includes('budget-plan'));
});
