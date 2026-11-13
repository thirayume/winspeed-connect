'use strict';

// Claim integration with the verified shipment ledger (reset generation > 0).
// Every function takes a query bound to the business transaction of a caller
// that already holds the global reset fence. The caller authorizes the
// operation, writes the claim header/lines and identity audit in the same
// transaction, and redacts opening-balance source details when presenting.
//
//   planShipmentClaim     lock + scope + FIFO allocation; changes nothing
//   applyShipmentClaimPlan reserves each allocated accrual for the new claim
//   releaseShipmentClaimReservations gives the balance back when a claim is rejected or cancelled
const { acquireRebateParticipantFence }=require('./rebate-participant-fence');
const { sharedRebateScopeFilter }=require('./rebate-shared-scope');
const { readShipmentLots }=require('./rebate-shipment-lots');
const { allocateShipmentClaim }=require('./rebate-shipment-claim-allocation');
const { reserveShipmentAccrual }=require('./rebate-shipment-reservation');
function fail(code,status=409){throw Object.assign(new Error(code),{code,status});}
const id32=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;

async function lockCustomer(query,custId){
  const lock=(await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
    @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`,
  {resource:`RebateCust_${custId}`})).recordset?.[0]?.LockResult;
  if(!Number.isInteger(lock)||lock<0)fail('REBATE_RESERVATION_LOCK_UNAVAILABLE');
}

async function planShipmentClaim(query,epoch,user,{custId,lines,startDate}={},options={}){
  if(typeof query!=='function'||!id32(custId)||!epoch||!Number.isSafeInteger(epoch.generation)||epoch.generation<1)fail('REBATE_CLAIM_INPUT_INVALID',400);
  await (options.participantFence||acquireRebateParticipantFence)(query,epoch);
  await lockCustomer(query,custId);
  const scope=await (options.scopeFilter||sharedRebateScopeFilter)(user,options.getScope);
  const rows=await (options.readLots||readShipmentLots)(query,{epoch,custId,scopeSql:scope.sql,scopeInputs:scope.inputs});
  if(!rows.length)fail('REBATE_CUSTOMER_OUT_OF_SCOPE',404);
  return allocateShipmentClaim(rows,lines,{startDate});
}

async function applyShipmentClaimPlan(query,epoch,{custId,claimId,allocations}={},options={}){
  if(typeof query!=='function'||!id32(custId)||!id32(claimId)||!Array.isArray(allocations)||!allocations.length)fail('REBATE_CLAIM_INPUT_INVALID',400);
  const receipts=[];
  for(const a of allocations) receipts.push(await (options.reserve||reserveShipmentAccrual)(query,epoch,
    {accrualId:a.accrualId,custId,documentId:claimId,documentType:'CLAIM',quantityTon:a.quantityTon}));
  return receipts;
}

async function reserveShipmentClaim(query,epoch,user,{custId,claimId,lines,startDate}={},options={}){
  if(typeof query!=='function'||!id32(custId)||!id32(claimId)||!epoch||epoch.generation<1)fail('REBATE_CLAIM_INPUT_INVALID',400);
  const result=await planShipmentClaim(query,epoch,user,{custId,lines,startDate},options);
  await applyShipmentClaimPlan(query,epoch,{custId,claimId,allocations:result.allocations},options);
  return result;
}

// One claim line per reserved accrual, priced from the accrual snapshot. A
// price or NET typed by the caller is never used.
function claimLinesFromPlan(plan){
  if(!plan||!Array.isArray(plan.allocations)||!plan.allocations.length)fail('REBATE_CLAIM_INPUT_INVALID',400);
  return plan.allocations.map((a,index)=>({
    lineNo:index+1,lineType:'REBATE',
    invoiceNo:String(a.sourceDocuNo||'').slice(0,50)||null,
    goodCode:String(a.goodCode||'').slice(0,50),goodName:String(a.goodName||'').slice(0,200),
    qtyTon:Number(a.quantityTon),pricePerTon:Number(a.listPricePerTon),netPricePerTon:Number(a.netPricePerTon),
    rebatePerTon:Number(a.rebatePerTon),planId:a.planId,remark:null,amountBaht:a.amountBaht,
    isOpeningBalance:a.isOpeningBalance===true,accrualId:a.accrualId,
    sourceSOID:a.sourceSOID,sourceListNo:a.sourceListNo,sourceDocuNo:a.sourceDocuNo,sourceDocuDate:a.sourceDocuDate,
    sourceCouponNo:a.sourceCouponNo,sourceRefSOID:a.sourceRefSOID,sourceRefListNo:a.sourceRefListNo,
    sourceBookingDocuNo:a.sourceBookingDocuNo,
  }));
}

// Returns a rejected or cancelled claim's reserved balance to the customer.
// The release row keeps both identities of an Access As session and the reason.
async function releaseShipmentClaimReservations(query,epoch,{custId,claimId,release}={},options={}){
  const reason=typeof release?.reason==='string'?release.reason.trim():'';
  const ids=[release?.actorPrimaryId,release?.effectivePrimaryId,release?.actorBusinessId,release?.effectiveBusinessId].map(Number);
  if(typeof query!=='function'||!id32(custId)||!id32(claimId)||!ids.every(id32)||!reason||reason.length>500||
      !epoch||!Number.isSafeInteger(epoch.generation)||epoch.generation<1)fail('REBATE_RELEASE_INPUT_INVALID',400);
  // SQL Server 2008 needs these options on every write to a table with filtered indexes.
  await query(`SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON;
    SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET NUMERIC_ROUNDABORT OFF;`,{});
  await (options.participantFence||acquireRebateParticipantFence)(query,epoch);
  await lockCustomer(query,custId);
  const claim=(await query('SELECT Id,CustId FROM wf.RebateClaim WITH(UPDLOCK,HOLDLOCK) WHERE Id=@claimId',{claimId})).recordset?.[0];
  if(!claim||Number(claim.Id)!==claimId||Number(claim.CustId)!==custId)fail('REBATE_RELEASE_CLAIM_INVALID');
  const updated=await query(`UPDATE wf.RebateShipmentReservation
    SET Status='RELEASED',ReleasedAtUtc=GETUTCDATE(),ReleaseActorPrimaryId=@actorPrimary,ReleaseEffectivePrimaryId=@effectivePrimary,
        ReleaseActorBusinessId=@actorBusiness,ReleaseEffectiveBusinessId=@effectiveBusiness,ReleaseReason=@reason
    WHERE ClaimId=@claimId AND Status='ACTIVE'`,
  {claimId,actorPrimary:ids[0],effectivePrimary:ids[1],actorBusiness:ids[2],effectiveBusiness:ids[3],reason});
  const released=Number(updated?.rowsAffected?.[0]??0);
  if(!Number.isSafeInteger(released)||released<0)fail('REBATE_RELEASE_RECEIPT_INVALID');
  return {released};
}

module.exports={planShipmentClaim,applyShipmentClaimPlan,reserveShipmentClaim,claimLinesFromPlan,releaseShipmentClaimReservations};
