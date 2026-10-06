'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {enqueue}=require('../services/outbox');
const {advanceDocuNoCounter}=require('../services/winspeed-counter');
const {writeAudit}=require('../services/winspeed-audit');
test('confirmation helpers propagate required write failure through injected transaction executor',async()=>{
 const error=new Error('transaction write failure');
 const options={strict:true,query:async()=>{throw error;}};
 await assert.rejects(enqueue('SO_CONFIRMED',1,{},'test',options),e=>e===error);
 await assert.rejects(advanceDocuNoCounter('I69-12345',options),e=>e===error);
 await assert.rejects(writeAudit({screen:1,action:'I',docuNo:'I69-12345'},options),e=>e===error);
});
test('confirmation helpers use supplied transaction executor for successful writes',async()=>{
 const calls=[];
 const options={strict:true,query:async(text,params)=>{calls.push({text,params});return {recordset:[{auditId:42}],rowsAffected:[1]};}};
 await enqueue('SO_CONFIRMED',1,{},'test',options);
 await advanceDocuNoCounter('I69-12345',options);
 assert.equal(await writeAudit({screen:1,action:'I',docuNo:'I69-12345'},options),42);
 assert.equal(calls.length,3);
});
