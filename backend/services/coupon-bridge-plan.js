'use strict';
const {fixed,decimal,id,fail}=require('./native-document-plan');
const signed=n=>n<0n?'-'+decimal(-n):decimal(n);
const bigId=v=>{const s=String(v);if(!/^[1-9]\d{0,18}$/.test(s)||BigInt(s)>9223372036854775807n)fail('ND_RESERVATION_INVALID',400);return s;};
function editPlan({before,coupons,reservations,settlements},selection,operation){
 if(!['E','D'].includes(operation)||!Array.isArray(selection)||selection.length>100)fail('ND_LINES_INVALID',400);
 const desired=new Map(),old=new Map(),native=new Map(coupons.map(c=>[id(c.couponId),c]));
 for(const line of before){const cid=id(line.couponId);if(old.has(cid))fail('ND_DUPLICATE_LINE');old.set(cid,line);}
 for(const [i,line]of selection.entries()){
  const cid=id(line.couponId);if(desired.has(cid))fail('ND_DUPLICATE_LINE',400);
  if(operation==='D'&&fixed(line.quantity)!==0n)fail('ND_LINES_INVALID',400);
  desired.set(cid,{...line,lineNo:i+1,quantity:decimal(fixed(line.quantity))});
 }
 if(operation==='E'&&![...desired.values()].some(l=>fixed(l.quantity)>0n))fail('ND_LINES_INVALID',400);
 const allocations=[],lines=[],seen=new Set();
 const snapshot=(r,cid)=>{
  if(!r||Number(r.couponId)!==cid||r.inScope!==true)fail('ND_RESERVATION_UNAVAILABLE',403);
  return {couponId:cid,reservationId:bigId(r.id),beforeConsumed:decimal(fixed(r.consumed)),revision:id(r.revision)};
 };
 for(const cid of [...new Set([...old.keys(),...desired.keys()])].sort((a,b)=>a-b)){
  const row=native.get(cid);if(!row)fail('ND_COUPON_NOT_FOUND',404);
  const prev=fixed(old.get(cid)?.quantity||'0'),wanted=desired.get(cid),after=operation==='D'?0n:fixed(wanted?.quantity||'0'),balance=fixed(row.remaining);
  if(!prev&&!after)continue;
  if(balance+prev<after)fail('ND_COUPON_INSUFFICIENT');
  const matched=settlements.filter(s=>Number(s.couponId)===cid),allocated=matched.reduce((sum,s)=>sum+fixed(s.quantity),0n);
  if(allocated>prev)fail('ND_RESERVATION_UNAVAILABLE');
  let returnNeeded=allocated>after?allocated-after:0n,totalReturn=returnNeeded,totalAdded=0n;
  for(const s of [...matched].sort((a,b)=>BigInt(a.id)>BigInt(b.id)?-1:1)){
   if(!returnNeeded)break;
   const qty=fixed(s.quantity)<returnNeeded?fixed(s.quantity):returnNeeded;
   const r=reservations.find(r=>String(r.id)===String(s.reservationId));
   allocations.push({...snapshot(r,cid),settlementId:bigId(s.id),delta:signed(-qty)});returnNeeded-=qty;
  }
  if(returnNeeded)fail('ND_RESERVATION_UNAVAILABLE');
  for(const asked of wanted?.settlements||[]){
   const rid=bigId(asked.reservationId);if(seen.has(rid))fail('ND_DUPLICATE_LINE',400);seen.add(rid);
   const r=reservations.find(r=>String(r.id)===rid),qty=fixed(asked.quantity);
   if(!qty||r?.active!==true||r?.nativeHeld||qty>fixed(r?.remaining||'0'))fail('ND_RESERVATION_UNAVAILABLE');
   allocations.push({...snapshot(r,cid),settlementId:'0',delta:decimal(qty)});totalAdded+=qty;
  }
  if(totalAdded>(after>prev?after-prev:0n))fail('ND_RESERVATION_INVALID');
  // Restored consumption becomes a held reservation again. Releasing the
  // native balance alone must never make another bill's hold spendable.
  const finalHeld=fixed(row.held)+totalReturn-totalAdded;
  if(finalHeld<0n||balance+prev-after<finalHeld)fail('ND_COUPON_INSUFFICIENT');
  lines.push({couponId:cid,lineNo:wanted?.lineNo||Number(old.get(cid).lineNo),before:decimal(prev),after:decimal(after),nativeBefore:decimal(balance)});
 }
 if(!lines.length)fail('ND_LINES_INVALID',400);
 return {lines,allocations};
}
module.exports={editPlan,signed,bigId};
