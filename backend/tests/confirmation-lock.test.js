'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {acquireConfirmationLock}=require('../services/confirmation-lock');
function fixture(error){
 const trace=[];
 class Transaction { async begin(){trace.push('begin')} async rollback(){trace.push('rollback')} }
 class Request {
  constructor(tx){assert.ok(tx instanceof Transaction);trace.push('pinned')}
  input(){return this}
  async query(text){assert.match(text,/@LockOwner='Transaction'/);if(error)throw error;trace.push('locked')}
 }
 return {sql:{Transaction,Request,NVarChar:()=>{}},trace};
}
test('confirmation lock stays pinned until explicit release; release is idempotent',async()=>{
 const {sql,trace}=fixture();const release=await acquireConfirmationLock({},sql,'ConfirmSO_1');
 assert.deepEqual(trace,['begin','pinned','locked']);await release();await release();
 assert.deepEqual(trace,['begin','pinned','locked','rollback']);
});
test('lock acquisition failure rolls back pinned session',async()=>{
 const error=new Error('timeout');const {sql,trace}=fixture(error);
 await assert.rejects(acquireConfirmationLock({},sql,'ConfirmSO_1'),e=>e===error);
 assert.deepEqual(trace,['begin','pinned','rollback']);
});
