'use strict';

// Validate all allocations immediately before an approval. A source change,
// missing reservation or line mismatch blocks approval; it never releases or
// silently rewrites a previously reserved financial amount.
const { reserveShipmentAccrual }=require('./rebate-shipment-reservation');
const { shipmentUnits }=require('./rebate-shipment-accrual');
function fail(code){throw Object.assign(new Error(code),{code,status:409});}
const positive=n=>Number.isSafeInteger(n)&&n>0;
function key(row){
  const ids=[Number(row.SourceSOID),Number(row.SourceListNo)];
  const good=String(row.GoodCode||'').trim().toUpperCase();
  if(!ids.every(positive)||row.PlanId!=null||!good)fail('REBATE_CLAIM_RESERVATION_MISMATCH');
  const price=shipmentUnits(row.PricePerTon,2),net=shipmentUnits(row.NetPricePerTon,2),rate=shipmentUnits(row.RebatePerTon,2);
  if(rate<=0n||rate>30000n||price<=0n)fail('REBATE_CLAIM_RESERVATION_MISMATCH');
  return `${ids.join(':')}:${good}:${price}:${net}:${rate}`;
}
function add(map,k,qty,amount){const v=map.get(k)||{qty:0n,amount:0n};v.qty+=qty;v.amount+=amount;map.set(k,v);}
async function verifyShipmentClaimReservations(query,epoch,claim,options={}){
  const claimId=Number(claim?.Id),custId=Number(claim?.CustId);
  if(typeof query!=='function'||!positive(claimId)||!positive(custId)||!epoch||epoch.generation<1)fail('REBATE_CLAIM_RESERVATION_MISMATCH');
  const params={claimId,environment:epoch.environment,resetId:epoch.resetId,generation:epoch.generation};
  const reservations=(await query(`SELECT r.AccrualId,r.QuantityTon,r.AmountBaht,a.SourceSOID,a.SourceListNo,a.PlanId,
      a.ListPricePerTon AS PricePerTon,a.NetPricePerTon,a.RebatePerTon,
      g.GoodCode,e.RedemptionId,e.RedemptionListNo
    FROM wf.RebateShipmentReservation r
    JOIN wf.RebateShipmentAccrual a ON a.Id=r.AccrualId
    JOIN wf.RebateShipmentEvidence e ON e.Id=a.EvidenceId
    JOIN dbo.EMGood g ON g.GoodID=a.GoodId
    WHERE r.ClaimId=@claimId AND r.Status='ACTIVE' AND a.EnvironmentKind=@environment AND a.ResetId=@resetId AND a.Generation=@generation
    ORDER BY e.RedemptionId,e.RedemptionListNo,r.Id`,params)).recordset||[];
  if(!reservations.length)fail('REBATE_CLAIM_RESERVATION_MISSING');
  const lines=(await query(`SELECT SourceSOID,SourceListNo,PlanId,PricePerTon,NetPricePerTon,RebatePerTon,GoodCode,QtyTon,LineAmount,LineType
    FROM wf.RebateClaimLine WITH(HOLDLOCK) WHERE ClaimId=@claimId`,{claimId})).recordset||[];
  if(!lines.length)fail('REBATE_CLAIM_RESERVATION_MISMATCH');
  const reserved=new Map(),claimed=new Map();let amount=0n;
  for(const r of reservations){
    const accrualId=Number(r.AccrualId);if(!positive(accrualId))fail('REBATE_CLAIM_RESERVATION_MISMATCH');
    const qty=shipmentUnits(r.QuantityTon,3),baht=shipmentUnits(r.AmountBaht,2);
    if(qty<=0n||baht<=0n)fail('REBATE_CLAIM_RESERVATION_MISMATCH');
    add(reserved,key(r),qty,baht);amount+=baht;
    const receipt=await (options.reserve||reserveShipmentAccrual)(query,epoch,
      {accrualId,custId,documentId:claimId,documentType:'CLAIM',quantityTon:String(r.QuantityTon)});
    if(receipt?.replayed!==true)fail('REBATE_CLAIM_RESERVATION_MISMATCH');
  }
  for(const l of lines){
    if(String(l.LineType||'').trim().toUpperCase()!=='REBATE')fail('REBATE_CLAIM_RESERVATION_MISMATCH');
    const qty=shipmentUnits(l.QtyTon,3),baht=shipmentUnits(l.LineAmount,2);
    if(qty<=0n||baht<=0n)fail('REBATE_CLAIM_RESERVATION_MISMATCH');add(claimed,key(l),qty,baht);
  }
  if(reserved.size!==claimed.size||amount!==shipmentUnits(claim.ClaimAmt,2))fail('REBATE_CLAIM_RESERVATION_MISMATCH');
  for(const [k,v] of reserved){const c=claimed.get(k);if(!c||v.qty!==c.qty||v.amount!==c.amount)fail('REBATE_CLAIM_RESERVATION_MISMATCH');}
  return {count:reservations.length};
}
module.exports={verifyShipmentClaimReservations};
