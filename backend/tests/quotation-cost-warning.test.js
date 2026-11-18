'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let fail=false;const db=h.installDbStub(({kind,text,inputs})=>{
 if(/FROM wf\.CostBookLine/.test(text)){assert.equal(kind,'wfQuery');if(fail)throw Error('TEST_DB_UNAVAILABLE');return inputs.goodId==='2'?[{CostBookId:8,GoodId:'2',CostPrice:100}]:[];}
 return [];
},{activeUserIds:h.TEST_USERS});
let app;test.before(async()=>{app=await h.startApp([['/api/quotation','../../routes/quotation']]);});test.after(async()=>app.close());
const lines=[{goodId:'1',goodCode:'A',pricePerTon:150},{goodId:'2',goodCode:'B',pricePerTon:150},{goodId:'3',goodCode:'C',pricePerTon:0,isGiveaway:true}];
test('quotation preview reports missing items without cost values or writes',async()=>{
 db.calls.length=0;const r=await app.call('POST','/api/quotation/price-coverage',{user:{sub:1,role:'SALES'},body:{lines}});
 assert.equal(r.status,200);assert.deepEqual(r.body,{missingCostLineIndexes:[0]});assert.ok(!JSON.stringify(r.body).includes('100'));
 assert.ok(!db.calls.some(c=>/\b(INSERT|UPDATE|DELETE)\b/i.test(c.text)));
});
test('unknown database state is returned as an error rather than a false clean result',async()=>{
 fail=true;try{const r=await app.call('POST','/api/quotation/price-coverage',{user:{sub:1,role:'SALES'},body:{lines}});assert.equal(r.status,500);assert.equal(r.body.missingCostLineIndexes,undefined);}finally{fail=false;}
});
test('missing login and excess input cannot use the preview',async()=>{
 assert.equal((await app.call('POST','/api/quotation/price-coverage',{body:{lines}})).status,401);
 assert.equal((await app.call('POST','/api/quotation/price-coverage',{user:{sub:1,role:'SALES'},body:{lines:Array(101).fill(lines[0])}})).status,400);
});
test('quotation capability gate checks the actor as well as the effective user',()=>{
 const {requireCapability}=require('../middleware/auth');let status=0,next=false;
 const res={status(code){status=code;return this;},json(){return this;}};
 requireCapability('quotation.create')({user:{role:'SALES',actorRole:'WAREHOUSE',isImpersonating:true}},res,()=>{next=true;});
 assert.equal(status,403);assert.equal(next,false);
});
