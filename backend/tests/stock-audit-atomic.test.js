'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,actorSub:17,role:'WAREHOUSE',actorRole:'ADMIN',isImpersonating:true};
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;require('../services/request-context').runWithUser(user,next);},requireRole:()=>((_req,_res,next)=>next())}};
let state, failure;
const db=h.installDbStub(({kind,text,inputs})=>{
 if(text.includes("COL_LENGTH('wf.ChangeEvent'"))return [{HasCol:1}];
 if(text.includes('FROM dbo.EMGood WITH'))return [{GoodCode:'TEST-A',GoodName:'Fixture'}];
 if(text.includes('FROM wf.OperationalStock WITH (UPDLOCK,HOLDLOCK)'))return [{GoodId:'TEST-A',WarehouseId:'-',QtyOnHand:state.qty,Unit:'ตัน',Source:'MANUAL'}];
 if(text.includes('DELETE FROM wf.OperationalStock')){assert.equal(kind,'tx');state.removed=true;return {rowsAffected:[1]};}
 if(text.includes('MERGE wf.OperationalStock')){assert.equal(kind,'tx');if(failure==='merge')throw Error('TEST_SYNC_FAILED');if(text.includes(';WITH bal')){state.synced=true;return [{Affected:3}];}state.qty=inputs.q;return {rowsAffected:[1]};}
 if(text.includes('INSERT INTO wf.ChangeEvent')){assert.equal(kind,'tx');if(failure==='audit')throw Error('TEST_AUDIT_FAILED');state.audits.push(inputs);return {rowsAffected:[1]};}
 return [];
});
db.stub.wfTransaction=async fn=>{const before=structuredClone(state);try{return await fn(db.tx);}catch(e){state=before;throw e;}};
let app;test.before(async()=>{app=await h.startApp([['/api/stock','../../routes/stock']]);});test.after(async()=>app.close());
test.beforeEach(()=>{state={qty:5,removed:false,synced:false,audits:[]};failure=null;});
test('stock change and actor/effective audit commit or roll back together',async()=>{
 const body={goodId:'TEST-A',qtyOnHand:8};failure='audit';let r=await app.call('PUT','/api/stock',{body});assert.equal(r.status,500);assert.equal(state.qty,5);assert.equal(state.audits.length,0);
 failure=null;r=await app.call('PUT','/api/stock',{body});assert.equal(r.status,200);assert.equal(state.qty,8);assert.equal(state.audits[0].userId,'8');assert.equal(state.audits[0].actorUserId,'17');assert.match(state.audits[0].beforeJson,/"QtyOnHand":5/);assert.match(state.audits[0].afterJson,/"qtyOnHand":8/);
});
test('sync delete, merge and audit roll back together on merge or audit failure',async()=>{
 for(const fail of ['merge','audit']){failure=fail;const before=structuredClone(state);const r=await app.call('POST','/api/stock/sync-winspeed',{body:{}});assert.equal(r.status,500);assert.deepEqual(state,before);}
 failure=null;const r=await app.call('POST','/api/stock/sync-winspeed',{body:{}});assert.equal(r.status,200);assert.equal(r.body.affected,3);assert.equal(state.removed,true);assert.equal(state.synced,true);assert.equal(state.audits[0].userId,'8');assert.equal(state.audits[0].actorUserId,'17');
});
