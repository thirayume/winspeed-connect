'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {attachOperationalReport}=require('../services/native-document-report');
test('v3 reports separate physical cuts and partial invoice segments without conflating actors',async()=>{
 const booking={SOID:10,BookingNo:'I00-00001',ConfirmedById:1};
 const q=async text=>{
  if(/AS Present/.test(text))return {recordset:[{Present:1,Ledger263:1}]};
  if(/IN\(119,104\)/.test(text))return {recordset:[
   {SOID:10,DocuType:119,NativeNo:'AI00-00001',UserId:2,ActorUserId:9},
   {SOID:10,DocuType:104,NativeId:20,NativeNo:'I00-00002',UserId:2,ActorUserId:9,Status:'CONSUMED',ApprovedById:3,ApproverActorId:9,RequestActorId:8}]};
  if(/ORDER BY r.CreatedAtUtc,r.RequestId/.test(text))return {recordset:[{SOID:10,Status:'CONSUMED',ApprovedById:3,ApproverActorId:9}]};
  return {recordset:[
   {SOID:10,DeliveryId:20,CouponNo:'C0000001',SlipNo:'9000001',RecorderEmp:'TEST-1',RequestUserId:1,ApprovedById:4,InvoiceNo:'J00-00001'},
   {SOID:10,DeliveryId:20,CouponNo:'C0000002',SlipNo:'9000001',RecorderEmp:'TEST-1',RequestUserId:1,ApprovedById:4,InvoiceNo:'J00-00001'},
   {SOID:10,DeliveryId:20,CouponNo:'C0000001',SlipNo:'9000002',RecorderEmp:'TEST-2',RequestUserId:1,ApprovedById:4,InvoiceNo:null}]};
 };
 const rows=await attachOperationalReport([booking,booking,{SOID:11,AiNo:'legacy'}],q);
 assert.equal(rows.length,3);
 assert.equal(rows[0].CouponNo,'C0000001, C0000002');assert.equal(rows[0].RecorderEmp,'TEST-1');
 assert.equal(rows[1].RecorderEmp,'TEST-2');assert.equal(rows[1].InvoiceNo,null);
 assert.equal(rows[0].ApproverEmp,null);assert.equal(rows[0].CreditActorId,9);
 assert.equal(rows[2].AiNo,'legacy');
});
test('pre-v3 databases and empty reports remain readable without querying missing tables',async()=>{
 let n=0;
 assert.deepEqual(await attachOperationalReport([],async()=>{throw Error('unexpected query');}),[]);
 const rows=[{SOID:1}];
 assert.equal(await attachOperationalReport(rows,async()=>{n++;return {recordset:[{Present:0,Ledger263:0}]};}),rows);
 assert.equal(n,1);
 for(const state of [{Present:0,Ledger263:1},{Present:1,Ledger263:0},{}])
  await assert.rejects(attachOperationalReport(rows,async()=>({recordset:[state]})),{status:503});
});
