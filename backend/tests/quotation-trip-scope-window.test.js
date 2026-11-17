'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,role:'SALES'};let mode='old';
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;next();},requireCapability:()=>((_req,_res,next)=>next()),requireRole:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({text,inputs})=>{
 if(/OBJECT_ID\('wf\.QuotationSourceSO'/.test(text))return [{HasTable:1}];
 if(/AS HasNativeTables/.test(text))return [{HasNativeTables:1,HasLinkColumns:1}];
 if(/SELECT Id, EmpId, PositionCode FROM wf\.AppUser/.test(text))return [{Id:8,EmpId:'E8',PositionCode:null}];
 if(/SELECT SourceKind, Id, WfRef/.test(text)){
  assert.match(text,/so\.CreatedAt >= @quoteStartUtc/);assert.match(text,/hd\.DocuDate >= @quoteStartDate/);
  assert.equal(inputs.quoteStartDate,'2026-01-01');assert.equal(inputs.quoteStartUtc.toISOString(),'2025-12-31T17:00:00.000Z');
  return mode==='old'?[]:[{SourceKind:'APP',Id:1,WfRef:'QA',CustId:'1',CustName:'Synthetic',Status:'DRAFT',SalesUserId:99}];
 }
 return [];
});
db.stub.pools=()=>({ready:Promise.resolve(),ownerPool:{request:()=>db.tx.request()}});
let app;test.before(async()=>{app=await h.startApp([['/api/quotation','../../routes/quotation']]);});test.after(async()=>app.close());
test('an old source order is hidden before quotation or native writes',async()=>{
 mode='old';db.calls.length=0;const r=await app.call('POST','/api/quotation/from-so-trip',{body:{soIds:[1]}});assert.equal(r.status,404);
 assert.ok(!db.calls.some(c=>/INSERT INTO wf\.Quotation|FROM wf\.SalesOrderLine sol/.test(c.text)));
});
test('another salesperson source is denied before reading its items or writing',async()=>{
 mode='other';db.calls.length=0;const r=await app.call('POST','/api/quotation/from-so-trip',{body:{soIds:[1]}});assert.equal(r.status,404);
 assert.ok(!db.calls.some(c=>/INSERT INTO wf\.Quotation|FROM wf\.SalesOrderLine sol/.test(c.text)));
});
