'use strict';

// A sales-order transaction that touches rebate claims or balances must hold
// both reset fences until commit. Preserve legacy behavior while the new pool
// is disabled; once enabled, a missing or changed epoch fails closed.
async function withSoRebateTransaction(operation, options = {}) {
  if(typeof operation!=='function')throw new TypeError('operation is required');
  const env=options.env||process.env,db=options.db||require('../db');
  const transaction=options.transaction||db.wfTransaction;
  if(env.REBATE_POOL_103_ENABLED!=='true')return transaction(operation);
  const route=options.routeFence||require('./rebate-route-fence').withRebateRouteFence;
  const participant=options.participantFence||require('./rebate-route-fence').routeParticipantFence;
  const makeQuery=options.transactionQuery||require('./rebate-sql').transactionQuery;
  return route(epoch=>transaction(async tx=>{
    await participant(makeQuery(tx,db.sql),epoch);
    return operation(tx,epoch);
  }));
}

// Until a separately audited reversal exists, never edit/cancel/delete a
// native booking with a committed ticket receipt. Called inside the fenced
// business transaction so a concurrent redemption cannot slip past the check.
async function assertNoRedeemedTicketForBooking(tx,so,options={}) {
  const env=options.env||process.env;
  if(env.REBATE_POOL_103_ENABLED!=='true'||!so?.ImportedDocuNo)return;
  const id=Number(so.Id),db=options.db||require('../db');
  if(!Number.isSafeInteger(id)||id<1||id>2147483647)
    throw Object.assign(Error('TICKET_BOOKING_INPUT_INVALID'),{code:'TICKET_BOOKING_INPUT_INVALID',status:409});
  // Redemption locks the booking before the receipt; use the same order to
  // avoid a check/write race and reduce deadlocks with concurrent redemption.
  const booking=await tx.request().input('id',db.sql.Int,id).query(`SELECT SOID FROM dbo.SOHD
    WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@id AND DocuType=103`);
  if(booking.recordset?.length!==1)throw Object.assign(Error('ไม่พบใบจองต้นทาง'),{code:'TICKET_BOOKING_NOT_FOUND',status:409});
  const result=await tx.request().input('id',db.sql.Int,id).query(`SELECT TOP 1 Id FROM wf.RebateTicketRedemptionReceipt
    WITH(UPDLOCK,HOLDLOCK) WHERE BookingSOID=@id`);
  if(result.recordset?.length)throw Object.assign(Error('บิลนี้ใช้ตั๋ว Rebate แล้ว กรุณาติดต่อผู้ดูแลก่อนแก้ไขหรือยกเลิก'),
    {code:'TICKET_REDEMPTION_LINKED',status:409});
}
// Owner, 22 Nov 2026: cancelling an issued 103 gives back the Rebate tickets its ticket lines still hold (RESERVED,
// no 116 yet). A final deduction (FINAL, or a receipt of the earlier redeem route) still blocks the cancel.
async function releaseTicketsForCancelledBooking(tx,so,{reason,userId=null}={},options={}) {
  const env=options.env||process.env;
  if(env.REBATE_POOL_103_ENABLED!=='true'||!so?.ImportedDocuNo)return 0;
  const id=Number(so.Id),db=options.db||require('../db');
  if(!Number.isSafeInteger(id)||id<1||id>2147483647)
    throw Object.assign(Error('TICKET_BOOKING_INPUT_INVALID'),{code:'TICKET_BOOKING_INPUT_INVALID',status:409});
  const booking=await tx.request().input('id',db.sql.Int,id).query(`SELECT SOID FROM dbo.SOHD
    WITH(UPDLOCK,HOLDLOCK) WHERE SOID=@id AND DocuType=103`);
  if(booking.recordset?.length!==1)throw Object.assign(Error('ไม่พบใบจองต้นทาง'),{code:'TICKET_BOOKING_NOT_FOUND',status:409});
  const query=require('./rebate-sql').transactionQuery(tx,db.sql);
  return require('./rebate-ticket-lines').releaseReservedTicketsForBooking(query,{bookingId:id,docuNo:so.WfRef||so.ImportedDocuNo||null,
    reason:reason||'ยกเลิกใบสั่งจองใน Sale-App',userId,env});
}
module.exports={withSoRebateTransaction,assertNoRedeemedTicketForBooking,releaseTicketsForCancelledBooking};
