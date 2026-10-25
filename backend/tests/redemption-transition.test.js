'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {isInitialRedemptionTransition:accept}=require('../services/redemption-transition');
const baseline=()=>Array.from({length:10},(_,i)=>i===4?'<row><CouponID>1</CouponID><RemaQty>1.0000</RemaQty><GoodQty>1.0000</GoodQty></row>':'snapshot-'+i);
const next=b=>b.map((s,i)=>i===4?s.replace('<RemaQty>1.0000','<RemaQty>0.0000'):s);
test('only a whole issued coupon can become fully redeemed',()=>{
 const b=baseline();assert.equal(accept(b,next(b)),true);
 for(const value of ['0.5000','2.0000','-1.0000','NaN']){const a=next(b);a[4]=a[4].replace('<RemaQty>0.0000','<RemaQty>'+value);assert.equal(accept(b,a),false);}
});
test('every source104 or202 finance alteration is rejected',()=>{
 const b=baseline();for(let i=0;i<10;i++){if(i===4)continue;const a=next(b);a[i]+='changed';assert.equal(accept(b,a),false);}
 const a=next(b);a[4]=a[4].replace('CouponID>1','CouponID>2');assert.equal(accept(b,a),false);
});
test('ambiguous rows, nil balances, missing parts and repeat deduction fail closed',()=>{
 const b=baseline();for(const coupon of [b[4]+b[4],'<row><RemaQty xsi:nil="true" /></row>','<row/>']){const x=[...b];x[4]=coupon;assert.equal(accept(x,next(x)),false);}
 const a=next(b);assert.equal(accept(a,a),false);assert.equal(accept(b.slice(1),a.slice(1)),false);assert.equal(accept(null,a),false);
});
