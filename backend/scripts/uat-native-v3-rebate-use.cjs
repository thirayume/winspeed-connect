'use strict';
// Uses the actual ticket issued from the preceding verified transport phase.
module.exports=async function(ctx){
 const {call,query,check,save,state,sql,CUST_ID,RUN,deliveryDate}=ctx;
 if(!require('./native-v3-qa-profile.cjs').assertQaProfile().rebate||!state.rebate?.approval)throw Error('QA_REBATE_ISSUANCE_REQUIRED');
 const r=ctx.rebateState||state.rebate,caseKey=ctx.caseKey||'R',c=state.cases[caseKey]||(state.cases[caseKey]={book:'K'});save();
 const goods=await call('GET','/master/goods?limit=2000',undefined,'sales');
 const customers=await call('GET','/master/customers?q='+CUST_ID+'&limit=50',undefined,'sales');
 const good=goods.data.find(g=>Number(g.GoodID)===r.goodId),customer=customers.data.find(c=>Number(c.CustID)===CUST_ID);
 const other=(await query('SELECT d.GoodID,d.GoodPrice2 FROM dbo.SODT d WHERE d.SOID=@s AND d.ListNo=2',
  {s:{type:sql.Int,value:state.cases.I.delivery.nativeId}})).recordset[0];
 const paid=goods.data.find(g=>Number(g.GoodID)===other.GoodID);
 if(!good||!paid||!customer)throw Error('QA_REBATE_MASTER_FIXTURE_REQUIRED');
 if(!c.draftId){
  const result=await call('POST','/so',{soPrefix:'K',custId:String(CUST_ID),custName:customer.CustName,deliveryDate,
   truckPlate:'QA-REBATE-USE',remark:RUN+' real issued Rebate ticket',isOwnTruck:false,noTruckRequired:false,creditDays:Number(customer.CreditDays||0),
   lines:[{goodId:String(r.goodId),goodCode:good.GoodCode,goodName:good.GoodName,qtyTon:0.05,masterQty:0.05,childQty:0,pricePerTon:0,netPricePerTon:0,isRebateTicket:true},
    {goodId:String(other.GoodID),goodCode:paid.GoodCode,goodName:paid.GoodName,qtyTon:0.05,masterQty:0.05,childQty:0,
     pricePerTon:Number(other.GoodPrice2),netPricePerTon:Number(other.GoodPrice2),rebatePricingMode:'POOL'}]},'sales');
  check(result.status===200,'REBATE_TICKET_AND_PAID_LINE_DRAFT');c.draftId=(result.data.ids||result.data.createdIds||[result.data.id])[0];save();
 }
 if(!c.verified){check((await call('PATCH','/so/'+c.draftId+'/verify',{},'manager')).status===200,'REBATE_BILL_VERIFIED');c.verified=true;save();}
 if(!c.tripId){
  const result=await call('POST','/trips',{tripCode:RUN+'-'+caseKey,transRegistration:'QA-REBATE-USE',driverName:'QA SIMULATION',
   truckCapacityTon:10,orderIds:[c.draftId],scheduledDate:deliveryDate,remark:RUN+' Rebate redemption'},'sales');
  check(result.status===200,'REBATE_TRIP_CREATED');c.tripId=result.data.tripId;save();
 }
 if(!c.tripCommand){
  const result=await call('GET','/trips/'+c.tripId,undefined,'sales'),trip=result.data.trip||result.data;
  c.tripCommand={confirmedOrderIds:['DRAFT:'+c.draftId],transRegistration:'QA-REBATE-USE',driverName:'QA SIMULATION',
   pickupDueDate:deliveryDate,expectedRevision:trip.DocumentRevision??trip.documentRevision,idempotencyKey:RUN+'-REBATE-CONFIRM-'+caseKey};save();
 }
 const confirm=await Promise.all([call('POST','/trips/'+c.tripId+'/confirm',c.tripCommand,'sales'),call('POST','/trips/'+c.tripId+'/confirm',c.tripCommand,'sales')]);
 check(confirm.every(x=>x.status===200),'REBATE_CONCURRENT_CONFIRM_AND_REPLAY');
 const origins=(await query('SELECT o.SOID,h.DocuNo FROM wf.NativeBookingOrigin o JOIN dbo.SOHD h ON h.SOID=o.SOID WHERE o.SourceDraftId=@d',
  {d:{type:sql.Int,value:c.draftId}})).recordset;
 check(origins.length===1,'REBATE_ONE_103_FROM_CONCURRENT_CONFIRM');c.soid=Number(origins[0].SOID);c.bookingNo=origins[0].DocuNo;save();
 const receipts=(await query(`SELECT r.Id,s.Status FROM wf.RebateTicketRedemptionReceipt r JOIN wf.RebateTicketReceiptState s ON s.ReceiptId=r.Id
  WHERE r.BookingSOID=@s`,{s:{type:sql.Int,value:c.soid}})).recordset;
 check(receipts.length===1&&['RESERVED','FINAL'].includes(receipts[0].Status),'REBATE_DEDUCTED_ONCE_AT_103');
 const operational=require('./uat-native-v3-phases.cjs')({...ctx,lineTon:0.05,totalTon:0.1});
 await operational.ai('K',c);await operational.delivery('K',c);
 c.cuts||=[];
 for(const [i,qty]of ['0.02','0.03'].entries())if(c.cuts.length<=i){
  c.cuts.push(await operational.approvedCut(c.delivery.lines.map(l=>({couponId:l.CouponId,quantity:qty})),(caseKey==='R'?31:51)+i,c));save();
 }
 await operational.invoice('K',c);
 const db=require('../db'),{transactionQuery,rebateQuery}=require('../services/rebate-sql');
 const settle=()=>require('../services/rebate-ticket-lines').settleReservedTickets({afterReceiptId:Number(receipts[0].Id)-1,limit:1,
  runTx:fn=>db.wfTransaction(tx=>fn(transactionQuery(tx,sql),incident=>require('../services/rule-incidents').recordIncidentTx(tx,incident))),
  listQuery:rebateQuery(query,sql)});
 const settled=await settle();
 check(receipts[0].Status==='FINAL'||settled.some(s=>s.receiptId===Number(receipts[0].Id)&&s.outcome==='FINAL'),'REBATE_116_FINALIZES_ACTUAL_TICKET_RECEIPT');
 await settle();
 const final=(await query(`SELECT s.Status,(SELECT COUNT(*) FROM wf.RebateTicketRedemptionAllocation a WHERE a.ReceiptId=r.Id) AS Allocations,
  (SELECT COUNT(*) FROM wf.RebateTicketRedemptionAllocation a WHERE a.ReceiptId=r.Id AND a.TicketId=@t) AS NewTicketAllocations
  FROM wf.RebateTicketRedemptionReceipt r JOIN wf.RebateTicketReceiptState s ON s.ReceiptId=r.Id WHERE r.Id=@r`,
  {r:{type:sql.BigInt,value:receipts[0].Id},t:{type:sql.BigInt,value:r.approval.ticketId}})).recordset[0];
 check(final.Status==='FINAL'&&final.Allocations===1&&final.NewTicketAllocations===1,'REBATE_FINAL_REPLAY_NO_SECOND_ALLOCATION');
};
