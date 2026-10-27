'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {metadataFingerprint,validateMetadata}=require('../services/initial-invoice-metadata');
const {invoiceDeliveryTransition:delivery,invoiceCutTransition:cut}=require('../services/invoice-transition');
test('native trigger contract rejects missing, disabled, duplicate and changed definitions',()=>{
 const rows=Array.from({length:26},(_,i)=>({TableName:'T',name:'trigger'+i,is_disabled:0,definition:'definition'+i}));
 const expected=metadataFingerprint(rows);validateMetadata(rows,expected);
 const changed=structuredClone(rows);changed[0].definition+=' changed';assert.throws(()=>validateMetadata(changed,expected),/IP_METADATA_UNSUPPORTED/);
 for(const bad of [rows.slice(1),[...rows,rows[0]],rows.map((r,i)=>i? r:{...r,is_disabled:1}),rows.map((r,i)=>i? r:{...r,definition:null})])assert.throws(()=>metadataFingerprint(bad),/IP_METADATA_UNSUPPORTED/);
 assert.throws(()=>validateMetadata(rows),/IP_METADATA_UNSUPPORTED/);
});
test('107 changes only the104 detail balance, never coupon or202 fields',()=>{
 const b=Array.from({length:10},(_,i)=>i===1?'<row><RemaQty>1.0000</RemaQty><GoodAmnt>18200</GoodAmnt></row>':'part'+i);
 const a=b.map((s,i)=>i===1?s.replace('RemaQty>1.0000','RemaQty>0.0000'):s);assert.equal(delivery(b,a),true);
 for(let i=0;i<10;i++){const x=[...a];x[i]+='changed';assert.equal(delivery(b,x),false);}
});
test('107 changes only116 status, pending quantity and exact typed invoice reference',()=>{
 const b=['<row><DocuStatus>N</DocuStatus><SumGoodQty>1.0000</SumGoodQty></row>','<row><RemaQty>1.0000</RemaQty><PostInv>N</PostInv><SOInvID xsi:nil="true" /><SOListNo xsi:nil="true" /><GoodQty>1.0000</GoodQty></row>'];
 const a=[b[0].replace('>N<','>Y<'),b[1].replace('RemaQty>1.0000','RemaQty>0.0000').replace('PostInv>N','PostInv>Y').replace('<SOInvID xsi:nil="true" />','<SOInvID>801</SOInvID>').replace('<SOListNo xsi:nil="true" />','<SOListNo>1</SOListNo>')];
 assert.equal(cut(b,a,801),true);assert.equal(cut(b,a,802),false);
 for(const x of [a[1].replace('GoodQty>1.0000','GoodQty>2.0000'),a[1].replace('SOListNo>1','SOListNo>2'),a[1]+a[1]])assert.equal(cut(b,[a[0],x],801),false);
 assert.equal(cut(a,a,801),false);
});
