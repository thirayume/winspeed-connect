'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {reserveShipmentClaim}=require('../services/rebate-shipment-claim');
function fixture(){
  const epoch={environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',lastResetAtUtc:new Date('2026-01-01T00:00:00Z')};
  const make=(id,so,date)=>({AccrualId:id,SourceSOID:so,SourceListNo:1,SourceDocuNo:'TEST',SourceDocuDate:date,GoodCode:'F',GoodName:'TEST',
    PlanId:4,ListPricePerTon:'1500.00',NetPricePerTon:'1000.00',RebatePerTon:'500.00',RemainingTon:'1.000',RemainingAmountBaht:'500.00',
    OccurredAtUtc:new Date('2026-02-01T00:00:00Z')});
  const rows=[make(1,11,'2025-12-01'),make(2,12,'2026-02-01')], state={reservations:[],failAt:0,scope:null};
  const query=async text=>{if(/sp_getapplock/.test(text))return {recordset:[{LockResult:0}]};throw Error('Unexpected SQL');};
  const options={participantFence:async()=>{},scopeFilter:async()=>({sql:'actor_scope AND effective_scope',inputs:{}}),
    readLots:async(_q,p)=>{state.scope=p.scopeSql;return rows;},reserve:async(_q,_e,p)=>{if(state.failAt===p.accrualId)throw Error('source changed');state.reservations.push(p);}};
  const input={custId:9,claimId:10,startDate:'2026-01-01',lines:[{goodCode:'F',qtyTon:'0.500',openingBalance:true},{goodCode:'F',qtyTon:'0.250'}]};
  const run=async()=>{const before=structuredClone(state);try{return await reserveShipmentClaim(query,epoch,{sub:1},input,options);}catch(e){Object.assign(state,before);throw e;}};
  return {state,input,run,options};
}
test('claim reserves opening and current lots under both identity scopes',async()=>{
  const f=fixture(),r=await f.run();assert.equal(r.totalAmount,'375.00');assert.equal(f.state.scope,'actor_scope AND effective_scope');
  assert.deepEqual(f.state.reservations.map(p=>[p.accrualId,p.documentType,p.quantityTon]),[[1,'CLAIM','0.500'],[2,'CLAIM','0.250']]);
});
test('a later changed source rolls back the first reservation as well',async()=>{
  const f=fixture();f.state.failAt=2;await assert.rejects(f.run(),/source changed/);assert.deepEqual(f.state.reservations,[]);
});
test('unavailable participant or no visible lots fails before reservation',async()=>{
  const f=fixture();f.options.participantFence=async()=>{throw Error('reset');};await assert.rejects(f.run(),/reset/);assert.deepEqual(f.state.reservations,[]);
  const g=fixture();g.options.readLots=async()=>[];await assert.rejects(g.run(),{code:'REBATE_CUSTOMER_OUT_OF_SCOPE'});assert.deepEqual(g.state.reservations,[]);
});
