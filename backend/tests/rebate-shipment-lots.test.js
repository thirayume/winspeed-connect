'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readShipmentLots}=require('../services/rebate-shipment-lots');
test('shipment lots use ledger pricing and native references without the legacy rebate plan',async()=>{
  let sql,params;
  await readShipmentLots(async(text,p)=>{sql=text;params=p;return {recordset:[]};},
    {epoch:{environment:'uat',resetId:'test',generation:1},custId:7,scopeSql:'SalesEmpId=@allowed',scopeInputs:{allowed:4}});
  assert.doesNotMatch(sql,/v_RebateAccrualLot|RebatePlan/);
  assert.match(sql,/l\.SourceRefSOID=a\.BookingSOID AND l\.SourceRefListNo=a\.BookingLineNo/);
  assert.match(sql,/r\.Status='ACTIVE'/);
  assert.equal(params.allowed,4);assert.equal(params.cid,7);
});
