'use strict';

// Internal claim integration. The caller must hold the global reset fence and
// create the claim in this same transaction. It must authorize the operation,
// persist claim lines/identity audit and redact opening source details.
const { acquireRebateParticipantFence }=require('./rebate-participant-fence');
const { sharedRebateScopeFilter }=require('./rebate-shared-scope');
const { readShipmentLots }=require('./rebate-shipment-lots');
const { allocateShipmentClaim }=require('./rebate-shipment-claim-allocation');
const { reserveShipmentAccrual }=require('./rebate-shipment-reservation');
function fail(code,status=409){throw Object.assign(new Error(code),{code,status});}
async function reserveShipmentClaim(query,epoch,user,{custId,claimId,lines,startDate}={},options={}){
  if(typeof query!=='function'||!Number.isSafeInteger(custId)||custId<1||custId>2147483647||
      !Number.isSafeInteger(claimId)||claimId<1||claimId>2147483647||!epoch||epoch.generation<1)fail('REBATE_CLAIM_INPUT_INVALID',400);
  await (options.participantFence||acquireRebateParticipantFence)(query,epoch);
  const lock=(await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
    @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`,
  {resource:`RebateCust_${custId}`})).recordset?.[0]?.LockResult;
  if(!Number.isInteger(lock)||lock<0)fail('REBATE_RESERVATION_LOCK_UNAVAILABLE');
  const scope=await (options.scopeFilter||sharedRebateScopeFilter)(user,options.getScope);
  const rows=await (options.readLots||readShipmentLots)(query,{epoch,custId,scopeSql:scope.sql,scopeInputs:scope.inputs});
  if(!rows.length)fail('REBATE_CUSTOMER_OUT_OF_SCOPE',404);
  const result=allocateShipmentClaim(rows,lines,{startDate});
  for(const a of result.allocations) await (options.reserve||reserveShipmentAccrual)(query,epoch,
    {accrualId:a.accrualId,custId,documentId:claimId,documentType:'CLAIM',quantityTon:a.quantityTon});
  return result;
}
module.exports={reserveShipmentClaim};
