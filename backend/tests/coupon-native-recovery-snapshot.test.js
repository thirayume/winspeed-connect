'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadNativeRecoverySnapshotForUpdate}=require('../services/coupon-native-recovery-snapshot');
const initial=[{ListNo:2,CouponId:20,Qty:'0.1000',ExactQty:1},{ListNo:1,CouponId:10,Qty:'0.2000',ExactQty:1}];
const header={RedemtionID:99,DocuNo:'QA-116',DocuType:116,DocuStatus:'N',DocuDate:'2025-12-31'};
function fixture(opts={}) {
 const calls=[];let lineQuery=0;
 const tx={request(){const inputs={};return {input(k,_t,v){inputs[k]=v;return this;},async query(text){
  calls.push({text,inputs:{...inputs}});
  if(text.includes('@@TRANCOUNT'))return {recordset:opts.context??[{TransactionCount:1,TransactionState:1}]};
  if(text.includes('FROM dbo.WFRedemtionDT')){lineQuery++;return {recordset:lineQuery===1?(opts.discovery??initial):(opts.locked??initial)};}
  if(text.includes('FROM dbo.WFCoupon'))return {recordset:opts.missingCoupon===inputs.cid?[]:[{CouponId:inputs.cid,Balance:'0.5000',ExactBalance:opts.badBalance?0:1}]};
  if(text.includes('FROM dbo.WFRedemtionHD'))return {recordset:opts.headers??[header]};
  throw Error('unexpected query');
 }}}};
 return {tx,calls};
}
test('locks complete source and coupons in stable order without filtering old evidence',async()=>{
 const f=fixture(),result=await loadNativeRecoverySnapshotForUpdate(f.tx,99);
 assert.equal(result.docuDate,'2025-12-31');assert.equal(result.requiresAtomicProof,true);
 assert.deepEqual(result.lines.map(x=>[x.couponId,x.nativeBalance]),[[10,'0.5000'],[20,'0.5000']]);
 assert.deepEqual(f.calls.filter(x=>x.text.includes('FROM dbo.WFCoupon')).map(x=>x.inputs.cid),[10,20]);
 assert.match(f.calls[1].text,/WITH \(READCOMMITTED\)/);
 assert.match(f.calls.at(-1).text,/WITH \(UPDLOCK,HOLDLOCK\)/);
 assert.ok(f.calls.every(x=>!/(?:INSERT|UPDATE\s+dbo|DELETE\s+FROM)/i.test(x.text)));
 assert.doesNotMatch(f.calls.map(x=>x.text).join('\n'),/cutoff|globalStart/i);
});
test('rejects changed, missing, duplicated or invalid source lines',async()=>{
 for(const opts of [
  {discovery:[]},{discovery:[...initial,initial[0]]},{locked:[initial[0]]},
  {locked:[initial[0],{...initial[1],Qty:'0.2500'}]},
  {discovery:[{...initial[0],ExactQty:0}]},{missingCoupon:10},{badBalance:true},
  {headers:[]},{headers:[{...header,DocuStatus:'P'}]},{headers:[{...header,DocuDate:null}]},
 ]) {
  const f=fixture(opts);
  await assert.rejects(loadNativeRecoverySnapshotForUpdate(f.tx,99),e=>e.status===409);
 }
});
test('rejects invalid identifiers and uncommittable transactions',async()=>{
 for(const input of [0,-1,1.5,'1e2',null,2147483648])await assert.rejects(loadNativeRecoverySnapshotForUpdate(fixture().tx,input),{code:'RECOVERY_SNAPSHOT_INVALID'});
 for(const context of [[],[{TransactionCount:0,TransactionState:1}],[{TransactionCount:1,TransactionState:-1}]])
  await assert.rejects(loadNativeRecoverySnapshotForUpdate(fixture({context}).tx,99),{code:'RECOVERY_SNAPSHOT_INVALID'});
});
