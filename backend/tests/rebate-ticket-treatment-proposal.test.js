'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {proposeTicketLine}=require('../services/rebate-ticket-treatment-proposal');

test('one ton remains one ton when the sale price differs from the historical conversion price',()=>{
  const zero=proposeTicketLine({treatment:'ZERO',quantityTon:'1',sellingPricePerTon:'18000'});
  const discount=proposeTicketLine({treatment:'DISCOUNT',quantityTon:'1',sellingPricePerTon:'18000'});
  assert.deepEqual([zero.quantityTon,zero.linePrice,zero.lineGross,zero.proposedDiscount,zero.payableForTicketLine],
    ['1.0000','0.0000','0.0000','0.0000','0.0000']);
  assert.deepEqual([discount.linePrice,discount.lineGross,discount.proposedDiscount,discount.payableForTicketLine],
    ['18000.0000','18000.0000','18000.0000','0.0000']);
  assert.equal(zero.readyForNativeWrite,false);
  assert.equal(discount.readyForNativeWrite,false);
});
test('fractional tons use exact fixed-point multiplication',()=>{
  const r=proposeTicketLine({treatment:'DISCOUNT',quantityTon:'0.6000',sellingPricePerTon:'17500.0000'});
  assert.equal(r.lineGross,'10500.0000');assert.equal(r.proposedDiscount,'10500.0000');
});
test('rejects ambiguous precision, invalid prices and money overflow',()=>{
  assert.throws(()=>proposeTicketLine({treatment:'DISCOUNT',quantityTon:'0.0001',sellingPricePerTon:'0.0001'}),
    {code:'TICKET_AMOUNT_PRECISION_UNSUPPORTED'});
  assert.throws(()=>proposeTicketLine({treatment:'ZERO',quantityTon:'1',sellingPricePerTon:'-1'}),{code:'TICKET_PRICE_INVALID'});
  assert.throws(()=>proposeTicketLine({treatment:'DISCOUNT',quantityTon:'2',sellingPricePerTon:'922337203685477.5807'}),
    {code:'TICKET_AMOUNT_OVERFLOW'});
  assert.throws(()=>proposeTicketLine({treatment:'UNKNOWN',quantityTon:'1',sellingPricePerTon:'1'}),{code:'TICKET_TREATMENT_INVALID'});
});
