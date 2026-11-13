'use strict';
// Internal, read-only transaction proof. Never deduct here: the booking's
// accounting treatment and immutable idempotent receipt remain prerequisites.
const {approvalIdentity}=require('./approval-identity');
const {businessIds,actorPerspective}=require('./business-identity');
const {hasPermission}=require('./role-capabilities');
const {getVisibleScope,inScope}=require('./visible-scope');
const {isValidStartDate}=require('./data-window');
const {planTicketRedemption,ticketUnits,ticketQuantity}=require('./rebate-ticket-redemption-plan');
const {assertAgingNotBlocked}=require('./rebate-ticket-service');
function fail(code,status=409){throw Object.assign(Error(code),{code,status});}
const id=v=>Number.isSafeInteger(v)&&v>0&&v<=2147483647;

async function lockTicketBookingContext(query,{user,bookingId,lineNo,requestedTonnage,startDate}={},overrides={}){
  if(typeof query!=='function'||!id(bookingId)||!id(lineNo)||!isValidStartDate(startDate))fail('TICKET_BOOKING_INPUT_INVALID',400);
  const identity=approvalIdentity(user),business=businessIds(user),actor=actorPerspective(user);
  if(![business.actor,business.effective].every(id))fail('IDENTITY_BINDING_INVALID',409);
  if(!hasPermission(user,'rebate.ticket-redeem')||!hasPermission(actor,'rebate.ticket-redeem'))fail('TICKET_PERMISSION_REQUIRED',403);
  const rows=(await query(`SELECT h.SOID,h.CustID,h.EmpID,RTRIM(h.DocuStatus) AS DocuStatus,
      CONVERT(varchar(10),h.DocuDate,23) AS DocuDate,
      CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),23) AS Today,
      d.ListNo,d.GoodID,CONVERT(varchar(40),CAST(d.GoodQty2 AS decimal(19,4))) AS GoodQty2,
      d.GoodUnitID2,u.GoodUnitCode,u.GoodUnitName,
      h.DocuNo,CONVERT(varchar(40),CAST(d.GoodPrice2 AS decimal(19,4))) AS GoodPrice2,
      CONVERT(varchar(40),CAST(d.GoodAmnt AS decimal(19,4))) AS GoodAmnt,
      CONVERT(varchar(40),CAST(h.BillDiscAmnt AS decimal(19,4))) AS BillDiscAmnt,
      CONVERT(varchar(40),CAST(h.NetAmnt AS decimal(19,4))) AS NetAmnt,
      CONVERT(varchar(40),CAST(h.SumGoodAmnt AS decimal(19,4))) AS SumGoodAmnt,
      CONVERT(varchar(40),CAST(h.SumIncludeAmnt AS decimal(19,4))) AS SumIncludeAmnt,
      CONVERT(varchar(40),CAST(h.SumExcludeAmnt AS decimal(19,4))) AS SumExcludeAmnt,
      CONVERT(varchar(40),CAST(h.BaseDiscAmnt AS decimal(19,4))) AS BaseDiscAmnt,
      CONVERT(varchar(40),CAST(h.BillAftrDiscAmnt AS decimal(19,4))) AS BillAftrDiscAmnt,
      CONVERT(varchar(40),CAST(h.TotaBaseAmnt AS decimal(19,4))) AS TotaBaseAmnt,
      CONVERT(varchar(40),CAST(h.TotaExcludeAmnt AS decimal(19,4))) AS TotaExcludeAmnt,
      CONVERT(varchar(40),CAST(h.MiscChargAmnt AS decimal(19,4))) AS MiscChargAmnt,
      CONVERT(varchar(40),CAST(h.VATAmnt AS decimal(19,4))) AS VATAmnt,RTRIM(h.VatType) AS VatType,
      RTRIM(h.BillDiscFormula) AS BillDiscFormula,
      CONVERT(varchar(18),CONVERT(binary(8),h.VatRate),1) AS VatRateBits
    FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK)
    JOIN dbo.SODT d WITH(UPDLOCK,HOLDLOCK) ON d.SOID=h.SOID AND d.DocuType=103 AND d.ListNo=@lineNo
    LEFT JOIN dbo.EMGoodUnit u WITH(UPDLOCK,HOLDLOCK) ON u.GoodUnitID=d.GoodUnitID2
    WHERE h.SOID=@bookingId AND h.DocuType=103 AND h.DocuDate>=CAST(@startDate AS date)`,
  {bookingId,lineNo,startDate})).recordset||[];
  if(rows.length!==1)fail('TICKET_BOOKING_NOT_FOUND',404);
  const row=rows[0],customer=Number(row.CustID),good=Number(row.GoodID);
  if(Number(row.SOID)!==bookingId||Number(row.ListNo)!==lineNo||!id(customer)||!id(good)||
      !['N','Y'].includes(String(row.DocuStatus||'').trim().toUpperCase())||
      !isValidStartDate(row.DocuDate)||!isValidStartDate(row.Today)||row.DocuDate>row.Today||
      !id(Number(row.GoodUnitID2))||String(row.GoodUnitCode||'').trim()!=='ตัน'||
      String(row.GoodUnitName||'').trim()!=='ตัน')fail('TICKET_BOOKING_SOURCE_UNCONFIRMED');
  const scope=overrides.getVisibleScope||getVisibleScope;
  if(!inScope(await scope(user,query),{empId:row.EmpID})||!inScope(await scope(actor,query),{empId:row.EmpID}))
    fail('TICKET_BOOKING_NOT_FOUND',404);
  const qty=ticketUnits(requestedTonnage),lineQty=ticketUnits(row.GoodQty2);
  if(qty<=0n||qty>lineQty)fail('TICKET_BOOKING_QUANTITY_INVALID');
  // The UAT native amounts are decimal(19,4). Rounding them to cents before
  // hashing would let a WinSpeed edit of less than a cent evade replay checks.
  const fields=['GoodPrice2','GoodAmnt','BillDiscAmnt','NetAmnt','SumGoodAmnt','SumIncludeAmnt',
    'SumExcludeAmnt','BaseDiscAmnt','BillAftrDiscAmnt','TotaBaseAmnt','TotaExcludeAmnt','MiscChargAmnt','VATAmnt'];
  if(fields.some(k=>row[k]==null||!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/.test(String(row[k])))||
      !/^[0-9A-Za-z]{1,8}$/.test(String(row.VatType||'').trim())||
      !/^0x[0-9a-f]{16}$/i.test(String(row.VatRateBits||'')))
    fail('TICKET_BOOKING_FINANCIAL_SOURCE_UNCONFIRMED');
  const money=value=>{const [whole,fraction='']=String(value).split('.');return `${whole}.${fraction.padEnd(4,'0')}`;};
  // A zero-priced additional line can change without changing header totals.
  // Bind every native line (including its discount and VAT attributes) rather
  // than just the line being redeemed. HOLDLOCK also protects the line range.
  const lines=(await query(`SELECT d.DocuType,d.ListNo,d.GoodID,d.GoodUnitID2,
      CONVERT(varchar(40),CAST(d.GoodQty2 AS decimal(19,4))) AS GoodQty2,
      CONVERT(varchar(40),CAST(d.GoodPrice2 AS decimal(19,4))) AS GoodPrice2,
      CONVERT(varchar(40),CAST(d.GoodAmnt AS decimal(19,4))) AS GoodAmnt,
      CONVERT(varchar(40),CAST(d.GoodDiscAmnt AS decimal(19,4))) AS GoodDiscAmnt,
      RTRIM(d.GoodDiscFormula) AS GoodDiscFormula,RTRIM(d.GoodDiscType) AS GoodDiscType,
      RTRIM(d.FreeFlag) AS FreeFlag,RTRIM(d.VatType) AS VatType,
      CONVERT(varchar(18),CONVERT(binary(8),d.VATRate),1) AS VatRateBits
    FROM dbo.SODT d WITH(UPDLOCK,HOLDLOCK)
    WHERE d.SOID=@bookingId ORDER BY d.ListNo`,{bookingId})).recordset||[];
  if(!lines.length||lines.length>1000)fail('TICKET_BOOKING_FINANCIAL_SOURCE_UNCONFIRMED');
  let prior=0;
  const canonicalLines=lines.map(line=>{
    const number=Number(line.ListNo),lineGood=Number(line.GoodID),unit=Number(line.GoodUnitID2);
    if(Number(line.DocuType)!==103||!id(number)||number<=prior||!id(lineGood)||!id(unit)||
       ['GoodPrice2','GoodAmnt','GoodDiscAmnt'].some(k=>line[k]==null||
         !/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/.test(String(line[k])))||
       (line.VatRateBits!=null&&!/^0x[0-9a-f]{16}$/i.test(String(line.VatRateBits))))
      fail('TICKET_BOOKING_FINANCIAL_SOURCE_UNCONFIRMED');
    prior=number;
    return {lineNo:number,good:lineGood,unit,quantity:ticketQuantity(ticketUnits(line.GoodQty2)),
      price:money(line.GoodPrice2),amount:money(line.GoodAmnt),discount:money(line.GoodDiscAmnt),
      discountFormula:line.GoodDiscFormula==null?null:String(line.GoodDiscFormula),
      discountType:line.GoodDiscType==null?null:String(line.GoodDiscType),
      freeFlag:line.FreeFlag==null?null:String(line.FreeFlag),
      vatType:line.VatType==null?null:String(line.VatType),
      vatRateBits:line.VatRateBits==null?null:String(line.VatRateBits).toUpperCase()};
  });
  const selected=canonicalLines.filter(line=>line.lineNo===lineNo);
  if(selected.length!==1||selected[0].good!==good||selected[0].unit!==Number(row.GoodUnitID2)||
     selected[0].quantity!==ticketQuantity(lineQty)||selected[0].price!==money(row.GoodPrice2)||
     selected[0].amount!==money(row.GoodAmnt))fail('TICKET_BOOKING_FINANCIAL_SOURCE_UNCONFIRMED');
  const crypto=require('crypto');
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({version:3,bookingId,lineNo,customer,good,
    date:row.DocuDate,unit:Number(row.GoodUnitID2),quantity:ticketQuantity(lineQty),docuNo:String(row.DocuNo||'').trim(),
    price:money(row.GoodPrice2),amount:money(row.GoodAmnt),
    financial:Object.fromEntries(fields.map(k=>[k,money(row[k])])),vatType:String(row.VatType).trim(),
    billDiscountFormula:row.BillDiscFormula==null?null:String(row.BillDiscFormula),
    vatRateBits:String(row.VatRateBits).toUpperCase(),lines:canonicalLines})).digest('hex');
  if(!String(row.DocuNo||'').trim())fail('TICKET_BOOKING_FINANCIAL_SOURCE_UNCONFIRMED');
  return {bookingId,lineNo,bookingDate:row.DocuDate,today:row.Today,identity,business,customer,good,
    requestedTonnage:ticketQuantity(qty),lineTonnage:ticketQuantity(lineQty),docuNo:String(row.DocuNo).trim(),
    nativeFingerprint:fingerprint,financial:{price:String(row.GoodPrice2),amount:String(row.GoodAmnt),
      billDiscount:String(row.BillDiscAmnt),net:String(row.NetAmnt),
      nativeFields:Object.fromEntries(fields.map(k=>[k,money(row[k])])),
      vatType:String(row.VatType).trim(),vatRateBits:String(row.VatRateBits).toUpperCase()}};
}
async function prepareTicketBookingProof(query,input={},overrides={}){
  const context=await lockTicketBookingContext(query,input,overrides);
  const {customer,good,today}=context;
  await (overrides.assertAging||assertAgingNotBlocked)(query,customer,{asOfDate:today,lock:true});
  const tickets=(await query(`SELECT Id,CustId,GoodId,IssuedTonnage,RemainingTonnage,IssuedDate,ExpiryDate,ExtendedExpiryDate,Status
    FROM wf.FertilizerTicket WITH(UPDLOCK,HOLDLOCK) WHERE CustId=@customer AND GoodId=@good`,{customer,good})).recordset||[];
  return {...context,plan:planTicketRedemption({customerId:customer,goodId:good,requestedTonnage:context.requestedTonnage,asOfDate:today,tickets})};
}
module.exports={prepareTicketBookingProof,lockTicketBookingContext};
