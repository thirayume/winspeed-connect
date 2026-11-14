'use strict';

// Called inside the globally fenced business transaction while holding the
// same customer lock as claims. This is not an HTTP endpoint. Source evidence
// and actor/effective scopes must be rechecked by the surrounding workflow.
const { requireOct31StandingPrice } = require('./rebate-conversion-service');
const { allocateShipmentRebate } = require('./rebate-shipment-fifo');
const { reserveShipmentAccrual } = require('./rebate-shipment-reservation');
const { readShipmentLots } = require('./rebate-shipment-lots');
const { generateDocCode, mapConversionRow, round2, round4 } = require('./rebate-pool-models');
function fail(code,status=400) { throw Object.assign(new Error(code),{code,status}); }

async function executeShipmentSourceConversion(query, input, options = {}) {
  const { epoch, custId, goodId, standingYear, asOfDate, actorUser, requestedAmountBaht, requestedTons,
    convertAllEligible, maturedOnly, note, cycleMonths=12, scopeSql='1=0', scopeInputs={} }=input;
  const status = options.pendingApproval === true ? 'PENDING_APPROVAL' : 'ISSUED';
  if (!epoch || !Number.isSafeInteger(epoch.generation) || epoch.generation<1 || !epoch.resetId) fail('REBATE_RESET_EPOCH_INVALID',503);
  // SalesEmpId is supplied by the linked WinSpeed sale for both actor and
  // effective scope expressions. Historical shipments are not discarded by
  // the display cutoff; they can be consumed as an opening balance.
  const rows=await readShipmentLots(query,{epoch,custId,scopeSql,scopeInputs});
  if (!rows.length) fail('REBATE_CUSTOMER_OUT_OF_SCOPE',404);
  const standing=await (options.standingPrice||requireOct31StandingPrice)(query,{standingYear,goodId,lock:true});
  const amount=requestedTons!=null?round2(Number(requestedTons)*standing.basePrice):requestedAmountBaht;
  const allocation=allocateShipmentRebate(rows,{requestedAmountBaht:amount,convertAll:convertAllEligible===true,
    maturedOnly:maturedOnly===true,asOfDate,cycleMonths});
  const baht=Number(allocation.convertedBaht), tons=round4(baht/standing.basePrice);
  if (requestedTons!=null && tons!==Number(requestedTons)) fail('CONVERSION_TONNAGE_NOT_REPRESENTABLE');
  const bags=Math.floor(baht/standing.basePrice*20+1e-6);
  const residual=Math.max(0,round2(baht-bags*round2(standing.basePrice/20)));
  const inserted=await query(`INSERT INTO wf.FertilizerTicketConversion
    (ConversionNo,CustId,CustCode,CustName,StandingYear,GoodId,GoodCode,GoodName,StandingPricePerTon,
     ConvertedTons,ConvertedBags,ConvertedValueBaht,ResidualBaht,ExecutionMode,ConvertedByUserId,ConvertedByRole,Note,Status)
    OUTPUT INSERTED.* VALUES(@number,@custId,@custCode,@custName,@year,@goodId,@goodCode,@goodName,@price,
      @tons,@bags,@amount,@residual,'MANUAL',@userId,@role,@note,@status)`,{
    number:generateDocCode('FTC',asOfDate),custId,custCode:rows[0].CustCode??null,custName:rows[0].CustName??null,
    year:standingYear,goodId:standing.goodId,goodCode:standing.goodCode,goodName:standing.goodName,price:standing.basePrice,
    tons,bags,amount:baht,residual,userId:Number(actorUser.id),role:String(actorUser.role||'UNKNOWN'),note,status,
  });
  const conversion=mapConversionRow(inserted.recordset?.[0]);
  if (!Number.isSafeInteger(Number(conversion?.id)) || Number(conversion.id)<=0) fail('CONVERSION_RECEIPT_INVALID',500);
  for(const item of allocation.allocations) {
    await (options.reserve||reserveShipmentAccrual)(query,epoch,{accrualId:item.accrualId,custId,
      documentId:Number(conversion.id),documentType:'CONVERSION',quantityTon:item.quantityTon});
  }
  return {conversion,remainingPoolBalance:Number(allocation.remainingBaht)};
}
module.exports={executeShipmentSourceConversion};
