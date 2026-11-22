'use strict';

// Native monetary and tonne columns are decimal(18,4). Keep them exact from
// SQL's varchar projection through the persisted plan; never round with floats.
const SCALE=10000n,MAX=999999999999999999n;
const {isValidStartDate}=require('./data-window');
const {bookOf,invoiceSeriesForBill}=require('./account-books');
function fail(code,status=409){throw Object.assign(Error(code),{code,status});}
function fixed(value){
 const s=String(value??'');
 if(!/^\d{1,14}(?:\.\d{1,4})?$/.test(s))fail('ND_DECIMAL_INVALID',400);
 const [whole,fraction='']=s.split('.'),n=BigInt(whole)*SCALE+BigInt(fraction.padEnd(4,'0'));
 if(n>MAX)fail('ND_DECIMAL_OVERFLOW',400);return n;
}
function decimal(n){
 if(n<0n||n>MAX)fail('ND_DECIMAL_OVERFLOW');
 return `${n/SCALE}.${String(n%SCALE).padStart(4,'0')}`;
}
function rounded(n,d){if(n<0n||d<=0n)fail('ND_AMOUNT_INVALID');return (n+d/2n)/d;}
function id(value){const n=Number(value);if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(n)||n<1||n>2147483647)fail('ND_ID_INVALID',400);return n;}
function date(value){if(!isValidStartDate(value))fail('ND_DATE_INVALID',400);return value;}
function lines(value){if(!Array.isArray(value)||value.length<1||value.length>1000)fail('ND_LINES_INVALID',400);return value;}
function unique(rows,key){const seen=new Set();for(const r of rows){const k=key(r);if(seen.has(k))fail('ND_DUPLICATE_LINE',400);seen.add(k);}}
const sum=(rows,key)=>rows.reduce((n,r)=>n+r[key],0n);
// Allocate a header amount by cumulative weights. Stable ListNo ordering makes
// retries independent of input array ordering and leaves no unassigned residue.
function allocate(total,weights){
 const denominator=weights.reduce((a,b)=>a+b,0n);
 if(total<0n||total>denominator)fail('ND_DISCOUNT_INVALID');
 if(!denominator)return weights.map(()=>0n);
 let weight=0n,allocated=0n;
 return weights.map(w=>{weight+=w;const target=rounded(total*weight,denominator),part=target-allocated;allocated=target;return part;});
}
function financials(header,rows){
 const gross=fixed(header.gross),discount=fixed(header.discount),base=fixed(header.taxBase),tax=fixed(header.tax),net=fixed(header.net),rate=fixed(header.vatRate);
 if(gross!==sum(rows,'gross')||discount>gross||base!==gross-discount||net!==base+tax||rate>100n*SCALE)fail('ND_FINANCIAL_SOURCE_MISMATCH');
 // Existing native writer contract is exclusive VAT. Inclusive/mixed tax types
 // require their own verified arithmetic, never an inferred conversion.
 if(rate>0n&&String(header.vatType)!=='2')fail('ND_VAT_TYPE_UNSUPPORTED');
 const expectedTax=rounded(base*rate,100n*SCALE*100n)*100n;
 if(tax!==expectedTax)fail('ND_FINANCIAL_SOURCE_MISMATCH');
 return {gross,discount,base,tax,net,rate};
}
function planDelivery(source){
 const soid=id(source.soid),book=bookOf(source.docNo);
 if(!['I','K'].includes(book)||String(source.docNo)[0]!==book)fail('ND_ACCOUNT_MISMATCH');
 const rows=lines(source.lines).map(r=>{
  const quantity=fixed(r.quantity),price=fixed(r.price),gross=fixed(r.amount),packKg=fixed(r.packKg);
  if(!quantity||!packKg||quantity!==fixed(r.remaining)||gross!==rounded(quantity*price,SCALE))fail('ND_SOURCE_QUANTITY_MISMATCH');
  if(price===0n&&r.rebateTicketVerified!==true)fail('ND_ZERO_LINE_UNVERIFIED');
  const sackNumerator=quantity*1000n;
  if(sackNumerator%packKg)fail('ND_PACKAGING_INVALID');
  const sacks=sackNumerator/packKg;
  if(sacks<1n||sacks>2147483647n)fail('ND_PACKAGING_INVALID');
  return {lineNo:id(r.lineNo),goodId:id(r.goodId),quantity,price,gross,packKg,sacks};
 }).sort((a,b)=>a.lineNo-b.lineNo);
 unique(rows,r=>r.lineNo);
 const f=financials(source,rows),discounts=allocate(f.discount,rows.map(r=>r.gross));
 return {version:'NATIVE-DOCUMENTS-v3',kind:104,soid,book,couponSeries:book==='I'?'C':'D',
  gross:decimal(f.gross),discount:decimal(f.discount),taxBase:decimal(f.base),tax:decimal(f.tax),net:decimal(f.net),vatRate:decimal(f.rate),
  lines:rows.map((r,i)=>({lineNo:r.lineNo,goodId:r.goodId,quantity:decimal(r.quantity),price:decimal(r.price),gross:decimal(r.gross),
   packKg:decimal(r.packKg),sacks:Number(r.sacks),discount:decimal(discounts[i]),taxBase:decimal(r.gross-discounts[i])}))};
}
function planRedemption(source,selection){
 const available=lines(source.coupons),custId=id(source.custId),docDate=date(source.docDate);
 unique(available,r=>id(r.couponId));
 const requested=lines(selection).map(r=>({couponId:id(r.couponId),quantity:fixed(r.quantity),settlements:r.settlements||[]}));
 unique(requested,r=>r.couponId);
 const selectedReservations=new Set();
 const result=requested.sort((a,b)=>a.couponId-b.couponId).map(r=>{
  const c=available.find(c=>id(c.couponId)===r.couponId);
  if(!c||id(c.custId)!==custId||c.inScope!==true||c.beneficiaryValid!==true)fail('ND_COUPON_NOT_FOUND',404);
  const expired=Boolean(c.expired||(c.expiryDate&&date(c.expiryDate)<docDate));
  const remain=fixed(c.remaining),reserved=fixed(c.reserved),book=bookOf(c.couponNo);
  let own=0n;
  if(!Array.isArray(r.settlements)||r.settlements.length>1000)fail('ND_RESERVATION_INVALID',400);
  const settlements=r.settlements.map(item=>{
   const key=String(item.reservationId);
   if(!/^[1-9]\d{0,18}$/.test(key)||BigInt(key)>9223372036854775807n||selectedReservations.has(key))fail('ND_RESERVATION_INVALID',400);
   selectedReservations.add(key);
   const reservation=(source.reservations||[]).find(row=>String(row.id)===key);
   const quantity=fixed(item.quantity);
   if(!reservation||id(reservation.couponId)!==r.couponId||id(reservation.custId)!==custId||reservation.inScope!==true
    ||reservation.active!==true||reservation.nativeHeld===true||!quantity||quantity>fixed(reservation.remaining))fail('ND_RESERVATION_UNAVAILABLE');
   own+=quantity;
   return {reservationId:key,quantity:decimal(quantity),revision:id(reservation.revision),beforeConsumed:decimal(fixed(reservation.consumed))};
  });
  if(!r.quantity||own>r.quantity||own>reserved||reserved>remain||r.quantity>remain-reserved+own)fail('ND_COUPON_INSUFFICIENT');
  if(!book||book!==bookOf(c.deliveryNo))fail('ND_ACCOUNT_MISMATCH');
  return {couponId:r.couponId,couponNo:c.couponNo,deliveryId:id(c.deliveryId),sourceLineNo:id(c.sourceLineNo),
   goodId:id(c.goodId),quantity:decimal(r.quantity),beforeRemaining:decimal(remain),book,settlements,
   expired,expiryDate:c.expiryDate||null};
 });
 return {version:'NATIVE-DOCUMENTS-v3',kind:116,custId,docDate,quantity:decimal(result.reduce((a,r)=>a+fixed(r.quantity),0n)),lines:result};
}
function planInvoice(source,selection){
 // A 116 may mix books or orders; split 107s by 104 AND transport date. A group
 // is issued atomically, and every selected native cut line is consumed once.
 const deliveryId=id(source.deliveryId),docDate=date(source.docDate),book=bookOf(source.deliveryNo);
 if(!book)fail('ND_ACCOUNT_MISMATCH');
 const original=planDelivery({...source,soid:deliveryId,docNo:source.deliveryNo,
  lines:source.lines.map(r=>({...r,remaining:r.quantity}))});
 const selected=lines(selection).map(r=>({...r,redemptionId:id(r.redemptionId),lineNo:id(r.lineNo),sourceLineNo:id(r.sourceLineNo),quantity:fixed(r.quantity)}));
 unique(selected,r=>`${r.redemptionId}:${r.lineNo}`);
 const output=[];
 let priorBase=0n,priorTax=fixed(source.priorTax??'0'),gross=0n,discount=0n;
 for(const line of original.lines){
  const origin=source.lines.find(r=>id(r.lineNo)===line.lineNo),issued=fixed(line.quantity),previous=fixed(origin.invoicedQuantity??'0');
  const used=selected.filter(r=>r.sourceLineNo===line.lineNo).sort((a,b)=>a.redemptionId-b.redemptionId||a.lineNo-b.lineNo);
  let cumulative=previous;
  const lineGross=fixed(line.gross),lineDiscount=fixed(line.discount);
  const priorGross=rounded(lineGross*previous,issued),priorDiscount=rounded(lineDiscount*previous,issued);
  if(previous>issued||priorGross!==fixed(origin.invoicedGross??'0')||priorDiscount!==fixed(origin.invoicedDiscount??'0'))fail('ND_INVOICE_HISTORY_MISMATCH');
  priorBase+=priorGross-priorDiscount;
  for(const cut of used){
   if(!cut.quantity||cut.docDate!==docDate||id(cut.deliveryId)!==deliveryId||cut.uninvoiced!==true)fail('ND_CUT_SOURCE_MISMATCH');
   const before=cumulative;cumulative+=cut.quantity;if(cumulative>issued)fail('ND_COUPON_INSUFFICIENT');
   const g=rounded(lineGross*cumulative,issued)-rounded(lineGross*before,issued);
   const d=rounded(lineDiscount*cumulative,issued)-rounded(lineDiscount*before,issued);
   if(d>g)fail('ND_AMOUNT_PRECISION_UNSUPPORTED');
   gross+=g;discount+=d;
   output.push({redemptionId:cut.redemptionId,redemptionLineNo:cut.lineNo,sourceLineNo:line.lineNo,
    quantity:decimal(cut.quantity),gross:decimal(g),discount:decimal(d),taxBase:decimal(g-d),goodId:line.goodId,price:line.price});
  }
 }
 if(output.length!==selected.length)fail('ND_CUT_SOURCE_MISMATCH');
 const rate=fixed(original.vatRate),expectedPriorTax=rounded(priorBase*rate,100n*SCALE*100n)*100n;
 if(priorTax!==expectedPriorTax)fail('ND_INVOICE_HISTORY_MISMATCH');
 const base=gross-discount,tax=rounded((priorBase+base)*rate,100n*SCALE*100n)*100n-priorTax;
 return {version:'NATIVE-DOCUMENTS-v3',kind:107,deliveryId,docDate,series:invoiceSeriesForBill(book),
  gross:decimal(gross),discount:decimal(discount),taxBase:decimal(base),tax:decimal(tax),net:decimal(base+tax),
  lines:output.sort((a,b)=>a.redemptionId-b.redemptionId||a.redemptionLineNo-b.redemptionLineNo)};
}
module.exports={fixed,decimal,rounded,allocate,planDelivery,planRedemption,planInvoice,id,date,fail};
