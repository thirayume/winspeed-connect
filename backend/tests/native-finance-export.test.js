'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),XLSX=require('xlsx'),h=require('./helpers/route-harness.cjs');
const keys=['ar-receipt-history','cq-cheque-register','sales-target-comparison'];
const db=h.installDbStub(({text})=>{
 if(text.includes('SettingKey LIKE'))return keys.map(key=>({SettingKey:'REPORT_CFG_'+key,SettingValue:JSON.stringify({enabled:true,isoStamp:{code:'FM-QA-008',revision:'01',effectiveDate:'2026-10-01'}})}));
 if(text.includes('NATIVE_RECEIPT_HEADERS'))return [{ARReceID:1,PostID:1,DocuType:206,ReceiptNo:'RC-QA',Amount:123.45,CustCode:'0001'}];
 if(text.includes('NATIVE_CHEQUE_AS_OF'))return [{RowKind:'OPENING',StatusCode:'B',ChequeAmount:100,UnreplacedAmount:100,ChequeCount:1},{RowKind:'DETAIL',StatusCode:'P',ChequeNo:'0007',UnreplacedAmount:20,ChequeAmount:20,ChequeCount:1}];
 if(text.includes('WITH headers'))return [{EmpID:1,EmpCode:'0001',SalesName:'QA',DocuType:107,Sign:1,DocuNo:'J-QA',DocuDate:'2026-10-01',QtyTon:1,PricePerTon:100,LineGross:100,NetAmnt:100,VATAmnt:0,BillDiscAmnt:0}];
 if(text.includes('FROM wf.ReportTemplateAssignment a'))return [{TemplateId:1,TemplateCode:'QA',TemplateVersion:1,HeaderId:1,CompanyNameTh:'QA Company'}];
 return [];
},{activeUserIds:[1,2]});
let server,base;const express=require('express'),app=express();app.use('/api/reports',require('../routes/reports'));
test.before(async()=>{server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>new Promise(resolve=>server.close(resolve)));
const call=(path,user)=>fetch(base+path,{headers:{authorization:'Bearer '+h.token(user)}});
for(const key of keys)test(key+' JSON and Excel preserve native basis, ISO and numeric cells',async()=>{
 const params='?from=2026-10-01&to=2026-10-31';
 const r=await call('/api/reports/'+key+params,{sub:1,role:'ADMIN'});assert.equal(r.status,200);const data=await r.json();
 assert.ok(data.columns.length);assert.ok(data.rows.length);assert.equal(data.isoStamp.code,'FM-QA-008');assert.ok(data.meta.notes.length);
 const x=await call('/api/reports/'+key+'/export'+params,{sub:1,role:'ADMIN'});assert.equal(x.status,200);assert.match(x.headers.get('content-type'),/spreadsheetml/);
 const wb=XLSX.read(Buffer.from(await x.arrayBuffer()),{type:'buffer'}),sheet=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:null});
 assert.ok(rows.some(r=>r.some(c=>String(c).includes('FM-QA-008 Rev.01'))));assert.ok(rows.some(r=>r.includes(data.meta.notes[0])));
 if(key==='ar-receipt-history'){assert.ok(rows.some(r=>r.includes('0001')&&r.includes(123.45)));}
 if(key==='cq-cheque-register'){assert.ok(rows.some(r=>r.includes('0007')&&r.includes(0)));assert.ok(rows.some(r=>r.includes('ยอดยกมา (ไม่แสดงเลขเอกสารเดิม)')));}
 if(key==='sales-target-comparison'){assert.equal(data.rows[0].TargetAmt,null);assert.equal(data.rows[0].AchievedPct,null);assert.ok(rows.some(r=>r.includes('ยังไม่กำหนดงวดเป้า')));}
});
test('restricted SALES cannot read company-wide report data or export',async()=>{
 const before=db.calls.filter(c=>/NATIVE_RECEIPT|NATIVE_CHEQUE|NATIVE_SALES_TARGET/.test(c.text)).length;
 for(const key of keys)for(const suffix of ['','/export']){const r=await call('/api/reports/'+key+suffix,{sub:2,role:'SALES'});assert.equal(r.status,403);}
 assert.equal(db.calls.filter(c=>/NATIVE_RECEIPT|NATIVE_CHEQUE|NATIVE_SALES_TARGET/.test(c.text)).length,before);
});
