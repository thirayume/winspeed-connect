'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),XLSX=require('xlsx'),h=require('./helpers/route-harness.cjs');
const db=h.installDbStub(({text})=>{
 if(text.includes('SettingKey LIKE'))return [{SettingKey:'REPORT_CFG_daily-invoice',SettingValue:JSON.stringify({order:0,enabled:true,isoStamp:{code:'FM-QA-001',revision:'00',effectiveDate:'2026-11-01'}})}];
 if(text.includes('WITH headers'))return [{SOInvID:1,ListNo:1,DocuType:107,Sign:1,DocuNo:'J-QA',DocuDate:'2026-11-01',CustCode:'0001',CustName:'QA customer',GoodCode:'0002',GoodName:'QA product',QtyTon:1,PricePerTon:100,LineGross:100,NetAmnt:90,VATAmnt:0,BillDiscAmnt:10}];
 if(text.includes('FROM wf.ReportTemplateAssignment a'))return [{TemplateId:1,TemplateCode:'QA',TemplateVersion:1,HeaderId:1,CompanyNameTh:'QA Company'}];
 if(text.includes('MissingPlanDetailsCount'))return [{MissingPlanDetailsCount:0}];
 if(text.includes('SUM(a.Amount)'))return [{Region:'QA North',Amount:1000}];
 if(text.includes('JOIN wf.PromotionBudgetLine'))return [{PeriodYear:2569,Channel:'ทั่วไป',Category:'QA',ItemName:'QA bags',Region:'QA North',Amount:110}];
 return [];
},{activeUserIds:[1,2]});
const app=express();app.use(express.json());app.use('/api/reports',require('../routes/reports'));let server,base;
test.before(async()=>{server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>new Promise(resolve=>server.close(resolve)));
test('JSON and actual Excel carry the same ISO, filters, exact identifiers and discounted totals',async()=>{
 const headers={authorization:`Bearer ${h.token({sub:1,role:'ADMIN'})}`},params='?from=2026-11-01&to=2026-11-30&custCode=0001&book=J';
 const response=await fetch(base+'/api/reports/daily-invoice'+params,{headers});assert.equal(response.status,200);const data=await response.json();assert.equal(data.rows[0].Amount,90);assert.equal(data.isoStamp.code,'FM-QA-001');
 const exported=await fetch(base+'/api/reports/daily-invoice/export'+params,{headers});assert.equal(exported.status,200);
 const wb=XLSX.read(Buffer.from(await exported.arrayBuffer()),{type:'buffer'}),sheet=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:null});
 assert.ok(rows.some(r=>r.some(c=>String(c).includes('FM-QA-001 Rev.00'))));assert.ok(rows.some(r=>r.some(c=>String(c).includes('custCode: 0001'))));
 const head=rows.find(r=>r.includes('รหัสลูกค้า')),detail=rows.find(r=>r.includes('J-QA'));
 assert.equal(detail[head.indexOf('รหัสลูกค้า')],'0001');assert.equal(detail[head.indexOf('ยอดสุทธิไม่รวม VAT')],90);assert.equal(detail[head.indexOf('ส่วนลดท้ายใบจัดสรร')],10);
 assert.ok(db.calls.some(c=>c.text.includes('WITH headers')&&c.inputs.custCode==='0001'&&c.inputs.book==='J'));
});
test('non-admin cannot change publication or ISO even if their role manages report templates',async()=>{
 const response=await fetch(base+'/api/reports/catalog-config',{method:'PUT',headers:{authorization:`Bearer ${h.token({sub:2,role:'MANAGER'})}`,'content-type':'application/json'},body:JSON.stringify({order:['daily-invoice'],visibility:{'daily-invoice':false}})});
 assert.equal(response.status,403);
});

test('annual budget Excel keeps allocation, estimate and remaining amounts as calculable numeric cells',async()=>{
 const response=await fetch(base+'/api/reports/budget-annual-estimate/export?year=2569',{headers:{authorization:`Bearer ${h.token({sub:1,role:'ADMIN'})}`}});
 assert.equal(response.status,200);
 const workbook=XLSX.read(Buffer.from(await response.arrayBuffer()),{type:'buffer'}),sheet=workbook.Sheets[workbook.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{header:1});
 const summary=rows.find(r=>r[0]==='QA North');assert.deepEqual(summary,['QA North',1000,110,890]);
 const rowIndex=rows.indexOf(summary);for(const column of [1,2,3])assert.equal(sheet[XLSX.utils.encode_cell({r:rowIndex,c:column})].t,'n');
});
