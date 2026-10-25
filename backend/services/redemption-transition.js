'use strict';
// Ten ordered canonical104 snapshot parts;116 may alter one coupon RemaQty only.
function isInitialRedemptionTransition(before,after){
 if(!Array.isArray(before)||!Array.isArray(after)||before.length!==10||after.length!==10)return false;
 if(before.some((part,i)=>typeof part!=='string'||typeof after[i]!=='string'||(i!==4&&part!==after[i])))return false;
 const tag=/<RemaQty>([0-9]+(?:\.[0-9]+)?)<\/RemaQty>/g;
 const b=[...before[4].matchAll(tag)],a=[...after[4].matchAll(tag)];
 if(b.length!==1||a.length!==1||!(Number(b[0][1])>0)||Number(a[0][1])!==0)return false;
 return before[4].replace(tag,a[0][0])===after[4];
}
module.exports={isInitialRedemptionTransition};
