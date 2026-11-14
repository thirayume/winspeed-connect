'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {withSoRebateTransaction,assertNoRedeemedTicketForBooking}=require('../services/so-rebate-transaction');

function fixture(enabled=true){
  const events=[], epoch={generation:1}, tx={id:'transaction'}, q={id:'query'};
  const options={env:{REBATE_POOL_103_ENABLED:enabled?'true':'false'},db:{sql:{}},
    transaction:async fn=>{events.push('begin');try{const value=await fn(tx);events.push('commit');return value;}catch(e){events.push('rollback');throw e;}},
    routeFence:async fn=>{events.push('global-enter');try{return await fn(epoch);}finally{events.push('global-exit');}},
    participantFence:async(query,value)=>{assert.equal(query,q);assert.equal(value,epoch);events.push('participant');},
    transactionQuery:()=>q};
  return {events,tx,epoch,options};
}
test('new rebate holds the global and participant fences through commit',async()=>{
  const f=fixture();const result=await withSoRebateTransaction(async(tx,epoch)=>{
    assert.equal(tx,f.tx);assert.equal(epoch,f.epoch);f.events.push('business');return 42;
  },f.options);
  assert.equal(result,42);assert.deepEqual(f.events,['global-enter','begin','participant','business','commit','global-exit']);
});
test('a participant fence failure rolls back before business changes',async()=>{
  const f=fixture();f.options.participantFence=async()=>{f.events.push('participant');throw Error('epoch changed');};
  await assert.rejects(withSoRebateTransaction(async()=>f.events.push('business'),f.options),/epoch changed/);
  assert.deepEqual(f.events,['global-enter','begin','participant','rollback','global-exit']);
});
test('legacy mode keeps the existing transaction path without requiring a coordinator',async()=>{
  const f=fixture(false);await withSoRebateTransaction(async()=>f.events.push('business'),f.options);
  assert.deepEqual(f.events,['begin','business','commit']);
});
test('native booking with a redeemed ticket cannot be edited or cancelled',async()=>{
  const calls=[],db={sql:{Int:'int'}};
  const tx={request:()=>({input(){return this;},async query(text){calls.push(text);return {recordset:calls.length===1?[{SOID:7}]:[{Id:8}]};}})};
  await assert.rejects(assertNoRedeemedTicketForBooking(tx,{Id:7,ImportedDocuNo:'I69-00001'},
    {env:{REBATE_POOL_103_ENABLED:'true'},db}),{code:'TICKET_REDEMPTION_LINKED'});
  assert.match(calls[0],/dbo\.SOHD/);assert.match(calls[1],/RebateTicketRedemptionReceipt/);
});
test('a draft or legacy mode does not query native receipts',async()=>{
  const tx={request(){throw Error('unexpected query');}};
  await assertNoRedeemedTicketForBooking(tx,{Id:7},{env:{REBATE_POOL_103_ENABLED:'true'}});
  await assertNoRedeemedTicketForBooking(tx,{Id:7,ImportedDocuNo:'I69-00001'},{env:{REBATE_POOL_103_ENABLED:'false'}});
});
test('a native booking without a receipt may proceed, but missing native source fails closed',async()=>{
  let bookingExists=true,count=0;const db={sql:{Int:'int'}};
  const tx={request:()=>({input(){return this;},async query(text){count++;
    return {recordset:/dbo\.SOHD/.test(text)?(bookingExists?[{SOID:7}]:[]):[]};}})};
  await assertNoRedeemedTicketForBooking(tx,{Id:7,ImportedDocuNo:'I69-00001'},{env:{REBATE_POOL_103_ENABLED:'true'},db});
  assert.equal(count,2);bookingExists=false;
  await assert.rejects(assertNoRedeemedTicketForBooking(tx,{Id:7,ImportedDocuNo:'I69-00001'},
    {env:{REBATE_POOL_103_ENABLED:'true'},db}),{code:'TICKET_BOOKING_NOT_FOUND'});
});
