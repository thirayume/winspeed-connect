'use strict';

// Called only while holding the same RebateCust_<id> transaction lock used by
// claim creation. Sources are the existing WinSpeed-backed claim lots, not
// wf.RebateTransactionLedger, so the two operations cannot consume twice.
const { requireOct31StandingPrice } = require('./rebate-conversion-service');
const { allocateSharedRebate } = require('./rebate-shared-fifo');
const { generateDocCode, mapConversionRow, round2, round4 } = require('./rebate-pool-models');

function fail(code, status = 400) { throw Object.assign(new Error(code), { code, status }); }

async function executeSharedSourceConversion(query, input) {
  const { custId, goodId, standingYear, asOfDate, actorUser, requestedAmountBaht, requestedTons,
    convertAllEligible, maturedOnly, note, cycleMonths = 12, scopeSql = '1=0', scopeInputs = {} } = input;
  const permission = await query(`SELECT TOP 1 1 AS ok FROM wf.v_RebateAccrualRemaining
    WHERE CustId=@cid AND ${scopeSql}`, { ...scopeInputs, cid: String(custId) });
  if (!permission.recordset?.length) fail('REBATE_CUSTOMER_OUT_OF_SCOPE', 404);
  const standing = await requireOct31StandingPrice(query, { standingYear, goodId, lock: true });
  const lots = (await query(`SELECT SourceSOID,SourceListNo,SourceDocuNo,SourceDocuDate,
      CustCode,CustName,PlanId,RebatePerTon,RemainingTonRebate
    FROM wf.v_RebateAccrualRemaining
    WHERE CustId=@cid AND RemainingTonRebate > 0 AND SourceDocuDate <= @today
      AND PlanId IS NOT NULL AND RebatePerTon > 0 AND ${scopeSql}
    ORDER BY SourceDocuDate,SourceDocuNo,SourceListNo,SourceSOID`, { ...scopeInputs, cid: String(custId), today: asOfDate })).recordset || [];
  const amount = requestedTons != null ? round2(Number(requestedTons) * standing.basePrice) : requestedAmountBaht;
  const allocation = allocateSharedRebate(lots, { requestedAmountBaht: amount,
    convertAll: convertAllEligible === true, maturedOnly: maturedOnly === true, asOfDate, cycleMonths });
  const convertedTons = round4(allocation.convertedBaht / standing.basePrice);
  // A baht amount is stored to two decimal places. Do not silently issue a
  // different quantity when the requested tonnage cannot be represented.
  if (requestedTons != null && convertedTons !== Number(requestedTons)) {
    fail('CONVERSION_TONNAGE_NOT_REPRESENTABLE');
  }
  const convertedBags = Math.floor(allocation.convertedBaht / standing.basePrice * 20 + 1e-6);
  const residualBaht = Math.max(0, round2(allocation.convertedBaht - convertedBags * round2(standing.basePrice / 20)));
  const inserted = await query(`INSERT INTO wf.FertilizerTicketConversion
    (ConversionNo,CustId,CustCode,CustName,StandingYear,GoodId,GoodCode,GoodName,StandingPricePerTon,
     ConvertedTons,ConvertedBags,ConvertedValueBaht,ResidualBaht,ExecutionMode,ConvertedByUserId,ConvertedByRole,Note,Status)
    OUTPUT INSERTED.* VALUES (@number,@custId,@custCode,@custName,@year,@goodId,@goodCode,@goodName,@price,
      @tons,@bags,@amount,@residual,'MANUAL',@userId,@role,@note,'ISSUED')`, {
    number: generateDocCode('FTC', asOfDate), custId, custCode: lots[0]?.CustCode ?? null,
    custName: lots[0]?.CustName ?? null, year: standingYear, goodId: standing.goodId,
    goodCode: standing.goodCode, goodName: standing.goodName, price: standing.basePrice,
    tons: convertedTons, bags: convertedBags, amount: allocation.convertedBaht, residual: residualBaht,
    userId: Number(actorUser.id), role: String(actorUser.role || 'UNKNOWN'), note,
  });
  const conversion = mapConversionRow(inserted.recordset?.[0]);
  if (!conversion?.id) fail('CONVERSION_RECEIPT_INVALID', 500);
  for (const item of allocation.allocations) {
    await query(`INSERT INTO wf.RebateConversionSourceAllocation
      (ConversionId,SourceSOID,SourceListNo,QtyTon,RebatePerTon,AmountBaht)
      VALUES (@conversionId,@sourceSOID,@sourceListNo,@qtyTon,@rebatePerTon,@amountBaht)`, {
      conversionId: conversion.id, ...item,
    });
  }
  return { conversion, remainingPoolBalance: allocation.remainingBaht };
}

module.exports = { executeSharedSourceConversion };
