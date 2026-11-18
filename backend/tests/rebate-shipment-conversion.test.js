'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {executeShipmentSourceConversion}=require('../services/rebate-shipment-conversion');
function fixture(){
  const epoch={environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',lastResetAtUtc:new Date('2026-01-01T00:00:00Z')};
  const input={epoch,custId:9,goodId:20,standingYear:2025,asOfDate:'2026-06-01',actorUser:{id:37,role:'ACCOUNTING'},
    requestedAmountBaht:150,convertAllEligible:false,maturedOnly:false,note:'verified',cycleMonths:12,
    scopeSql:'SalesEmpId IN (@actor) AND SalesEmpId IN (@effective)',scopeInputs:{actor:1,effective:2}};
  const row={AccrualId:5,SourceSOID:40,SourceListNo:1,CouponId:30,GoodId:20,CustCode:'C',CustName:'TEST',
    OccurredAtUtc:new Date('2026-02-01T00:00:00Z'),EarnedDate:'2026-02-01',RebatePerTon:'500.00',RemainingTon:'1.000',RemainingAmountBaht:'500.00'};
  const state={conversions:[],reservations:[],rows:[row],failReserve:false,scopeSql:null,scopeParams:null};
  const query=async(text,p)=>{
    if (/FROM wf.RebateShipmentAccrual a/.test(text)){state.scopeSql=text;state.scopeParams=p;return {recordset:state.rows};}
    if (/INSERT INTO wf.FertilizerTicketConversion/.test(text)){
      const result={Id:1,CustId:p.custId,CustCode:p.custCode,CustName:p.custName,StandingYear:p.year,GoodId:p.goodId,
        GoodCode:p.goodCode,GoodName:p.goodName,StandingPricePerTon:p.price,ConvertedTons:p.tons,ConvertedBags:p.bags,
        ConvertedValueBaht:p.amount,ResidualBaht:p.residual,ConvertedByUserId:p.userId,ConvertedByRole:p.role,Status:'ISSUED'};
      state.conversions.push(result);return {recordset:[result]};
    }
    throw Error('Unexpected SQL');
  };
  const opts={standingPrice:async()=>({goodId:20,goodCode:'F',goodName:'TEST',basePrice:10000}),
    reserve:async(_q,_epoch,item)=>{if(state.failReserve)throw Error('source changed');state.reservations.push(item);}};
  const run=async()=>{const before=structuredClone(state);try{return await executeShipmentSourceConversion(query,input,opts);}catch(e){Object.assign(state,before);throw e;}};
  return {state,input,run};
}
test('conversion reserves FIFO verified shipments and carries both scope filters',async()=>{
  const f=fixture(),r=await f.run();
  assert.equal(r.conversion.convertedValueBaht,150);assert.equal(r.conversion.convertedByUserId,37);
  assert.deepEqual(f.state.reservations,[{accrualId:5,custId:9,documentId:1,documentType:'CONVERSION',quantityTon:'0.300'}]);
  assert.match(f.state.scopeSql,/SalesEmpId IN \(@actor\) AND SalesEmpId IN \(@effective\)/);
  assert.match(f.state.scopeSql,/l\.GoodID=a\.GoodId AND l\.CustId=CONVERT\(nvarchar\(20\),a\.CustId\)/);
  assert.equal(f.state.scopeParams.resetId,f.input.epoch.resetId);assert.equal(f.state.scopeParams.generation,1);
});
test('a changed source during reservation rolls back conversion',async()=>{
  const f=fixture();f.state.failReserve=true;await assert.rejects(f.run(),/source changed/);
  assert.deepEqual(f.state.conversions,[]);assert.deepEqual(f.state.reservations,[]);
});
test('empty scope and missing reset cannot issue a conversion',async()=>{
  const f=fixture();f.state.rows=[];await assert.rejects(f.run(),{code:'REBATE_CUSTOMER_OUT_OF_SCOPE'});
  const g=fixture();g.input.epoch.generation=0;await assert.rejects(g.run(),{code:'REBATE_RESET_EPOCH_INVALID'});
});
