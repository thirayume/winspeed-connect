'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let target='LOCAL',dbName=null, pause=null;
const db=h.installDbStub(async()=>{if(pause)await pause;return []});db.stub.getTarget=()=>target;db.stub.getDbName=()=>dbName;
const {reconcileFromWinSpeed,invalidateReconcileCache}=require('../services/pricebook-winspeed-sync');
const {getCompanyInfo,clearCompanyCache}=require('../services/company-service');
test('price reconciliation cache separates targets with the same default database and invalidates the current target',async()=>{
 await reconcileFromWinSpeed();await reconcileFromWinSpeed();assert.equal(db.calls.length,1);
 target='REMOTE';await reconcileFromWinSpeed();assert.equal(db.calls.length,2);
 target='LOCAL';invalidateReconcileCache();await reconcileFromWinSpeed();assert.equal(db.calls.length,3);
 target='REMOTE';await reconcileFromWinSpeed();assert.equal(db.calls.length,3);
});
test('company cache separates targets even when neither has a database override',async()=>{
 clearCompanyCache();let calls=0;const query=async()=>{calls++;return [{CompName:target}]};
 target='LOCAL';assert.equal((await getCompanyInfo({customQueryFn:query})).compName,'LOCAL');
 target='REMOTE';assert.equal((await getCompanyInfo({customQueryFn:query})).compName,'REMOTE');
 target='LOCAL';assert.equal((await getCompanyInfo({customQueryFn:query})).compName,'LOCAL');assert.equal(calls,2);
});

test('an in-flight reconcile cannot repopulate cache after invalidation',async()=>{
 target='RACE';let release;pause=new Promise(resolve=>{release=resolve});const before=db.calls.length;
 const pending=reconcileFromWinSpeed();await new Promise(resolve=>setImmediate(resolve));
 invalidateReconcileCache();release();await pending;pause=null;
 await reconcileFromWinSpeed();assert.equal(db.calls.length,before+2);
});
