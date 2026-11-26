'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let state,failAudit=false;
const db=h.installDbStub(({text,inputs,kind})=>{
 assert.doesNotMatch(text,/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?dbo\./i);
 if(text.includes('FROM wf.TruckType'))return inputs.type==='TRUCK-A'?[{Id:'TRUCK-A',MaxWeightMain:10,MaxWeightTrailer:5}]:[];
 if(text.includes('INSERT INTO wf.SalesTrip')){assert.equal(kind,'tx');state.trips.push({...inputs});return [{TripId:state.trips.length}];}
 if(text.includes("EntityType='SO_DRAFT_GROUP'"))return state.receipts.filter(r=>r.id===inputs.receipt).map(r=>({BeforeJson:JSON.stringify(r.before),AfterJson:JSON.stringify(r.after)}));
 if(text.includes('sp_getapplock'))return [{LockResult:0}];
 if(text.includes('SELECT Id, EmpId, PositionCode'))return [{Id:inputs.id,EmpId:null,PositionCode:null}];
 return [];
});
const p=require.resolve('../services/policy-contract');require.cache[p]={id:p,filename:p,loaded:true,exports:{logChangeEvent:async(tx,e)=>{assert.equal(tx,db.tx);if(failAudit)throw Error('QA_AUDIT_FAILURE');state.audits.push(e);if(e.entityType==='SO_DRAFT_GROUP')state.receipts.push({id:e.entityId,before:e.beforeJson,after:e.afterJson});}}};
const trip=require('../services/draft-trip-create'),receipt=require('../services/draft-creation-receipt');
const user={sub:63,role:'ADMIN'},id='12345678-1234-4234-8234-123456789abc';
const transaction=async fn=>{const before=structuredClone(state);try{return await fn(db.tx);}catch(e){state=before;throw e;}};
test.beforeEach(()=>{state={trips:[],audits:[],receipts:[]};failAudit=false;});

test('bill failure after creating a trip rolls back trip and audit with the same transaction',async()=>{
 await assert.rejects(transaction(async tx=>{await trip.createDraftTrip(tx,user,[{pSling:true}],{});throw Error('QA_BILL_FAILURE');}),/QA_BILL_FAILURE/);
 assert.equal(state.trips.length,0);assert.equal(state.audits.length,0);
});
test('unknown vehicle stays unassigned; selected capacity comes only from active master',async()=>{
 const orders=[{pSling:true}];const created=await transaction(tx=>trip.createDraftTrip(tx,user,orders,{}));
 assert.equal(created.truckCapacityTon,null);assert.equal(orders[0].tripId,created.tripId);
 const rated=await transaction(tx=>trip.createDraftTrip(tx,user,[{}],{truckTypeId:'TRUCK-A',truckCapacityTon:999}));assert.equal(rated.truckCapacityTon,15);
 const before=structuredClone(state);await assert.rejects(transaction(tx=>trip.createDraftTrip(tx,user,[{}],{truckTypeId:'MISSING'})),e=>e.status===409);assert.deepEqual(state,before);
});
test('trip audit failure cannot leave a new trip behind',async()=>{
 failAudit=true;await assert.rejects(transaction(tx=>trip.createDraftTrip(tx,user,[{}],{})),/QA_AUDIT_FAILURE/);assert.equal(state.trips.length,0);
});
test('request replay returns the original ids; another payload or identity cannot reuse it',async()=>{
 const orders=[{createRequestId:id,custId:'QA',lines:[{qtyTon:1}]}],proof=receipt.request(orders,user),response={ids:[101],wfRefs:['QA-101'],needsApproval:false,trip:{tripId:1}};
 await transaction(tx=>receipt.save(tx,proof,new Set([10]),response));
 const replay=await receipt.lockAndRead(db.stub.wfQuery,proof,user);assert.deepEqual(replay,{...response,replayed:true});
 await assert.rejects(receipt.read(db.stub.wfQuery,receipt.request([{...orders[0],custId:'OTHER'}],user),user),e=>e.code==='SO_CREATE_REQUEST_CONFLICT');
 await assert.rejects(receipt.read(db.stub.wfQuery,receipt.request(orders,{sub:10,role:'SALES'}),{sub:10,role:'SALES'}),e=>e.code==='SO_CREATE_REQUEST_CONFLICT');
 assert.equal(state.receipts.length,1);
});
test('replay checks current organization scope rather than granting historical authority',async()=>{
 const owner={sub:10,role:'MANAGER'},proof=receipt.request([{createRequestId:id}],owner);
 await transaction(tx=>receipt.save(tx,proof,new Set([11]),{ids:[101]}));
 await assert.rejects(receipt.read(db.stub.wfQuery,proof,owner),e=>e.code==='SO_CREATE_REPLAY_OUTSIDE_SCOPE');
});
test('receipt audit failure rolls back the entire group and malformed keys fail before SQL',async()=>{
 const proof=receipt.request([{createRequestId:id}],user);failAudit=true;
 await assert.rejects(transaction(async tx=>{state.trips.push({});await receipt.save(tx,proof,new Set([10]),{ids:[101]});}),/QA_AUDIT_FAILURE/);
 assert.deepEqual(state,{trips:[],audits:[],receipts:[]});assert.throws(()=>receipt.request([{createRequestId:'invalid'}],user),e=>e.status===400);
});
