'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {verifyShipmentClaimReservations}=require('../services/rebate-shipment-claim-verification');
function fixture(){
  const epoch={environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
  const claim={Id:4,CustId:'9',ClaimAmt:'375.00'};
  const base={SourceSOID:40,SourceListNo:1,PlanId:null,PricePerTon:'1500.00',NetPricePerTon:'1250.00',RebatePerTon:'250.00',GoodCode:'F'};
  const state={reservations:[{...base,AccrualId:1,QuantityTon:'1.000',AmountBaht:'250.00'},
      {...base,AccrualId:2,QuantityTon:'0.500',AmountBaht:'125.00'}],
    lines:[{...base,QtyTon:'1.000',LineAmount:'250.00',LineType:'REBATE'},
      {...base,QtyTon:'0.500',LineAmount:'125.00',LineType:'REBATE'}],seen:[],changed:false};
  const query=async(text,p)=>{
    if(/FROM wf.RebateShipmentReservation r/.test(text))return {recordset:state.reservations};
    if(/FROM wf.RebateClaimLine/.test(text))return {recordset:state.lines};
    throw Error('unexpected SQL');
  };
  const options={reserve:async(_q,_epoch,p)=>{if(state.changed)throw Object.assign(Error('changed'),{code:'REBATE_EVIDENCE_SOURCE_CHANGED'});state.seen.push(p);return {id:p.accrualId,replayed:true};}};
  return {state,claim,run:()=>verifyShipmentClaimReservations(query,epoch,claim,options)};
}
test('approval verifies every source and reconciles all reserved lines and amount',async()=>{
  const f=fixture();assert.deepEqual(await f.run(),{count:2});
  assert.deepEqual(f.state.seen.map(x=>[x.accrualId,x.documentId,x.documentType]),[[1,4,'CLAIM'],[2,4,'CLAIM']]);
});
test('changed or cancelled source stops approval',async()=>{
  const f=fixture();f.state.changed=true;await assert.rejects(f.run(),{code:'REBATE_EVIDENCE_SOURCE_CHANGED'});
});
test('missing reservation, altered lines, differing total and unsupported DIFF fail closed',async()=>{
  for(const mutate of [f=>f.state.reservations=[],f=>f.state.lines[0].QtyTon='0.900',f=>f.claim.ClaimAmt='374.99',
    f=>f.state.lines[0].LineType='DIFF',f=>f.state.lines[0].GoodCode='OTHER',
    f=>{f.state.lines[0].PricePerTon='1600.00';f.state.lines[0].NetPricePerTon='1100.00';},
    f=>f.state.lines[0].NetPricePerTon='900.00']){
    const f=fixture();mutate(f);await assert.rejects(f.run());
  }
});
