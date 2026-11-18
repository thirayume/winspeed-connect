'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,actorSub:17,role:'ADMIN',actorRole:'ADMIN',isImpersonating:true,identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:17,businessEffectiveUserId:28,businessActorUserId:37}};
let state,ready,failAudit,failSecond;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;require('../services/request-context').runWithUser(user,next);},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({kind,text,inputs,proc})=>{
 if(text.includes("OBJECT_ID('wf.sp_MasterCreatePrice'"))return [{HasProcs:ready?1:0}];
 if(proc==='wf.sp_MasterCreatePrice'){
   assert.equal(kind,'proc'); if(failSecond && state.rows.length===1)throw Error('TEST_SECOND_FAILURE');
   const id=1001+state.rows.length; state.rows.push({id,...inputs}); return {output:{NewSetPriceID:id,DocuNo:`WEB-TEST-${id}`}};
 }
 if(text.includes('FROM dbo.EMSetPriceHD hd') && text.includes('JOIN dbo.EMSetPriceDT dt')){
   const row=state.rows.find(r=>r.id===Number(inputs.id));
   return row && Number(inputs.listNo)===1?[{SetPriceID:row.id,DocuNo:`WEB-TEST-${row.id}`,ListNo:1,GoodID:row.GoodID,GoodPriceNet:row.GoodPriceNet}]:[];
 }
 if(proc==='wf.sp_MasterUpdatePrice'){const row=state.rows.find(r=>r.id===Number(inputs.SetPriceID));if(!row)return {output:{Affected:0}};row.GoodPriceNet=inputs.GoodPriceNet;return {output:{Affected:1}};}
 if(text.includes('INSERT INTO wf.ChangeEvent')){assert.equal(kind,'tx');if(failAudit)throw Error('TEST_AUDIT_FAILURE');state.events.push(inputs);return {rowsAffected:[1]};}
 return [];
});
db.stub.wfTransaction=async(fn,opts)=>{assert.ok(opts?.isolationLevel);const old=structuredClone(state);try{return await fn(db.tx);}catch(e){state=old;throw e;}};
const cp=require.resolve('../services/request-context'),ctx=require('../services/request-context');require.cache[cp].exports={...ctx,hasColumn:async()=>true};
let app;test.before(async()=>{app=await h.startApp([['/api/master','../../routes/master']]);});test.after(async()=>app.close());
test.beforeEach(()=>{state={rows:[],events:[]};ready=true;failAudit=false;failSecond=false;});
const item={GoodID:1,GoodPriceNet:1250,BeginDate:'2026-11-15',EndDate:'2026-12-15'};
test('bulk creation records each mapped identity and commits all items together',async()=>{
 const r=await app.call('POST','/api/master/prices/bulk-extend',{body:{items:[item,{...item,GoodID:2}]}});
 assert.equal(r.status,200);assert.equal(r.body.createdCount,2);assert.equal(state.events.length,2);
 assert.equal(state.events[0].actorUserId,'37');assert.equal(state.events[0].userId,'28');
 assert.equal(JSON.parse(state.events[1].afterJson).GoodID,2);
});
test('a failure on the second price or the audit rolls the entire bulk request back',async()=>{
 failSecond=true;let r=await app.call('POST','/api/master/prices/bulk-extend',{body:{items:[item,{...item,GoodID:2}]}});
 assert.equal(r.status,500);assert.deepEqual(state,{rows:[],events:[]});
 failSecond=false;failAudit=true;r=await app.call('POST','/api/master/prices/bulk-extend',{body:{items:[item]}});
 assert.equal(r.status,500);assert.deepEqual(state,{rows:[],events:[]});
});
test('missing procedures or invalid IDs fail before any price write',async()=>{
 ready=false;let r=await app.call('POST','/api/master/prices/bulk-extend',{body:{items:[item]}});
 assert.equal(r.status,503);assert.deepEqual(state,{rows:[],events:[]});
 ready=true;r=await app.call('POST','/api/master/prices/bulk-extend',{body:{items:[{...item,GoodID:'1foo'}]}});
 assert.equal(r.status,400);assert.deepEqual(state,{rows:[],events:[]});
});
test('single create and update store actual snapshots and mapped actor in the same transaction',async()=>{
 let r=await app.call('POST','/api/master/prices',{body:item});assert.equal(r.status,200);const id=r.body.SetPriceID;
 assert.equal(state.events.length,1);assert.equal(state.events[0].actorUserId,'37');
 r=await app.call('PATCH','/api/master/prices',{body:{SetPriceID:id,ListNo:1,GoodPriceNet:1500}});
 assert.equal(r.status,200);assert.equal(state.events.length,2);
 assert.equal(JSON.parse(state.events[1].beforeJson).GoodPriceNet,1250);assert.equal(JSON.parse(state.events[1].afterJson).GoodPriceNet,1500);
});
test('single create and update both roll back on audit failure',async()=>{
 failAudit=true;let r=await app.call('POST','/api/master/prices',{body:item});assert.equal(r.status,500);assert.deepEqual(state,{rows:[],events:[]});
 failAudit=false;r=await app.call('POST','/api/master/prices',{body:item});const id=r.body.SetPriceID;
 failAudit=true;r=await app.call('PATCH','/api/master/prices',{body:{SetPriceID:id,ListNo:1,GoodPriceNet:1500}});
 assert.equal(r.status,500);assert.equal(state.rows[0].GoodPriceNet,1250);assert.equal(state.events.length,1);
});
test('single update returns 404 for missing price; missing procedures and invalid IDs are rejected',async()=>{
 let r=await app.call('PATCH','/api/master/prices',{body:{SetPriceID:1001,ListNo:1,GoodPriceNet:1500}});assert.equal(r.status,404);
 ready=false;r=await app.call('POST','/api/master/prices',{body:item});assert.equal(r.status,503);
 ready=true;r=await app.call('PATCH','/api/master/prices',{body:{SetPriceID:'1bad',ListNo:1,GoodPriceNet:1500}});assert.equal(r.status,400);
});
