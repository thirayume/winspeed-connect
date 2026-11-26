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
test('company forecast adds each approved branch once and Excel identifies the contributing branches',async()=>{
 const source=[{PlanId:1,BranchPositionCode:'QA-EAST',BranchName:'QA East',PeriodYear:2569,Channel:'ทั่วไป',Category:'QA',ItemName:'QA bag',Region:'N',Amount:110},
 {PlanId:2,BranchPositionCode:'QA-WEST',BranchName:'QA West',PeriodYear:2569,Channel:'ทั่วไป',Category:'QA',ItemName:'QA bag',Region:'N',Amount:220}];
 const queryFn=async text=>({recordset:text.includes('MissingPlanDetailsCount')?[]:text.includes('SUM(a.Amount)')?[{Region:'N',Amount:3000}]:text.includes('p.DocumentJson')?source.map(r=>({...r,DocumentJson:null})):source});
 const result=await run({year:2569},{queryFn,scopes:[{all:true}],readGlobalDataWindow:async()=>({businessDate:'2026-01-01'})});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].Amount,330);assert.equal(result.rows[0].Region0,330);
 assert.deepEqual(result.meta.branchSummary.map(b=>b.estimatedAmount),[110,220]);
 const wb=require('../services/promotion-budget-workbook').workbook({title:'QA company forecast',...result});
 assert.ok(wb.SheetNames.includes('Branch Summary'));assert.match(require('xlsx').utils.sheet_to_csv(wb.Sheets['Branch Summary']),/QA-WEST,QA West,220/);
 await assert.rejects(run({year:2569,branchPositionCode:'QA-WEST'},{queryFn,scopes:[{all:false,positionCodes:['QA-EAST']}]}),e=>e.status===403);
});
test('project report joins JSON metadata once, honors filters and typed Excel keeps all participants and ISO',async()=>{
 const project={key:'P1',title:'QA project',category:'QA category',refDoc:'QA',region:'QA North',budgetAmount:500,validFrom:'2026-01-01',validTo:'2026-12-31',internalParticipants:[{name:'QA staff',role:'QA',dept:'QA'}],externalParticipants:[{custCode:'QA',custName:'QA customer',note:'QA'}]};
 const queryFn=async(text,inputs)=>{
  assert.match(text,/p.DeletedAt IS NULL/);assert.equal(inputs.channel.value,'ทั่วไป');
  if(text.includes('MissingPlanDetailsCount'))return {recordset:[]};
  if(text.includes('SUM(a.Amount)'))return {recordset:[{Region:'QA North',Amount:1000}]};
  if(text.includes('p.DocumentJson'))return {recordset:[{PlanId:1,PeriodYear:2569,Title:'QA annual',Channel:'ทั่วไป',Status:'APPROVED',DocumentJson:JSON.stringify({version:1,projects:[project]})}]};
  return {recordset:[{PlanId:1,ProjectKey:'P1',PeriodYear:2569,Channel:'ทั่วไป',Category:'1.1',ItemName:'QA expense',Region:'QA North',Amount:110}]};
 };
 const options={queryFn,readGlobalDataWindow:async()=>({businessDate:'2026-01-01'})};
 const register=await run({year:2569,channel:'ทั่วไป',status:'ALL'},{...options,register:true});assert.equal(register.rows[0].BudgetAmount,500);assert.equal(register.rows[0].EstimateAmount,110);
 const request=await run({year:2569,channel:'ทั่วไป',planId:1},options);assert.equal(request.rows[0].ProjectTitle,'QA project');
 const XLSX=require('xlsx'),book=require('../services/promotion-budget-workbook').workbook({title:'QA request',columns:require('../services/promotion-budget-report').columns,...request,isoStamp:{code:'FM-QA',revision:'00'}});
 const parsed=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});assert.ok(parsed.SheetNames.includes('Projects'));assert.ok(parsed.SheetNames.includes('Participants'));
 assert.match(XLSX.utils.sheet_to_csv(parsed.Sheets.Participants),/QA staff/);assert.match(XLSX.utils.sheet_to_csv(parsed.Sheets.Participants),/QA customer/);
 const empty=await run({year:2569,channel:'ทั่วไป',region:'OTHER'},options);assert.equal(empty.rows.length,0);
});
test('legacy annual estimates remain visible without inventing project budgets or losing totals',async()=>{
 const result=await run({year:2569},{register:true,readGlobalDataWindow:async()=>({businessDate:'2026-01-01'}),queryFn:async text=>({recordset:text.includes('MissingPlanDetailsCount')?[]:text.includes('SUM(a.Amount)')?[{Region:'N',Amount:1000}]:text.includes('p.DocumentJson')?[{PlanId:5,PeriodYear:2569,Channel:'ทั่วไป',Title:'QA legacy annual',DocumentJson:null}]:[{PlanId:5,ProjectKey:null,PeriodYear:2569,Region:'N',Amount:110}]})});
 assert.equal(result.rows[0].ProjectTitle,'QA legacy annual');assert.equal(result.rows[0].BudgetAmount,null);assert.equal(result.rows[0].EstimateAmount,110);assert.ok(result.meta.notes[0].includes('ไม่ได้แยกโครงการ'));
});
test('selected-plan report follows its stored CE/BE year instead of a mismatched year filter',async()=>{
 const result=await run({year:2569,planId:8},{readGlobalDataWindow:async()=>({businessDate:'2026-01-01'}),queryFn:async text=>({recordset:text.includes('MissingPlanDetailsCount')||text.includes('SUM(a.Amount)')?[]:text.includes('p.DocumentJson')?[{PlanId:8,PeriodYear:2027,Title:'QA CE plan',DocumentJson:null}]:[{PlanId:8,PeriodYear:2027,Amount:10}]})});
 assert.equal(result.meta.periodFrom,'2027-01-01');assert.equal(result.meta.periodTo,'2027-12-31');assert.equal(result.rows[0].PeriodYear,2570);assert.equal(result.meta.filters.year,'2570');
});
