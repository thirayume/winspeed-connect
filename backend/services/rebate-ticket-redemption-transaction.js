'use strict';
// Internal transaction primitive only. Caller owns transaction AND reset
// fences. No API may expose it without a verified native accounting contract.
const {lockTicketBookingContext}=require('./rebate-ticket-booking-proof');
const {planTicketRedemption,ticketUnits}=require('./rebate-ticket-redemption-plan');
const {assertAgingNotBlocked}=require('./rebate-ticket-service');
const {acquireRebateParticipantFence}=require('./rebate-participant-fence');
function fail(code,status=409){throw Object.assign(Error(code),{code,status});}
function positive(n){return Number.isSafeInteger(n)&&n>0;}
function uuid(v){return typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);}
async function applyTicketRedemption(query,input={},options={}){
  if(typeof query!=='function'||!uuid(input.requestId)||!['ZERO','DISCOUNT'].includes(input.treatment))
    fail('TICKET_REDEMPTION_INPUT_INVALID',400);
  // A browser may never supply a boolean that claims accounting correctness.
  // The not-yet-implemented verifier must examine the locked native source.
  if(typeof options.verifyFinancialTreatment!=='function')fail('TICKET_FINANCIAL_PROOF_UNAVAILABLE',503);
  if(!options.epoch)fail('REBATE_RESET_PARTICIPANT_MISMATCH',503);
  await (options.participantFence||acquireRebateParticipantFence)(query,options.epoch);
  const context=await (options.lockContext||lockTicketBookingContext)(query,input,options);
  if(await options.verifyFinancialTreatment(query,context,input.treatment)!==true)
    fail('TICKET_FINANCIAL_PROOF_UNAVAILABLE',503);
  const p={requestId:input.requestId.toLowerCase(),bookingId:context.bookingId,lineNo:context.lineNo};
  const receipts=(await query(`SELECT * FROM wf.RebateTicketRedemptionReceipt WITH(UPDLOCK,HOLDLOCK)
    WHERE RequestId=@requestId OR (BookingSOID=@bookingId AND BookingLineNo=@lineNo)`,p)).recordset||[];
  if(receipts.length>1)fail('TICKET_REDEMPTION_CONFLICT');
  if(receipts.length===1){
    const r=receipts[0];
    if(String(r.RequestId||'').toLowerCase()!==p.requestId||Number(r.BookingSOID)!==context.bookingId||
       Number(r.BookingLineNo)!==context.lineNo||Number(r.CustId)!==context.customer||Number(r.GoodId)!==context.good||
       ticketUnits(r.QuantityTon)!==ticketUnits(context.requestedTonnage)||r.Treatment!==input.treatment||
       String(r.NativeFingerprint||'').trim()!==context.nativeFingerprint||
       Number(r.ActorPrimaryId)!==context.identity.actorId||Number(r.EffectivePrimaryId)!==context.identity.effectiveId||
       Number(r.ActorBusinessId)!==context.business.actor||Number(r.EffectiveBusinessId)!==context.business.effective||
       !positive(Number(r.Id)))fail('TICKET_REDEMPTION_CONFLICT');
    const allocations=(await query(`SELECT TicketId,Ordinal,QuantityTon,RemainingBefore,RemainingAfter
      FROM wf.RebateTicketRedemptionAllocation WHERE ReceiptId=@receiptId ORDER BY Ordinal`,{receiptId:Number(r.Id)})).recordset||[];
    let sum=0n;const seen=new Set();
    for(let i=0;i<allocations.length;i++){
      const a=allocations[i],id=Number(a.TicketId),q=ticketUnits(a.QuantityTon),before=ticketUnits(a.RemainingBefore),after=ticketUnits(a.RemainingAfter);
      if(!positive(id)||seen.has(id)||Number(a.Ordinal)!==i+1||q<=0n||before-q!==after)fail('TICKET_REDEMPTION_RECEIPT_INVALID');
      seen.add(id);sum+=q;
    }
    if(sum!==ticketUnits(context.requestedTonnage))fail('TICKET_REDEMPTION_RECEIPT_INVALID');
    return {id:Number(r.Id),replayed:true,allocations};
  }
  await (options.assertAging||assertAgingNotBlocked)(query,context.customer,{asOfDate:context.today,lock:true});
  const tickets=(await query(`SELECT Id,CustId,GoodId,IssuedTonnage,RemainingTonnage,IssuedDate,ExpiryDate,ExtendedExpiryDate,Status
    FROM wf.FertilizerTicket WITH(UPDLOCK,HOLDLOCK) WHERE CustId=@customer AND GoodId=@good ORDER BY Id`,
  {customer:context.customer,good:context.good})).recordset||[];
  const plan=planTicketRedemption({customerId:context.customer,goodId:context.good,
    requestedTonnage:context.requestedTonnage,asOfDate:context.today,tickets});
  const receipt=(await query(`INSERT wf.RebateTicketRedemptionReceipt
    (RequestId,BookingSOID,BookingLineNo,CustId,GoodId,QuantityTon,Treatment,NativeFingerprint,
     ActorPrimaryId,EffectivePrimaryId,ActorBusinessId,EffectiveBusinessId)
    OUTPUT INSERTED.Id VALUES(@requestId,@bookingId,@lineNo,@customer,@good,CAST(@quantity AS decimal(14,4)),
      @treatment,@fingerprint,@actor,@effective,@actorBusiness,@effectiveBusiness)`,{
    ...p,customer:context.customer,good:context.good,quantity:context.requestedTonnage,treatment:input.treatment,
    fingerprint:context.nativeFingerprint,actor:context.identity.actorId,effective:context.identity.effectiveId,
    actorBusiness:context.business.actor,effectiveBusiness:context.business.effective})).recordset?.[0];
  const receiptId=Number(receipt?.Id);if(!positive(receiptId))fail('TICKET_REDEMPTION_RECEIPT_INVALID');
  for(let i=0;i<plan.allocations.length;i++){
    const a=plan.allocations[i];
    const update=await query(`UPDATE wf.FertilizerTicket SET RemainingTonnage=CAST(@after AS decimal(14,4)),
      Status=@status,UpdatedAt=DATEADD(hour,7,GETUTCDATE())
      WHERE Id=@ticketId AND CustId=@customer AND GoodId=@good AND RemainingTonnage=CAST(@before AS decimal(14,4))
        AND Status IN ('ACTIVE','PARTIALLY_USED','EXTENDED_ACTIVE')`,{
      ticketId:a.ticketId,customer:context.customer,good:context.good,before:a.remainingBefore,after:a.remainingAfter,status:a.status});
    if(Number(update.rowsAffected?.[0])!==1)fail('TICKET_REDEMPTION_STALE');
    const allocation=await query(`INSERT wf.RebateTicketRedemptionAllocation
      (ReceiptId,TicketId,Ordinal,QuantityTon,RemainingBefore,RemainingAfter)
      VALUES(@receiptId,@ticketId,@ordinal,CAST(@quantity AS decimal(14,4)),
        CAST(@before AS decimal(14,4)),CAST(@after AS decimal(14,4)))`,
    {receiptId,ticketId:a.ticketId,ordinal:i+1,quantity:a.quantityTon,before:a.remainingBefore,after:a.remainingAfter});
    if(Number(allocation.rowsAffected?.[0])!==1)fail('TICKET_REDEMPTION_RECEIPT_INVALID');
    const history=await query(`INSERT wf.TicketRedemptionHistory(TicketId,SoId,DocNo,RedemptionOrder,RedeemedTonnage,
      RemainingBefore,RemainingAfter,RedeemedByUserId,Note)
      VALUES(@ticketId,@bookingId,@docuNo,@ordinal,CAST(@quantity AS decimal(14,4)),
        CAST(@before AS decimal(14,4)),CAST(@after AS decimal(14,4)),@effectiveBusiness,@note)`,
    {ticketId:a.ticketId,bookingId:context.bookingId,docuNo:context.docuNo,ordinal:i+1,
      quantity:a.quantityTon,before:a.remainingBefore,after:a.remainingAfter,effectiveBusiness:context.business.effective,
      note:`Rebate ticket receipt ${receiptId}`});
    if(Number(history.rowsAffected?.[0])!==1)fail('TICKET_REDEMPTION_RECEIPT_INVALID');
  }
  return {id:receiptId,replayed:false,allocations:plan.allocations};
}
// This wrapper binds the authoritative global date and both reset fences.
// No route calls it until the native financial verifier exists and UAT passes.
async function executeTicketRedemption(user,payload={},options={}){
  const db=options.db||require('../db');
  const readWindow=options.readWindow||require('./global-data-window-store').readGlobalDataWindow;
  const fence=options.runFence||require('./rebate-reset-fence').withRebateOperationFence;
  const runTx=options.runTx||(fn=>db.wfTransaction(tx=>fn(require('./rebate-sql').transactionQuery(tx,db.sql))));
  const window=await readWindow();
  return fence(epoch=>runTx(query=>applyTicketRedemption(query,{
    user,bookingId:Number(payload.bookingId),lineNo:Number(payload.lineNo),requestedTonnage:payload.requestedTonnage,
    requestId:payload.requestId,treatment:payload.treatment,startDate:window.businessDate,
  },{...options,epoch})));
}
module.exports={applyTicketRedemption,executeTicketRedemption};
