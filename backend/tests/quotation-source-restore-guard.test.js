'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,role:'ADMIN'};let state;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;next();},requireCapability:()=>((_req,_res,next)=>next()),requireRole:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({text,inputs})=>{
 if(/AS Visible FROM wf\.Quotation/.test(text))return [{Visible:1}];
 if(/AS HasNativeTables/.test(text))return [{HasNativeTables:0,HasLinkColumns:0}];
 if(/SELECT Status FROM wf\.Quotation WITH/.test(text))return [{Status:state.status}];
 if(/UPDATE wf\.Quotation SET Status=@s/.test(text)){state.status=inputs.s;return {rowsAffected:[1]};}
 if(/OBJECT_ID\('wf\.QuotationSourceSO'/.test(text))return [{HasTable:1}];
 if(/SELECT SoId, SourceWfRef/.test(text))return [{SoId:4,SourceWfRef:'SYNTHETIC'}];
 if(/SELECT TOP 1 src\.Id/.test(text)){assert.match(text,/so\.WfRef/);assert.match(text,/hd\.DocuNo/);return [{Id:1}];}
 if(/UPDATE so\s+SET Status='DRAFT'/.test(text))throw Error('UNSAFE_SOURCE_UPDATE');
 return [];
});
db.stub.wfTransaction=async fn=>{const old=structuredClone(state);try{return await fn(db.tx);}catch(e){state=old;throw e;}};
let app;test.before(async()=>{app=await h.startApp([['/api/quotation','../../routes/quotation']]);});test.after(async()=>app.close());
test('ambiguous legacy source blocks cancellation and rolls back the status',async()=>{state={status:'DRAFT'};const r=await app.call('PATCH','/api/quotation/5/status',{body:{status:'CANCELLED'}});assert.equal(r.status,409);assert.equal(state.status,'DRAFT');assert.ok(!db.calls.some(c=>/UPDATE so\s+SET Status='DRAFT'/.test(c.text)));});
