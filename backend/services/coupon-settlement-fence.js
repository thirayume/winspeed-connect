'use strict';
const crypto=require('crypto');
const changed=()=>Object.assign(Error('ข้อมูลตั๋วหรือใบขนเปลี่ยนระหว่างดำเนินการ กรุณาลองใหม่'),{status:409,code:'COUPON_SETTLEMENT_STALE'});
function canonical(value) {
  if(value instanceof Date)return value.toISOString();
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
function fingerprint(rows) {
  const canonicalRows=(rows||[]).map(r=>JSON.stringify(canonical(r))).sort();
  return crypto.createHash('sha256').update(JSON.stringify(canonicalRows)).digest('hex');
}
function createTransactionQuery(tx) {
  return async(text,inputs={})=>{
    const req=tx.request();
    for(const [name,{type,value}] of Object.entries(inputs))req.input(name,type,value);
    // Existing snapshot queries are read-only; retain read locks through the
    // transaction so external writers cannot invalidate the verified state.
    return req.query(text.replace(/WITH\s*\(NOLOCK\)/gi,'WITH (HOLDLOCK)'));
  };
}
async function validateSettlementSnapshot(tx,{couponId, snapshots, policy, readPolicy}) {
  const {sql}=require('../db');
  const lock=(await tx.request().input('resource',sql.NVarChar(255),`WF_COUPON_SETTLE_${couponId}`)
    .query("DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult")).recordset?.[0];
  if(lock?.LockResult==null || !Number.isInteger(Number(lock.LockResult)) || Number(lock.LockResult)<0) throw Object.assign(Error('COUPON_SETTLEMENT_BUSY'),{status:409,code:'COUPON_SETTLEMENT_BUSY'});
  const query=createTransactionQuery(tx);
  for(const snapshot of snapshots) {
    const fresh=(await query(snapshot.text,snapshot.inputs)).recordset || [];
    if(fingerprint(fresh)!==fingerprint(snapshot.rows))throw changed();
  }
  if(readPolicy && fingerprint([await readPolicy(query)])!==fingerprint([policy]))throw changed();
}
module.exports={validateSettlementSnapshot,fingerprint};
