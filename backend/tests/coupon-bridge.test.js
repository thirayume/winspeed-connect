'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {editPlan}=require('../services/coupon-bridge-plan');
const {available}=require('../services/coupon-bridge-schema');
const {absent,current}=require('./helpers/coupon-bridge-metadata');
function fixture(){return {before:[{couponId:1,lineNo:1,quantity:'0.2'}],coupons:[{couponId:1,remaining:'0.4',held:'0.4'}],
 reservations:[{id:'9007199254740993',couponId:1,consumed:'0.2',remaining:'0.4',revision:3,inScope:true,active:true}],
 settlements:[{id:'9007199254740995',couponId:1,reservationId:'9007199254740993',quantity:'0.2'}]};}
test('reduction and cancellation append exact returns without editing original settlements or losing bigint IDs',()=>{
 const f=fixture(),original=JSON.stringify(f);
 const p=editPlan(f,[{couponId:1,quantity:'0.1'}],'E');
 assert.equal(p.allocations[0].delta,'-0.1000');assert.equal(p.allocations[0].reservationId,'9007199254740993');
 assert.equal(p.allocations[0].settlementId,'9007199254740995');assert.equal(JSON.stringify(f),original);
 assert.equal(editPlan(f,[],'D').allocations[0].delta,'-0.2000');
});
test('free native quantity is returned before consumption; repeat uses the remaining effective settlement only',()=>{
 const f=fixture();f.before[0].quantity='0.3';
 assert.equal(editPlan(f,[{couponId:1,quantity:'0.25'}],'E').allocations.length,0);
 f.before[0].quantity='0.1';f.settlements[0].quantity='0.1';f.reservations[0].consumed='0.1';f.coupons[0].held='0.5';f.coupons[0].remaining='0.5';
 assert.equal(editPlan(f,[],'D').allocations[0].delta,'-0.1000');
});
test('explicit own reservation may fund an increased or added line; another bill hold never funds it',()=>{
 const f=fixture();
 const p=editPlan(f,[{couponId:1,quantity:'0.3',settlements:[{reservationId:'9007199254740993',quantity:'0.1'}]}],'E');
 assert.equal(p.allocations[0].delta,'0.1000');
 assert.throws(()=>editPlan(f,[{couponId:1,quantity:'0.3'}],'E'),{code:'ND_COUPON_INSUFFICIENT'});
 f.reservations[0].nativeHeld=1;
 assert.throws(()=>editPlan(f,[{couponId:1,quantity:'0.3',settlements:[{reservationId:'9007199254740993',quantity:'0.1'}]}],'E'),{code:'ND_RESERVATION_UNAVAILABLE'});
});
test('removing one line and adding a different coupon preserves independent reservations',()=>{
 const f=fixture();f.coupons.push({couponId:2,remaining:'1',held:'0'});
 const p=editPlan(f,[{couponId:2,quantity:'0.05'}],'E');
 assert.equal(p.lines.find(l=>l.couponId===1).after,'0.0000');assert.equal(p.lines.find(l=>l.couponId===2).after,'0.0500');
 assert.equal(p.allocations[0].delta,'-0.2000');
});
test('partial scope, malformed quantities and duplicate lines cannot manufacture a return',()=>{
 const f=fixture();f.reservations[0].inScope=false;
 assert.throws(()=>editPlan(f,[],'D'),{code:'ND_RESERVATION_UNAVAILABLE'});
 assert.throws(()=>editPlan(f,[{couponId:1,quantity:'-0.1'}],'E'),{code:'ND_DECIMAL_INVALID'});
 assert.throws(()=>editPlan(f,[{couponId:1,quantity:'0.1'},{couponId:1,quantity:'0.1'}],'E'),{code:'ND_DUPLICATE_LINE'});
});
test('bridge availability distinguishes proved legacy absence, complete schema and unknown metadata',()=>{
 assert.equal(available(absent),false);assert.equal(available(current),true);
 for(const row of [{},{...absent,BridgeLedger:1},{...current,BridgeView:0},{...current,BridgeViewSelect:null},{...absent,BridgeSchemaSelect:0}])
  assert.throws(()=>available(row),{code:'COUPON_BRIDGE_SCHEMA_UNAVAILABLE'});
});
test('bridge flag is required before opening a transaction',async()=>{
 const {bridgeOperation}=require('../services/coupon-bridge-service');let opened=false;
 await assert.rejects(bridgeOperation({operation:'queue'},{env:{},transaction:()=>{opened=true;}}),{code:'ND_BRIDGE_DISABLED'});
 assert.equal(opened,false);
});

test('bridge-on refuses native operation before all connection and SQL-options protocols are recorded',async()=>{
 const {verifyOperationalMetadata}=require('../services/initial-invoice-metadata');
 const {moduleHash}=require('../services/coupon-bridge-hooks');
 for(const count of [undefined,null,0,1,2,3]){
  await assert.rejects(verifyOperationalMetadata(async query=>({recordset:query.includes('FROM wf.CouponBridgeContract')
   ?[{Enabled:1,ModulesHash:moduleHash,NativeProtocols:count}]:[]}),null,{env:{NATIVE_COUPON_BRIDGE_ENABLED:'true'}}),
  {message:'IP_METADATA_UNSUPPORTED'});
 }
});
test('approved source amendments use current bridge proof; pending or tampered proof blocks 107',async()=>{
 const {assertInvoiceCutProof}=require('../services/native-document-service');
 const plan={lines:[{redemptionId:4},{redemptionId:4}]};let calls=0;
 const row={NativeId:4,State:'ACTIVE',Revision:2,HeaderProof:'h',LineProof:'l',CurrentHeader:'h',CurrentLines:'l',Pending:0};
 await assertInvoiceCutProof(async()=>{calls++;return {recordset:[row]};},plan,()=>{throw Error('Old immutable receipt must not replace reviewed amendment');},{bridge:true});
 assert.equal(calls,1);
 for(const changed of [{...row,Pending:1},{...row,CurrentLines:'changed'}])
  await assert.rejects(assertInvoiceCutProof(async()=>({recordset:[changed]}),plan,undefined,{bridge:true}),
   {code:changed.Pending?'ND_CUT_BRIDGE_REVIEW_REQUIRED':'ND_CUT_DIVERGED'});
});
test('all known hooks are replaced explicitly and native trigger fingerprints remain unchanged',()=>{
 const hooks=require('../services/coupon-bridge-hooks'),baseline=require('../services/native-document-metadata.json').triggers;
 const expected=hooks.expectedTriggers(baseline);
 assert.equal(hooks.definitions.length,4);assert.equal(expected.length,baseline.length);
 for(let i=0;i<baseline.length;i++)if(!hooks.definitions.some(d=>d.name.toLowerCase()===baseline[i][1]))assert.deepEqual(expected[i],baseline[i]);
 for(const d of hooks.definitions){assert.match(d.sql,/ROLLBACK TRANSACTION/);assert.doesNotMatch(d.sql,/DISABLE TRIGGER/);}
});
