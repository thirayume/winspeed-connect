'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),XLSX=require('xlsx');
const h=require('./helpers/route-harness.cjs');let deleted=false,period=2569,published=true;
const project={key:'P1',title:'QA project',category:'QA category',region:'QA North',budgetAmount:500,validFrom:'2026-01-01',validTo:'2026-12-31',internalParticipants:[{name:'QA staff',role:'QA role',dept:'QA dept'}],externalParticipants:[{custCode:'QA',custName:'QA customer',note:'QA'}]};
const line={PlanId:77,ProjectKey:'P1',PeriodYear:2569,Region:'QA North',Category:'1.1',ItemName:'QA expense',Amount:110};
const plan=()=>({PlanId:77,PreparedBy:12,PreparedActorId:12,AssignedReviewerId:20,AssignedApproverId:30,Status:'DRAFT',PeriodYear:period,Channel:'ทั่วไป',Title:'QA annual',DocumentJson:JSON.stringify({version:1,projects:[project]}),DeletedAt:deleted?'2026-11-25':null});
const db=h.installDbStub(({text})=>{
 if(text.includes('FROM wf.SystemSetting WHERE SettingKey LIKE'))return [{SettingKey:'REPORT_CFG_budget-plan-approval',SettingValue:JSON.stringify({enabled:published,isoStamp:{code:'FM-QA',revision:'00'}})}];
 if(text.includes('FROM wf.ReportTemplateAssignment a'))return [{TemplateId:1,TemplateCode:'QA',TemplateVersion:1,HeaderId:1,CompanyNameTh:'QA Company'}];
 if(text.includes('SELECT * FROM wf.BudgetPlan'))return [plan()];
 if(text.includes('SELECT * FROM wf.PromotionBudgetLine'))return [line];
 if(text.includes('SELECT Region,Amount FROM wf.PromotionBudgetAllocation')||text.includes('SUM(a.Amount)'))return [{Region:'QA North',Amount:1000}];
 if(text.includes('MissingPlanDetailsCount'))return [{MissingPlanDetailsCount:0}];
 if(text.includes('JOIN wf.PromotionBudgetLine'))return [line];
 if(text.includes('p.DocumentJson'))return [plan()];
 return [];
},{activeUserIds:[12,19,20,30]});
const app=express();app.use(express.json());app.use('/api/budget',require('../routes/budget'));app.use('/api/rebate',require('../routes/rebate'));let server,base;
const headers=user=>({authorization:'Bearer '+h.token(user),'content-type':'application/json'});
const owner={sub:12,role:'SALES'};
test.before(async()=>{server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}`;});
test.after(()=>new Promise(resolve=>server.close(resolve)));
test.beforeEach(()=>{deleted=false;period=2569;db.calls.length=0;});
test('author can print/export the same scoped project, participants and ISO without report-menu privileges',async()=>{
 const response=await fetch(base+'/api/budget/plans/77/report',{headers:headers(owner)});assert.equal(response.status,200);const r=await response.json();assert.equal(r.data.meta.projects[0].title,'QA project');assert.equal(r.data.rows[0].Amount,110);
 const exported=await fetch(base+'/api/budget/plans/77/export',{headers:headers(owner)});assert.equal(exported.status,200);const wb=XLSX.read(Buffer.from(await exported.arrayBuffer()),{type:'buffer'});assert.match(XLSX.utils.sheet_to_csv(wb.Sheets.Participants),/QA customer/);assert.match(XLSX.utils.sheet_to_csv(wb.Sheets.Participants),/FM-QA/);
 assert.equal(db.calls.some(c=>/\b(INSERT|UPDATE|DELETE)\b/.test(c.text)),false);
});
test('other sales, deleted plans, invalid identifiers and old annual periods cannot expose reports',async()=>{
 assert.equal((await fetch(base+'/api/budget/plans/77/report',{headers:headers({sub:19,role:'SALES'})})).status,403);
 assert.equal((await fetch(base+'/api/budget/reports/annual?year=2569',{headers:headers(owner)})).status,403);
 assert.equal((await fetch(base+'/api/budget/plans/invalid/report',{headers:headers(owner)})).status,400);
 deleted=true;assert.equal((await fetch(base+'/api/budget/plans/77/report',{headers:headers(owner)})).status,404);
 deleted=false;period=2568;assert.equal((await fetch(base+'/api/budget/plans/77/report',{headers:headers(owner)})).status,404);
});
test('a cached legacy annual-project form is refused before creating or changing a financial Rebate plan',async()=>{
 const r=await fetch(base+'/api/rebate/plans',{method:'POST',headers:headers({sub:12,role:'ADMIN'}),body:JSON.stringify({title:'QA',detailsJson:{expenseItems:[]}})});assert.equal(r.status,410);assert.equal((await r.json()).code,'PROMOTION_BUDGET_UNIFIED');assert.equal(db.calls.some(c=>/INSERT INTO wf.RebatePlan/.test(c.text)),false);
});
test('staff directory uses the current employee/user scope instead of an admin directory endpoint',async()=>{
 const response=await fetch(base+'/api/budget/staff?q=QA',{headers:headers(owner)});assert.equal(response.status,200);
 const q=db.calls.find(c=>c.text.includes('SELECT TOP 50 u.Id,u.DisplayName'));assert.ok(q);assert.match(q.text,/u.Id IN \(@bpU0\)/);assert.equal(q.inputs.bpU0,12);assert.equal(q.inputs.search,'%QA%');
});
