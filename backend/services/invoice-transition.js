'use strict';
function replaceTag(before,after,name,accept){
 const rx=new RegExp('<'+name+'(?:\\s[^>]*)?(?:\\s*/>|>[^<]*</'+name+'>)','g');
 const a=[...before.matchAll(rx)],b=[...after.matchAll(rx)];
 if(a.length!==1||b.length!==1||!accept(a[0][0],b[0][0]))return null;
 return before.replace(a[0][0],b[0][0]);
}
const value=tag=>/^<[^>]+>([^<]*)<\//.exec(tag)?.[1];
const numeric=tag=>/^\d+(?:\.\d+)?$/.test(value(tag)||'')&&Number.isFinite(Number(value(tag)));
const balance=(a,b)=>numeric(a)&&numeric(b)&&Number(value(a))>0&&Number(value(b))===0;
function invoiceDeliveryTransition(before,after){
 if(!Array.isArray(before)||!Array.isArray(after)||before.length!==10||after.length!==10)return false;
 if(before.some((s,i)=>typeof s!=='string'||typeof after[i]!=='string'||(i!==1&&s!==after[i])))return false;
 return replaceTag(before[1],after[1],'RemaQty',balance)===after[1];
}
function invoiceCutTransition(before,after,invoiceId){
 if(!Number.isSafeInteger(invoiceId)||invoiceId<=0||!Array.isArray(before)||!Array.isArray(after)||before.length!==2||after.length!==2||![...before,...after].every(v=>typeof v==='string'))return false;
 const header=replaceTag(before[0],after[0],'DocuStatus',(a,b)=>value(a)==='N'&&value(b)==='Y');
 if(header!==after[0])return false;
 let detail=before[1];
 const nil=name=>tag=>new RegExp('^<'+name+' xsi:nil="true"\\s*/>$').test(tag);
 for(const [name,accept] of [
  ['RemaQty',balance],['PostInv',(a,b)=>value(a)==='N'&&value(b)==='Y'],
  ['SOInvID',(a,b)=>nil('SOInvID')(a)&&value(b)===String(invoiceId)],
  ['SOListNo',(a,b)=>nil('SOListNo')(a)&&value(b)==='1'],
 ]){detail=replaceTag(detail,after[1],name,accept);if(detail===null)return false;}
 return detail===after[1];
}
module.exports={invoiceDeliveryTransition,invoiceCutTransition};
