'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),report=require('../services/sales-target-report');
const period={PeriodID:1,BeginDate:'2026-10-01',EndDate:'2026-10-31'};
function options(periods=[period],targets=[{PeriodID:1,EmpID:1,EmpCode:'0001',SalesName:'QA',TargetRows:1,TargetAmt:100}]){
 return {readGlobalDataWindow:async()=>({businessDate:'2026-01-01'}),runSales:async(kind,p)=>{assert.equal(kind,'net-sales-detail');assert.equal(p.exportAll,'true');return {rows:[{EmpID:1,EmpCode:'0001',SalesName:'QA',QtyTon:1,Amount:80},{EmpID:1,EmpCode:'0001',SalesName:'QA',QtyTon:-0.2,Amount:-20}],meta:{}};},queryFn:async text=>({recordset:text.includes('NATIVE_SALES_TARGET_PERIODS')?periods:targets})};
}
test('native targets compare signed net invoices and adjustments for an exact complete period',async()=>{
 const r=await report.run({from:'2026-10-01',to:'2026-10-31'},options());
 assert.equal(r.rows[0].ActualAmt,60);assert.equal(r.rows[0].ActualTon,0.8);assert.equal(r.rows[0].TargetAmt,100);assert.equal(r.rows[0].AchievedPct,60);
 assert.equal(r.meta.targetCoverage,'MATCHED');assert.equal(r.columns.find(c=>c.key==='AchievedPct').aggregation,undefined);
});
test('missing native targets stay null rather than becoming invented quotas',async()=>{
 const r=await report.run({from:'2026-10-01',to:'2026-10-31'},options([],[]));assert.equal(r.rows[0].TargetAmt,null);assert.equal(r.rows[0].AchievedPct,null);assert.match(r.rows[0].TargetState,/ยังไม่กำหนด/);
});
test('partial/overlapping/gapped periods are not prorated and duplicate employee targets are held',async()=>{
 assert.equal(report.coverage([period],'2026-10-15','2026-10-31'),'PERIOD_MISMATCH');
 assert.equal(report.coverage([period,period],'2026-10-01','2026-10-31'),'PERIOD_MISMATCH');
 const target={PeriodID:1,EmpID:1,TargetRows:2,TargetAmt:200};const r=await report.run({from:'2026-10-01',to:'2026-10-31'},options([period],[target]));assert.equal(r.rows[0].TargetAmt,null);assert.match(r.rows[0].TargetState,/ซ้ำ/);
});
test('zero target and incomplete actuals never produce an infinite or fabricated percentage',async()=>{
 let o=options([period],[{PeriodID:1,EmpID:1,TargetRows:1,TargetAmt:0}]);let r=await report.run({from:'2026-10-01',to:'2026-10-31'},o);assert.equal(r.rows[0].TargetAmt,0);assert.equal(r.rows[0].AchievedPct,null);
 o=options();const base=o.runSales;o.runSales=async(...a)=>({...await base(...a),meta:{isTruncated:true}});r=await report.run({from:'2026-10-01',to:'2026-10-31'},o);assert.equal(r.rows[0].AchievedPct,null);assert.equal(r.meta.isTruncated,true);
});

test('a range entirely before the global start exposes neither targets nor actuals',async()=>{
 let reads=0;const o={readGlobalDataWindow:async()=>({businessDate:'2026-11-01'}),queryFn:async()=>{reads++;throw Error('unexpected query');},runSales:async()=>{reads++;throw Error('unexpected actual');}};
 const r=await report.run({from:'2026-10-01',to:'2026-10-31'},o);assert.equal(reads,0);assert.deepEqual(r.rows,[]);assert.equal(r.meta.targetCoverage,'BEFORE_START');
});
