'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,actorSub:17,role:'ADMIN',roles:['ADMIN'],actorRole:'ADMIN',actorRoles:['ADMIN'],isImpersonating:true,identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:17,businessEffectiveUserId:28,businessActorUserId:37}};
let state,failAudit=false,withContext=true;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;if(withContext)require('../services/request-context').runWithUser(user,next);else next();},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({kind,text,inputs})=>{
 if(/FROM wf\.TruckType WITH \(UPDLOCK, HOLDLOCK\)/.test(text))return state.row?[structuredClone(state.row)]:[];
 if(/INSERT INTO wf\.TruckType/.test(text)){assert.equal(kind,'tx');state.row={Id:inputs.id,Name:inputs.name,MaxWeightMain:inputs.main,MaxWeightTrailer:inputs.trailer,IsActive:inputs.active};return {rowsAffected:[1]};}
 if(/UPDATE wf\.TruckType/.test(text)){assert.equal(kind,'tx');state.row={...state.row,Name:inputs.name,MaxWeightMain:inputs.main,MaxWeightTrailer:inputs.trailer,IsActive:inputs.active};return {rowsAffected:[1]};}
 if(/DELETE FROM wf\.TruckType/.test(text)){assert.equal(kind,'tx');state.row=null;return {rowsAffected:[1]};}
 if(/INSERT INTO wf\.ChangeEvent/.test(text)){assert.equal(kind,'tx');if(failAudit)throw Error('TEST_AUDIT_FAILURE');state.events.push(inputs);return {rowsAffected:[1]};}
 return [];
});
db.stub.wfTransaction=async(fn,opts)=>{assert.ok(opts?.isolationLevel);const old=structuredClone(state);try{return await fn(db.tx);}catch(e){state=old;throw e;}};
const ctxPath=require.resolve('../services/request-context'),ctx=require('../services/request-context');require.cache[ctxPath].exports={...ctx,hasColumn:async()=>true};
let app;test.before(async()=>{app=await h.startApp([['/api/master','../../routes/master']]);});test.after(async()=>app.close());test.beforeEach(()=>{state={row:null,events:[]};failAudit=false;withContext=true;});
const body={Id:'TEST_TRUCK',Name:'Test',MaxWeightMain:10,MaxWeightTrailer:20,IsActive:true};
test('create commits audit with mapped identities and rolls back when audit fails',async()=>{
 failAudit=true;let r=await app.call('POST','/api/master/truck-types',{body});assert.equal(r.status,500);assert.equal(state.row,null);assert.equal(state.events.length,0);
 failAudit=false;r=await app.call('POST','/api/master/truck-types',{body});assert.equal(r.status,200);assert.equal(state.events[0].action,'CREATE');assert.equal(state.events[0].userId,'28');assert.equal(state.events[0].actorUserId,'37');assert.equal(JSON.parse(state.events[0].afterJson).Name,'Test');
 r=await app.call('POST','/api/master/truck-types',{body});assert.equal(r.status,409);assert.equal(state.events.length,1);
});
test('update and delete preserve before/after in the same transaction',async()=>{
 state.row={Id:'TEST_TRUCK',Name:'Before',MaxWeightMain:1,MaxWeightTrailer:null,IsActive:1};failAudit=true;let r=await app.call('PUT','/api/master/truck-types/TEST_TRUCK',{body});assert.equal(r.status,500);assert.equal(state.row.Name,'Before');
 failAudit=false;r=await app.call('PUT','/api/master/truck-types/TEST_TRUCK',{body});assert.equal(r.status,200);assert.equal(JSON.parse(state.events[0].beforeJson).Name,'Before');assert.equal(JSON.parse(state.events[0].afterJson).Name,'Test');
 failAudit=true;r=await app.call('DELETE','/api/master/truck-types/TEST_TRUCK');assert.equal(r.status,500);assert.equal(state.row.Name,'Test');
 failAudit=false;r=await app.call('DELETE','/api/master/truck-types/TEST_TRUCK');assert.equal(r.status,200);assert.equal(state.row,null);assert.equal(state.events[1].action,'DELETE');assert.equal(JSON.parse(state.events[1].beforeJson).Name,'Test');
});
test('missing actor context fails before any mutation',async()=>{
 withContext=false;const r=await app.call('POST','/api/master/truck-types',{body});assert.equal(r.status,503);assert.equal(state.row,null);assert.equal(state.events.length,0);
});
