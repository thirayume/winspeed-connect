'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let nativeLines,prior,invalidReservation,throwAt,identityOk,events,sqlCalls,headStatus;
const db=h.installDbStub(()=>[]);
const {manualSettleCouponDocument}=require('../services/coupon-manual-document-settlement');
const dataWindow={businessDate:'2026-01-01'};
const actor={sub:1,role:'ADMIN'};
const input={redemptionId:44,reason:'review the whole document',actor,dataWindow,items:[
  {reservationId:12,couponId:102,qty:0.2},{reservationId:11,couponId:101,qty:0.1},
]};
function fixture(){
  nativeLines=[{CouponID:101,GoodQty:0.1},{CouponID:102,GoodQty:0.2}];prior=false;invalidReservation=false;throwAt=null;identityOk=true;events=[];sqlCalls=[];headStatus='N';
  const tx={request(){const inputs={};return {input(k,t,v){inputs[k]=v;return this;},async query(text){
    sqlCalls.push({text,inputs:{...inputs}});
    if(text.includes('FROM dbo.WFCoupon'))return {recordset:[{CouponID:inputs.cid}]};
    if(text.includes('FROM wf.CouponReservation WITH'))return {recordset:invalidReservation?[]:[{Id:inputs.rid}]};
    if(text.includes('FROM dbo.WFRedemtionHD'))return {recordset:['N','Y'].includes(headStatus)?[{RedemtionID:44}]:[]};
    if(text.includes('FROM dbo.WFRedemtionDT'))return {recordset:structuredClone(nativeLines)};
    if(text.includes('FROM wf.CouponReservationSettlement'))return {recordset:prior?[{Existing:1}]:[]};
    throw Error('unexpected SQL');
  }};}};
  const deps={assertPrimaryDatabase:async()=>{if(!identityOk)throw Object.assign(Error('secondary'),{status:403});},
    couponVisible:async()=>true,reservationsVisible:async()=>true,
    wfTransaction:async fn=>{const before=structuredClone(events);try{return await fn(tx);}catch(err){events=before;throw err;}},
    settleOne:async p=>{assert.equal(p.actor,actor);assert.equal(p.dataWindow,dataWindow);assert.equal(await p.deps.wfTransaction(async t=>t),tx);
      events.push({id:p.reservationId,action:'settle+audit+outbox'});if(p.reservationId===throwAt)throw Error('AUDIT_FAILED');
      return {success:true,reservationId:p.reservationId,settledQty:p.qty,status:'CONSUMED'};}};
  return deps;
}
test('whole document settles in coupon lock order in one transaction',async()=>{
 const deps=fixture(),result=await manualSettleCouponDocument(input,deps);
 assert.deepEqual(result.settlements.map(x=>x.couponId),[101,102]);assert.deepEqual(events.map(x=>x.id),[11,12]);
 assert.deepEqual(sqlCalls.filter(x=>x.text.includes('FROM dbo.WFCoupon')).map(x=>x.inputs.cid),[101,102]);
 assert.match(sqlCalls.find(x=>x.text.includes('FROM dbo.WFRedemtionHD')).text,/ISNULL\(LTRIM\(RTRIM\(DocuStatus\)\),''\) IN \('N','Y'\)/);
 assert.ok(sqlCalls.every(c=>/UPDLOCK,HOLDLOCK/.test(c.text)));
});
test('second settlement or audit failure rolls back all document work',async()=>{
 const deps=fixture();throwAt=12;
 await assert.rejects(manualSettleCouponDocument(input,deps),/AUDIT_FAILED/);assert.deepEqual(events,[]);
});
test('a cancelled or unverified native document cannot settle any line',async()=>{
 for(const status of ['P','C',null,'']){
  const deps=fixture();headStatus=status;
  await assert.rejects(manualSettleCouponDocument(input,deps),{code:'COUPON_DOCUMENT_NOT_VERIFIED'});
  assert.deepEqual(events,[]);
 }
});
test('changed, duplicate, omitted or pre-linked document lines never settle',async()=>{
 for(const mode of ['quantity','duplicate','missing','prior','reservation']){
  const deps=fixture();
  if(mode==='quantity')nativeLines[1].GoodQty=0.3;
  if(mode==='duplicate')nativeLines[1].CouponID=101;
  if(mode==='missing')nativeLines.pop();
  if(mode==='prior')prior=true;
  if(mode==='reservation')invalidReservation=true;
  await assert.rejects(manualSettleCouponDocument(input,deps),e=>[404,409].includes(e.status));assert.deepEqual(events,[]);
 }
});
test('secondary database, missing capability, bad precision and duplicate requests fail closed',async()=>{
 const deps=fixture();identityOk=false;await assert.rejects(manualSettleCouponDocument(input,deps),e=>e.status===403);assert.deepEqual(events,[]);
 for(const invalid of [{...input,actor:{sub:3,role:'SALES'}},{...input,items:[input.items[0],input.items[0]]},
   {...input,items:[{...input.items[0],qty:0.00001}]},{...input,dataWindow:{businessDate:'bad'}}]){
  const d=fixture();await assert.rejects(manualSettleCouponDocument(invalid,d),e=>[400,403,503].includes(e.status));assert.deepEqual(events,[]);
 }
});
test('out-of-scope coupon or reservation fails before any native document is read',async()=>{
 for(const which of ['couponVisible','reservationsVisible']){
  const deps=fixture();deps[which]=async()=>false;
  await assert.rejects(manualSettleCouponDocument(input,deps),e=>e.status===404);
  assert.equal(sqlCalls.some(c=>c.text.includes('WFRedemtion')),false);assert.deepEqual(events,[]);
 }
});
test('document route capability checks both the effective user and Access As actor',()=>{
 const guard=require('../middleware/auth').requireCapability('coupon.settle');
 function check(user){let next=false,status=200;guard({user},{status(n){status=n;return this;},json(){return this;}},()=>{next=true;});return {next,status};}
 assert.deepEqual(check({role:'MANAGER'}),{next:true,status:200});
 assert.deepEqual(check({role:'SALES'}),{next:false,status:403});
 assert.deepEqual(check({role:'ACCOUNTING',actorRole:'SALES',isImpersonating:true}),{next:false,status:403});
 assert.deepEqual(check({role:'ACCOUNTING',actorRole:'ADMIN',isImpersonating:true}),{next:true,status:200});
});
