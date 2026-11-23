'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
h.installDbStub(()=>[]);
const s=require('../services/invoice-register-report');
const window=async()=>({businessDate:'2026-01-01'});
const row=(extra={})=>({SOInvID:1,ListNo:1,DocuType:107,Sign:1,DocuNo:'J69-QA',DocuDate:'2026-11-01',CustCode:'0001',GoodCode:'0002',QtyTon:1,LineGross:100,NetAmnt:100,VATAmnt:0,BillDiscAmnt:0,...extra});
test('full and partial discounts allocate only once and preserve header totals including cents',()=>{
 for(const total of [0,70.01,100]){
  const a=s.normalize([row({ListNo:1,LineGross:50,NetAmnt:total,BillDiscAmnt:100-total}),row({ListNo:2,LineGross:50,NetAmnt:total,BillDiscAmnt:100-total})]);
  assert.equal(Math.round(a.reduce((n,r)=>n+r.Amount,0)*100),Math.round(total*100));
  assert.equal(Math.round(a.reduce((n,r)=>n+r.BillDiscount,0)*100),Math.round((100-total)*100));
 }
});
test('credit/return is deducted once and debit/cash included; monetary credit does not invent returned tons',()=>{
 const r=s.normalize([row(),row({SOInvID:2,DocuType:109,Sign:-1,ReturnType:'C',NetAmnt:10}),row({SOInvID:3,DocuType:109,Sign:-1,ReturnType:'G',NetAmnt:20,QtyTon:.2}),row({SOInvID:4,DocuType:110,NetAmnt:5}),row({SOInvID:5,DocuType:108,NetAmnt:10})]);
 assert.equal(r.reduce((n,x)=>n+x.Amount,0),85);assert.equal(r[1].QtyTon,0);assert.equal(r[2].QtyTon,-.2);assert.equal(r[3].QtyTon,0);
 assert.throws(()=>s.normalize([row({DocuType:202})]),/UNSUPPORTED/);
 assert.throws(()=>s.normalize([row({Sign:-1})]),/ทิศทาง/);
});
test('strict filters reject invalid dates, reversed range, unsupported books; keep exact identifiers',()=>{
 for(const p of [{from:'2026-02-30'},{from:'2026-02-02',to:'2026-01-01'},{book:'K'}])assert.throws(()=>s.filters(p));
 assert.equal(s.filters({custCode:'00001'}).custCode,'00001');
});
test('two slips per invoice line enrich references without multiplying sales or looking up source IDs as document numbers',async()=>{
 const calls=[];
 const queryFn=async(text,inputs)=>{
  calls.push({text,inputs});
  if(text.includes('WITH headers')){assert.match(text,/h\.DocuType IN \(107\)/);assert.match(text,/h\.DocuDate>=@globalStartDate/);assert.match(text,/h\.DocuDate<DATEADD\(day,1,@to\)/);return {recordset:[row()]};}
  if(text.includes('ICCostDetail'))return {recordset:[{SOInvID:1,ListNo:1,StockLineCount:2,CostedStockCount:2,CostAmount:40}]};
  if(text.includes('FROM dbo.WFRedemtionDT'))return {recordset:[{SOInvID:1,SOListNo:1,CouponID:7,CouponNo:'C-QA',SlipNo:'QA-1',SlipDate:'2026-11-01',CarLicense:'QA-TRUCK'},{SOInvID:1,SOListNo:1,CouponID:7,CouponNo:'C-QA',SlipNo:'QA-2',SlipDate:'2026-11-01',CarLicense:'QA-TRUCK'}]};
  assert.match(text,/CASE WHEN b\.DocuDate>=@globalStartDate THEN b\.DocuNo END/);
  return {recordset:[{CouponID:7,BookingNo:'QA-103',BookingDate:'2026-11-01',SaleNo:'QA-104',SaleDate:'2026-11-01'}]};
 };
 const result=await s.run('daily-invoice',{from:'2026-11-01',to:'2026-11-01',plate:'QA-TRUCK'},{queryFn,readGlobalDataWindow:window});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].Amount,100);assert.equal(result.rows[0].CostAmount,40);assert.equal(result.rows[0].GrossProfit,60);assert.match(result.rows[0].SlipRefs,/QA-1.*QA-2/);assert.equal(result.rows[0].TraceState,'MATCHED');assert.equal(calls.length,4);
});
test('missing or partly posted stock cost stays unknown instead of generating fictitious profit',async()=>{
 for(const costing of [[],[{SOInvID:1,ListNo:1,StockLineCount:2,CostedStockCount:1,CostAmount:40}]]){
  const result=await s.run('daily-invoice',{}, {readGlobalDataWindow:window,queryFn:async text=>({recordset:text.includes('WITH headers')?[row()]:text.includes('ICCostDetail')?costing:[]})});
  assert.equal(result.rows[0].CostAmount,null);assert.equal(result.rows[0].GrossProfit,null);assert.equal(result.meta.costPendingCount,1);
  assert.ok(result.columns.filter(c=>['CostAmount','GrossProfit'].includes(c.key)).every(c=>!c.aggregation));
 }
});
test('adjustments follow their own document date and product filtering happens after bill discount allocation',async()=>{
 const result=await s.run('net-sales-detail',{from:'2026-11-01',to:'2026-11-30',goodCode:'0002'},{readGlobalDataWindow:window,queryFn:async(text,inputs)=>{
  assert.match(text,/107,108,109,110/);assert.equal(inputs.from.value,'2026-11-01');
  return {recordset:[row({NetAmnt:90,LineGross:50}),row({ListNo:2,GoodCode:'other',NetAmnt:90,LineGross:50})]};
 }});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].Amount,45);assert.equal(result.meta.dateBasis,'DOCUMENT_DATE');
});
test('preview cap counts documents and export expands the scope without dropping a multiline document',async()=>{
 const fixture=Array.from({length:1001},(_,i)=>row({SOInvID:i+1,DocuType:108,DocuNo:'QA-'+i}));
 fixture.splice(1,0,row({SOInvID:1,ListNo:2,DocuType:108,LineGross:100,DocuNo:'QA-0'}));
 const queryFn=async(text,inputs)=>{assert.match(text,/TOP \(@maxDocumentsPlusOne\)/);assert.ok([1001,50001].includes(inputs.maxDocumentsPlusOne.value));return {recordset:fixture};};
 const preview=await s.run('net-sales-detail',{}, {queryFn,readGlobalDataWindow:window});
 assert.equal(preview.meta.voucherCount,1000);assert.equal(preview.meta.isTruncated,true);assert.equal(preview.rows.filter(r=>r.SOInvID===1).length,2);
 const exported=await s.run('net-sales-detail',{exportAll:'true'},{queryFn,readGlobalDataWindow:window});
 assert.equal(exported.meta.voucherCount,1001);assert.equal(exported.meta.isTruncated,false);assert.equal(exported.rows.length,1002);
});
