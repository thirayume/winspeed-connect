'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {nativeDocument,planXml,httpError}=require('../services/native-document-service');
test('operational writes fail before opening a transaction when the writer or stage is disabled',async()=>{
 let opened=0;const options={env:{},transaction:async()=>{opened++;}};
 await assert.rejects(nativeDocument({operation:'apply',type:104,sourceId:1,user:{sub:1}},options),{code:'ND_WRITER_DISABLED'});
 await assert.rejects(nativeDocument({operation:'apply',type:104,sourceId:1,user:{sub:1}},{...options,env:{NATIVE_DOCUMENT_WRITER_VERSION:'v3'}}),{code:'ND_WRITER_DISABLED'});
 assert.equal(opened,0);
});
test('invalid source IDs and idempotency keys cannot start a native transaction',async()=>{
 let opened=0;const options={env:{NATIVE_DOCUMENT_WRITER_VERSION:'v3',NATIVE_MANUAL_116_ENABLED:'true'},transaction:async()=>{opened++;}};
 for(const sourceId of ['1;DROP TABLE wf.AppUser','0','2147483648'])await assert.rejects(nativeDocument({type:116,sourceId,operation:'apply'},options),{code:'ND_ID_INVALID'});
 await assert.rejects(nativeDocument({type:116,sourceId:1,operation:'apply',requestId:'abc'},options),{code:'ND_REQUEST_INVALID'});
 assert.equal(opened,0);
});
test('persisted plans escape physical evidence and retain exact decimal/bigint reservation values',()=>{
 const xml=planXml({version:'NATIVE-DOCUMENTS-v3',kind:116,custId:3,receiver:'A & "<B>\'',exception:true,lines:[
  {couponId:9,quantity:'0.0001',settlements:[{reservationId:'9007199254740993',quantity:'0.0001',revision:1,beforeConsumed:'0.0000'}]}]},3);
 assert.match(xml,/receiver="A &amp; &quot;&lt;B&gt;&apos;"/);
 assert.match(xml,/type="116" sourceId="3"/);assert.match(xml,/exception="1"/);
 assert.match(xml,/reservationId="9007199254740993"/);assert.match(xml,/quantity="0.0001"/);
 assert.doesNotMatch(xml,/\[object Object\]/);
});
test('HTTP errors expose stable codes rather than native SQL or customer details',()=>{
 assert.deepEqual(httpError(Object.assign(Error('no'),{code:'ND_SOURCE_CHANGED',status:409})),{status:409,code:'ND_SOURCE_CHANGED'});
 assert.deepEqual(httpError(Error('SQL failed at a private value')),{status:503,code:'ND_OPERATION_FAILED'});
 assert.deepEqual(httpError(Error('ND_COUPON_INSUFFICIENT')),{status:409,code:'ND_COUPON_INSUFFICIENT'});
});
test('locked credit policies run serially on one transaction connection and retain opening debt',async()=>{
 const {creditSummary}=require('../services/native-document-source');
 let active=0,max=0,count=0;
 const q=async(text,p={})=>{
  active++;max=Math.max(max,active);count++;
  assert.doesNotMatch(text,/NOLOCK/);assert.match(text,/UPDLOCK,HOLDLOCK/);
  await new Promise(resolve=>setTimeout(resolve,2));
  let rows=[];
  if(/GLOBAL_DATA_START_DATE/.test(text))rows=[{SettingValue:'2026-01-01'}];
  else if(/AS CustLimit/.test(text))rows=[{CustID:1,CustLimit:100,AgingDaysLimit:60,CreditHold:0}];
  else if(p.key)rows=[{SettingValue:p.key.value==='CREDIT_AGING_DEFAULT_DAYS'?'60':p.key.value==='CREDIT_AGING_MAX_DAYS'?'90':'false'}];
  else if(/AS TotalOutstanding/.test(text))rows=[{TotalOutstanding:25}];
  else if(/AS UnpaidAmnt/.test(text))rows=[{DocuNo:'PRIVATE-OPENING',DocuDate:'2025-12-31',UnpaidAmnt:25,AgeDays:100}];
  active--;return {recordset:rows};
 };
 const result=await creditSummary(q,1,'10.0000');
 assert.equal(max,1);assert.equal(count,9);assert.equal(result.projectedTotal,35);
 assert.equal(result.openingOverdueAmount,25);assert.equal(result.openingOverdueCount,1);
 assert.deepEqual(result.overdueInvoices,[]);
 assert.ok(!JSON.stringify(result).includes('PRIVATE-OPENING'));
});
