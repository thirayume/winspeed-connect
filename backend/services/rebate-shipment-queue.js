'use strict';
const { isValidStartDate }=require('./data-window');
const { shipmentUnits,shipmentMoney }=require('./rebate-shipment-accrual');
const { computeCycleExpiryDate }=require('./rebate-pool-models');
const { readShipmentLots }=require('./rebate-shipment-lots');
const { lockVerifiedShipment }=require('./rebate-verified-shipment');
const { lockShipmentBookingSnapshot }=require('./rebate-shipment-booking-snapshot');
function fail(code,status=409){throw Object.assign(Error(code),{code,status});}
function spendable(qty,rate,cents){
  let lo=0n,hi=qty;
  while(lo<hi){const mid=(lo+hi+1n)/2n;if((mid*rate+500n)/1000n<=cents)lo=mid;else hi=mid-1n;}
  return (lo*rate+500n)/1000n;
}

// The caller holds both reset fences and a business transaction. Lock the
// customer before sources, matching conversion and claim writers.
async function getShipmentCustomerQueue(query,{epoch,custId,asOfDate,cutoff,scope,cycleMonths=12},overrides={}){
  if(typeof query!=='function'||!Number.isSafeInteger(custId)||custId<=0||custId>2147483647||
    !isValidStartDate(asOfDate)||!isValidStartDate(cutoff)||!Number.isInteger(cycleMonths)||cycleMonths<1||cycleMonths>120)
    fail('INVALID_REBATE_QUEUE',400);
  const lock=(await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
    @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`,
  {resource:`RebateCust_${custId}`})).recordset?.[0]?.LockResult;
  if(!Number.isInteger(lock)||lock<0)fail('REBATE_RESERVATION_LOCK_UNAVAILABLE',503);
  const rows=await (overrides.readLots||readShipmentLots)(query,{epoch,custId,scopeSql:scope.sql,scopeInputs:scope.inputs});
  if(!rows.length)fail('REBATE_CUSTOMER_OUT_OF_SCOPE',404);
  if(rows.length>500)fail('REBATE_QUEUE_TOO_MANY_LOTS',503);
  // Inner joins in the detail reader deliberately omit broken native links.
  // Detect those omissions across the customer before totaling any scoped
  // rows; otherwise a changed/deleted source could silently reduce the sum.
  const broken=(await query(`SELECT TOP 1 a.Id FROM wf.RebateShipmentAccrual a WITH(HOLDLOCK)
    WHERE a.EnvironmentKind=@environment AND a.ResetId=@resetId AND a.Generation=@generation AND a.CustId=@custId
      AND NOT EXISTS (
        SELECT 1 FROM wf.RebateShipmentEvidence e
        JOIN dbo.SOHD h ON h.SOID=a.SourceSOID AND h.DocuType=104 AND h.CustID=a.CustId
        JOIN dbo.SODT d ON d.SOID=h.SOID AND d.DocuType=104 AND d.ListNo=a.SourceListNo AND d.GoodID=a.GoodId
        JOIN dbo.WFCoupon c ON c.CouponID=a.CouponId AND c.DocuID=h.SOID AND c.RefListno=d.ListNo
        JOIN dbo.SOHD b ON b.SOID=d.RefSOID AND b.DocuType=103
        JOIN dbo.EMGood g ON g.GoodID=d.GoodID
        WHERE e.Id=a.EvidenceId AND e.EnvironmentKind=a.EnvironmentKind AND e.ResetId=a.ResetId
          AND d.RefSOID=a.BookingSOID AND d.RefListNo=a.BookingLineNo
      )`,{environment:epoch.environment,resetId:epoch.resetId,generation:epoch.generation,custId})).recordset || [];
  if(broken.length)fail('REBATE_RESERVATION_SOURCE_CHANGED');
  let mature=0n,unmature=0n,opening=0n,openingCount=0;const details=[];
  for(const r of rows) {
    const earned=String(r.EarnedDate||'').slice(0,10);
    if(!isValidStartDate(earned))fail('REBATE_SOURCE_INVALID');
    const shipment=await (overrides.lockShipment||lockVerifiedShipment)(query,epoch,
      {redemptionId:Number(r.RedemptionId),listNo:Number(r.RedemptionListNo)});
    const snapshot=await (overrides.lockSnapshot||lockShipmentBookingSnapshot)(query,shipment);
    const rate=shipmentUnits(r.RebatePerTon,2),original=shipmentUnits(r.OriginalTon,3);
    const amount=shipmentUnits(r.OriginalAmount,2),remaining=shipmentUnits(r.RemainingAmountBaht,2),qty=shipmentUnits(r.RemainingTon,3);
    if(Number(r.EvidenceId)!==shipment.evidenceId || Number(r.SourceSOID)!==shipment.sourceSOID ||
       Number(r.SourceListNo)!==shipment.sourceListNo || Number(r.GoodId)!==shipment.goodId ||
       Number(r.BookingSOID)!==snapshot.bookingId || Number(r.BookingLineNo)!==snapshot.bookingLineNo ||
       Number(snapshot.customerId)!==custId || rate!==shipmentUnits(snapshot.rebatePerTon,2) ||
       shipmentUnits(r.ListPricePerTon,2)!==shipmentUnits(snapshot.basePrice,2) ||
       shipmentUnits(r.NetPricePerTon,2)!==shipmentUnits(snapshot.sellingPrice,2) ||
       original!==shipmentUnits(shipment.quantityTon,3) || amount!==(original*rate+500n)/1000n ||
       qty>original || remaining>amount || rate<=0n || rate>30000n ||
       new Date(r.OccurredAtUtc).getTime()!==new Date(shipment.occurredAtUtc).getTime())fail('REBATE_RESERVATION_SOURCE_CHANGED');
    if(earned>asOfDate)continue;
    const available=spendable(qty,rate,remaining);if(available<=0n)continue;
    const expiry=computeCycleExpiryDate(earned,cycleMonths);
    if(expiry<=asOfDate)mature+=available;else unmature+=available;
    if(earned<cutoff){opening+=available;openingCount++;continue;}
    details.push({id:String(r.AccrualId),docNo:String(r.SourceDocuDate||'').slice(0,10)>=cutoff?r.SourceDocuNo:null,
      earnedDate:earned,cycleExpiryDate:expiry,remainingAmount:Number(shipmentMoney(available))});
  }
  return {custId,asOfDate,maturedBalance:Number(shipmentMoney(mature)),activeUnmaturedBalance:Number(shipmentMoney(unmature)),
    totalFifoEligibleBalance:Number(shipmentMoney(mature+unmature)),pendingApprovalBalance:null,
    withoutPlanCount:0,openingEligibleBalance:Number(shipmentMoney(opening)),openingEligibleCount:openingCount,
    detailLimit:500,eligibleLedgers:details};
}
module.exports={getShipmentCustomerQueue};
