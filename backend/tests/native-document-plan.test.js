'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const p=require('../services/native-document-plan');
function delivery(overrides={}){return {soid:1,docNo:'I26-00001',gross:'15000',discount:'200',taxBase:'14800',tax:'0',net:'14800',vatRate:'0',vatType:'2',
 lines:[{lineNo:1,goodId:10,quantity:'1',remaining:'1',price:'15000',amount:'15000',packKg:'50'},
 {lineNo:2,goodId:20,quantity:'0.05',remaining:'0.05',price:'0',amount:'0',packKg:'50',rebateTicketVerified:true}],...overrides};}
const coupon=(couponId,overrides={})=>({couponId,couponNo:'C2600001',deliveryNo:'I26-00001',deliveryId:2,sourceLineNo:1,
 goodId:10,custId:3,inScope:true,beneficiaryValid:true,remaining:'0.6',reserved:'0.1',expiryDate:'2026-11-30',...overrides});
const cut=(qty,overrides={})=>({redemptionId:3,lineNo:1,sourceLineNo:1,quantity:qty,docDate:'2026-11-22',deliveryId:2,uninvoiced:true,...overrides});
const invoice=overrides=>({...delivery(),deliveryId:2,deliveryNo:'I26-00001',docDate:'2026-11-22',...overrides});
test('multi-line 104 keeps paid and verified zero-price Rebate goods separate and conserves 202 amounts',()=>{
 const result=p.planDelivery(delivery());
 assert.equal(result.lines.length,2);assert.deepEqual(result.lines.map(l=>l.sacks),[20,1]);
 assert.deepEqual(result.lines.map(l=>l.taxBase),['14800.0000','0.0000']);
 assert.deepEqual(result.lines.map(l=>l.discount),['200.0000','0.0000']);assert.equal(result.couponSeries,'C');
 const taxable=p.planDelivery(delivery({docNo:'K26-00001',vatRate:'7',tax:'1036',net:'15836'}));
 assert.equal(taxable.couponSeries,'D');assert.equal(taxable.net,'15836.0000');
});
test('header discounts allocate deterministically over unordered unequal lines including a full discount',()=>{
 const input=delivery({gross:'300',discount:'100',taxBase:'200',net:'200',lines:[
  {lineNo:3,goodId:30,quantity:'1',remaining:'1',price:'200',amount:'200',packKg:'50'},
  {lineNo:1,goodId:10,quantity:'1',remaining:'1',price:'100',amount:'100',packKg:'50'}]});
 const result=p.planDelivery(input);assert.deepEqual(result.lines.map(l=>l.discount),['33.3333','66.6667']);
 assert.deepEqual(p.planDelivery({...input,discount:'300',taxBase:'0',net:'0'}).lines.map(l=>l.taxBase),['0.0000','0.0000']);
});
test('invalid 104 source, duplicate lines, fractional bags and unverified zero-price lines are refused',()=>{
 const d=delivery();
 for(const source of [{...d,net:'14799'}, {...d,lines:[d.lines[0],d.lines[0]]},
  {...d,lines:[{...d.lines[0],quantity:'0.01',remaining:'0.01'}]},
  {...d,lines:[d.lines[0],{...d.lines[1],rebateTicketVerified:false}]}])assert.throws(()=>p.planDelivery(source));
});
test('116 permits partial mixed C/D draws and sorts locks by coupon ID',()=>{
 const result=p.planRedemption({custId:3,docDate:'2026-11-22',coupons:[coupon(9),coupon(7,{couponNo:'D2600001',deliveryNo:'K26-00001',deliveryId:4})]},
  [{couponId:9,quantity:'0.1'},{couponId:7,quantity:'0.25'}]);
 assert.deepEqual(result.lines.map(l=>l.couponId),[7,9]);assert.equal(result.quantity,'0.3500');assert.deepEqual(result.lines.map(l=>l.book),['K','I']);
});
test('116 cannot duplicate, spend reserved stock or cross customer scope; expiry warns and permits use',()=>{
 for(const [coupons,selection,code] of [
  [[coupon(9)],[{couponId:9,quantity:'0.1'},{couponId:9,quantity:'0.1'}],'ND_DUPLICATE_LINE'],
  [[coupon(9)],[{couponId:9,quantity:'0.5001'}],'ND_COUPON_INSUFFICIENT'],
  [[coupon(9,{inScope:false})],[{couponId:9,quantity:'0.1'}],'ND_COUPON_NOT_FOUND'],
  [[coupon(9,{beneficiaryValid:false})],[{couponId:9,quantity:'0.1'}],'ND_COUPON_NOT_FOUND'],
  [[coupon(9,{custId:4})],[{couponId:9,quantity:'0.1'}],'ND_COUPON_NOT_FOUND'],
 ])assert.throws(()=>p.planRedemption({custId:3,docDate:'2026-11-22',coupons},selection),{code});
 assert.equal(p.planRedemption({custId:3,docDate:'2026-11-30',coupons:[coupon(9)]},[{couponId:9,quantity:'0.1'}]).kind,116);
 const expired=p.planRedemption({custId:3,docDate:'2026-11-22',coupons:[coupon(9,{expiryDate:'2026-11-21'})]},[{couponId:9,quantity:'0.1'}]);
 assert.equal(expired.lines[0].expired,true);assert.equal(expired.lines[0].quantity,'0.1000');
});
test('107 carries proportionate discount through partial cuts and the final quantities close exactly',()=>{
 const source=invoice(),first=p.planInvoice(source,[cut('0.3')]);
 assert.equal(first.gross,'4500.0000');assert.equal(first.discount,'60.0000');assert.equal(first.net,'4440.0000');assert.equal(first.series,'J');
 source.lines[0]={...source.lines[0],invoicedQuantity:'0.3',invoicedGross:first.gross,invoicedDiscount:first.discount};
 const rest=p.planInvoice(source,[cut('0.7',{redemptionId:4}),cut('0.05',{redemptionId:5,sourceLineNo:2})]);
 assert.equal(rest.net,'10360.0000');assert.equal(p.fixed(first.net)+p.fixed(rest.net),148000000n);assert.equal(rest.lines.length,2);
});
test('107 cumulative tax rounding and full-discount partials leave no value stranded',()=>{
 const s=invoice({deliveryNo:'K26-00001',docNo:'K26-00001',gross:'1',discount:'0',taxBase:'1',tax:'0.07',net:'1.07',vatRate:'7',
  lines:[{lineNo:1,goodId:10,quantity:'1',remaining:'1',price:'1',amount:'1',packKg:'50'}]});
 let tax=0n,net=0n;
 for(const [i,qty] of ['0.3333','0.3333','0.3334'].entries()){
  const result=p.planInvoice({...s,priorTax:p.decimal(tax)},[cut(qty,{redemptionId:i+1})]);
  const line=s.lines[0];line.invoicedQuantity=p.decimal(p.fixed(line.invoicedQuantity||'0')+p.fixed(qty));
  line.invoicedGross=p.decimal(p.fixed(line.invoicedGross||'0')+p.fixed(result.gross));line.invoicedDiscount='0';
  tax+=p.fixed(result.tax);net+=p.fixed(result.net);
 }
 assert.equal(tax,700n);assert.equal(net,10700n);
 const zero=p.planInvoice(invoice({discount:'15000',taxBase:'0',net:'0'}),[cut('0.3')]);assert.equal(zero.net,'0.0000');
});
test('107 refuses missing/edited history, duplicate cuts, other orders and other transport dates',()=>{
 for(const [source,selection,code] of [
  [invoice({lines:delivery().lines.map(r=>({...r,invoicedQuantity:'0.1'}))}),[cut('0.1')],'ND_INVOICE_HISTORY_MISMATCH'],
  [invoice(),[cut('0.1'),cut('0.1')],'ND_DUPLICATE_LINE'],
  [invoice(),[cut('0.1',{deliveryId:99})],'ND_CUT_SOURCE_MISMATCH'],
  [invoice(),[cut('0.1',{docDate:'2026-11-21'})],'ND_CUT_SOURCE_MISMATCH'],
  [invoice(),[cut('0.1',{uninvoiced:false})],'ND_CUT_SOURCE_MISMATCH'],
 ])assert.throws(()=>p.planInvoice(source,selection),{code});
});
test('SQL decimal precision remains exact above the JS safe integer boundary',()=>{
 assert.equal(p.decimal(p.fixed('99999999999999.9999')),'99999999999999.9999');
 for(const value of ['-1','1e3','Infinity','0.00001',null,'100000000000000'])assert.throws(()=>p.fixed(value));
});
test('a partial cut can consume only explicitly selected, scoped, live reservation quantities',()=>{
 const source={custId:3,docDate:'2026-11-22',coupons:[coupon(9,{reserved:'0.5'})],reservations:[
  {id:'9007199254740993',couponId:9,custId:3,inScope:true,active:true,nativeHeld:false,remaining:'0.5',consumed:'0',revision:1}]};
 const selection=[{couponId:9,quantity:'0.2',settlements:[{reservationId:'9007199254740993',quantity:'0.2'}]}];
 const result=p.planRedemption(source,selection);assert.equal(result.lines[0].settlements[0].quantity,'0.2000');
 assert.equal(result.lines[0].settlements[0].reservationId,'9007199254740993');
 for(const change of [{inScope:false},{active:false},{nativeHeld:true},{remaining:'0.1'},{custId:4}])
  assert.throws(()=>p.planRedemption({...source,reservations:[{...source.reservations[0],...change}]},selection),{code:'ND_RESERVATION_UNAVAILABLE'});
 assert.throws(()=>p.planRedemption(source,[{...selection[0],quantity:'0.1'}]),{code:'ND_COUPON_INSUFFICIENT'});
});
