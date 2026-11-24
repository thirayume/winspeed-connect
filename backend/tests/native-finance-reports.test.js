'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const reports=require('../services/native-finance-reports');
const readGlobalDataWindow=async()=>({businessDate:'2026-01-01'});
test('receipt history preserves one amount across multiple invoices and cheques, hiding pre-window references',async()=>{
 const calls=[];const result=await reports.receipts({from:'2026-10-01',to:'2026-10-31',custCode:'0001',receiptType:'DEBT'},{readGlobalDataWindow,queryFn:async(text,p)=>{
  calls.push({text,p});
  if(text.includes('NATIVE_RECEIPT_HEADERS'))return {recordset:[{ARReceID:1,PostID:88,DocuType:206,ReceiptNo:'RC-QA',Amount:100,CashAmount:30,ChequeAmount:70}]};
  if(text.includes('NATIVE_RECEIPT_REFERENCES'))return {recordset:[{ARReceID:1,RefNo:'J-QA',RefDate:'2026-10-01'},{ARReceID:1,RefNo:'J-QA',RefDate:'2026-10-01'},{ARReceID:1,RefState:'BEFORE_START'}]};
  return {recordset:[{FromID:88,CheqID:10,ChequeNo:'0007'},{FromID:88,CheqID:11,ChequeNo:'0007'},{FromID:88,CheqID:11,ChequeNo:'0007'}]};
 }});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].Amount,100);assert.equal(result.rows[0].RefDocNo,'J-QA (2026-10-01), อ้างอิงก่อนวันเริ่มข้อมูล');
 assert.equal(result.rows[0].ChequeRefs,'0007, 0007');assert.equal(result.rows[0].ARReceID,undefined);
 assert.match(calls[0].text,/h.DocuType IN\(206,108\)/);assert.match(calls[0].text,/h.DocuDate>=@globalStartDate/);
 assert.equal(calls[0].p.custCode.value,'0001');assert.equal(calls[0].p.receiptType.value,'DEBT');
 assert.match(calls[2].text,/l.FromID IN/);assert.equal(calls[2].p.p0.value,88);
});
test('receipt preview caps whole documents while export uses the larger bound',async()=>{
 const headers=Array.from({length:1001},(_,i)=>({ARReceID:i+1,DocuType:206,Amount:1}));
 const queryFn=async text=>({recordset:text.includes('NATIVE_RECEIPT_HEADERS')?headers:[]});
 const preview=await reports.receipts({},{readGlobalDataWindow,queryFn});assert.equal(preview.rows.length,1000);assert.equal(preview.meta.isTruncated,true);
 const exported=await reports.receipts({exportAll:'true'},{readGlobalDataWindow,queryFn});assert.equal(exported.rows.length,1001);assert.equal(exported.meta.isTruncated,false);
});
test('cheque report retains opening amounts without historic identities and distinguishes cleared from open amounts',async()=>{
 let statement,p;const result=await reports.cheques({from:'2026-10-01',to:'2026-10-31',bankCode:'001',status:'ALL'},{readGlobalDataWindow,queryFn:async(s,i)=>{statement=s;p=i;return {recordset:[{RowKind:'OPENING',ChequeAmount:90,UnreplacedAmount:80,StatusCode:'B',ChequeCount:2},{RowKind:'DETAIL',ChequeNo:'0007',ChequeAmount:20,UnreplacedAmount:20,StatusCode:'P',ChequeCount:1}]};}});
 assert.equal(result.rows[0].ChequeNo,undefined);assert.equal(result.rows[0].OpenAmount,80);assert.equal(result.rows[1].OpenAmount,0);
 assert.equal(result.rows[1].Status,'เช็คผ่าน');assert.match(statement,/h.DocuDate<DATEADD\(day,1,@to\)/);assert.match(statement,/d.DocuStatus='N'/);
 assert.match(statement,/SUM\(ISNULL\(d.CheqRemaAmnt,0\)\)/);assert.match(statement,/c.CheqType='1' AND c.CheqCard='1'/);assert.doesNotMatch(statement,/c.CheqStat/);
 assert.equal(p.bankCode.value,'001');assert.equal(p.globalStartDate.value,'2026-01-01');
});
test('unknown cheque states stay visible and suppress a misleading outstanding total',async()=>{
 const r=await reports.cheques({},{readGlobalDataWindow,queryFn:async()=>({recordset:[{RowKind:'DETAIL',StatusCode:'?',UnreplacedAmount:20,ChequeCount:1}]})});
 assert.equal(r.rows[0].OpenAmount,null);assert.equal(r.meta.isPartialScope,true);assert.equal(r.columns.find(c=>c.key==='OpenAmount').aggregation,undefined);
});
test('invalid dates/statuses and missing primary cutoff fail before a native read',async()=>{
 let calls=0;const options={readGlobalDataWindow,queryFn:async()=>{calls++;return {recordset:[]};}};
 await assert.rejects(reports.cheques({status:'INVENTED'},options),/สถานะ/);
 await assert.rejects(reports.receipts({receiptType:'REBATE'},options),/ประเภท/);
 await assert.rejects(reports.receipts({from:'2026-02-30'},options),/วันที่/);
 await assert.rejects(reports.receipts({},{...options,readGlobalDataWindow:async()=>{throw Error('PRIMARY_UNAVAILABLE');}}),/PRIMARY_UNAVAILABLE/);
 assert.equal(calls,0);
});

test('invalid replacement amounts suppress outstanding totals including redacted opening groups',async()=>{
 const r=await reports.cheques({},{readGlobalDataWindow,queryFn:async()=>({recordset:[{RowKind:'OPENING',StatusCode:'B',UnreplacedAmount:10,InvalidAmountCount:1,ChequeCount:3},{RowKind:'DETAIL',StatusCode:'H',UnreplacedAmount:-2,ChequeCount:1}]})});
 assert.ok(r.rows.every(x=>x.OpenAmount===null));assert.equal(r.meta.invalidAmountCount,2);assert.equal(r.meta.isPartialScope,true);assert.equal(r.columns.find(c=>c.key==='OpenAmount').aggregation,undefined);
});
