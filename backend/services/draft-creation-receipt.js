'use strict';
const {createHash}=require('crypto'),{sql}=require('../db'),{businessIds}=require('./business-identity');
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
function request(orders,user){
 const id=orders[0]?.createRequestId;if(id===undefined)return null;
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)||orders.slice(1).some(o=>o.createRequestId!==undefined))fail('SO_CREATE_REQUEST_INVALID',400);
 return {id:id.toLowerCase(),hash:createHash('sha256').update(JSON.stringify(orders)).digest('hex'),...businessIds(user)};
}
async function read(q,proof,user){
 if(!proof)return null;
 const rows=(await q("SELECT TOP 2 BeforeJson,AfterJson FROM wf.ChangeEvent WHERE EntityType='SO_DRAFT_GROUP' AND EntityId=@receipt ORDER BY EventId",{receipt:{type:sql.VarChar(100),value:proof.id}})).recordset||[];
 if(!rows.length)return null;if(rows.length!==1)fail('SO_CREATE_RECEIPT_AMBIGUOUS',503);
 let before,after;try{before=JSON.parse(rows[0].BeforeJson);after=JSON.parse(rows[0].AfterJson);}catch{fail('SO_CREATE_RECEIPT_INVALID',503);}
 if(before?.hash!==proof.hash||before.effective!==proof.effective||before.actor!==proof.actor)fail('SO_CREATE_REQUEST_CONFLICT');
 const scope=await require('./visible-scope').getVisibleScope(user,q),window=await require('./global-data-window-store').readGlobalDataWindow();
 if(!Array.isArray(after.owners)||!after.owners.length||after.owners.some(id=>!require('./visible-scope').inScope(scope,{userId:id})))fail('SO_CREATE_REPLAY_OUTSIDE_SCOPE',403);
 const created=new Date(after.createdAtUtc).getTime();
 if(!Number.isFinite(created)||created<new Date(window.utcInstant).getTime())fail('SO_CREATE_REPLAY_OUTSIDE_WINDOW');
 return {...after.response,replayed:true};
}
async function lockAndRead(q,proof,user){
 if(!proof)return null;
 const row=(await q("DECLARE @lock int;EXEC @lock=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @lock LockResult",{resource:{type:sql.NVarChar(255),value:'SO_DRAFT_CREATE_'+proof.id}})).recordset?.[0];
 if(!Number.isInteger(row?.LockResult)||row.LockResult<0)fail('SO_CREATE_REQUEST_BUSY');
 return read(q,proof,user);
}
async function save(tx,proof,owners,response){
 if(!proof)return;
 await require('./policy-contract').logChangeEvent(tx,{entityType:'SO_DRAFT_GROUP',entityId:proof.id,action:'CREATE',reasonCode:'SO_CREATE_REQUEST',
  beforeJson:{hash:proof.hash,effective:proof.effective,actor:proof.actor},afterJson:{owners:[...owners],createdAtUtc:new Date().toISOString(),response},userId:String(proof.effective)});
}
module.exports={request,read,lockAndRead,save};
