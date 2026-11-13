'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {prepareRebateBookingDecisions}=require('../services/rebate-booking-decisions');
const {reviewBookingPricing}=require('../services/rebate-booking-approval');
const {stageBookingInvoicePrices,finalizeBookingPriceSnapshots}=require('../services/rebate-booking-transaction');
const {accrueVerifiedShipment}=require('../services/rebate-shipment-accrual');
const {reserveShipmentAccrual}=require('../services/rebate-shipment-reservation');

test('transaction primitives carry approved 103 pricing to one shared shipment balance',async()=>{
  const draft={Id:51,Status:'DRAFT',DocumentRevision:3,SalesUserId:99,SaleDate:'2026-11-13'};
  const line={SoId:51,LineNum:1,GoodId:12,QtyTon:2,PricePerTon:9750,RebatePricingMode:'POOL'};
  const shipment={evidenceId:1,sourceSOID:77,sourceListNo:1,couponId:30,goodId:12,quantityTon:'0.500',occurredAtUtc:new Date('2026-11-13T13:00:00Z')};
  const epoch={environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',lastResetAtUtc:new Date('2026-11-13T12:00:00Z')};
  const state={approval:null,snapshot:null,ledger:[],reservations:[],deliveryPrice:10000,invoicePrice:null};
  const query=async(text,p={})=>{
    if(/FROM wf\.SalesOrder WITH/.test(text))return {recordset:[draft]};
    if(/FROM wf\.SalesOrderLine WITH/.test(text))return {recordset:[line]};
    if(/FROM dbo\.EMSetPriceHD/.test(text))return {recordset:[{SetPriceID:8,ListNo:1,GoodId:12,BeginDate:'2026-01-01',EndDate:'2026-12-31',BasePrice:10000,DatabaseName:'uat',ServerName:'server'}]};
    if(/SELECT Id,Decision,ActorPrimaryId/.test(text))return {recordset:state.approval?[state.approval]:[]};
    if(/INSERT wf\.RebatePriceApprovalEvidence/.test(text)){state.approval={Id:7,Decision:'APPROVED',DecisionFingerprint:p.fingerprint,
      ActorPrimaryId:p.actorPrimary,EffectivePrimaryId:p.effectivePrimary,ActorBusinessId:p.actorBusiness,EffectiveBusinessId:p.effectiveBusiness,Reason:p.reason};return {recordset:[{Id:7}]};}
    if(/SELECT Id,Decision FROM wf\.RebatePriceApprovalEvidence/.test(text))return {recordset:state.approval?[state.approval]:[]};
    if(/UPDATE wf\.SalesOrderLine/.test(text)){state.invoicePrice=Number(p.invoice);return {rowsAffected:[1]};}
    if(/SELECT h.SOID,h.DocuType/.test(text))return {recordset:[{SOID:52,DocuType:'103',SaleDate:draft.SaleDate,ListNo:1,GoodID:12,GoodQty2:2,
      GoodPrice2:state.invoicePrice,DatabaseName:'uat',ServerName:'server'}]};
    if(/SELECT DecisionFingerprint,ApprovalEvidenceId/.test(text))return {recordset:[]};
    if(/INSERT INTO wf\.RebateBookingPriceSnapshot/.test(text)){state.snapshot=p;return {rowsAffected:[1]};}
    if(/SELECT h.SOID AS DeliveryId/.test(text)){
      const s=state.snapshot;return {recordset:[{DeliveryId:77,DeliveryCustId:9,DeliveryLineNo:1,DeliveryGoodId:12,DeliveryQty:2,DeliveryPrice:state.deliveryPrice,DeliveryUnitId:3,
        BookingId:52,BookingCustId:9,BookingStatus:'Y',BookingDate:draft.SaleDate,BookingLineNo:1,BookingGoodId:12,BookingQty:2,BookingPrice:state.invoicePrice,BookingUnitId:3,
        DatabaseName:'uat',ServerName:'server',DraftId:s.draftId,DocumentRevision:s.revision,GoodId:s.goodId,SaleDate:s.saleDate,SourceServer:s.server,SourceDatabase:s.database,
        SetPriceId:s.setPriceId,SetPriceListNo:s.priceListNo,PriceBegin:s.priceBegin,PriceEnd:s.priceEnd,BasePrice:s.base,SellingPrice:s.selling,InvoicePrice:s.invoice,
        QuantityTon:s.quantity,IsCashDiscount:s.isCash?1:0,RebatePerTon:s.rebate,TotalRebate:s.total,RequiresManagerApproval:s.needsApproval?1:0,
        ApprovalEvidenceId:s.approvalId,DecisionFingerprint:s.fingerprint,ApprovalDecision:state.approval.Decision,ApprovalFingerprint:state.approval.DecisionFingerprint}]};
    }
    if(/SELECT \* FROM wf\.RebateShipmentAccrual/.test(text))return {recordset:state.ledger.filter(r=>!p.accrualId||r.Id===p.accrualId)};
    if(/AS DeliveryTon/.test(text))return {recordset:[{DeliveryTon:'0.000',BookingTon:'0.000'}]};
    if(/INSERT wf\.RebateShipmentAccrual/.test(text)){state.ledger.push({Id:5,Generation:p.generation,EvidenceId:p.evidenceId,SourceSOID:p.sourceSOID,
      SourceListNo:p.sourceListNo,CouponId:p.couponId,GoodId:p.goodId,CustId:p.custId,PlanId:null,BookingSOID:p.bookingId,BookingLineNo:p.bookingLineNo,
      QuantityTon:p.quantity,ListPricePerTon:p.listPrice,NetPricePerTon:p.netPrice,RebatePerTon:p.rate,AmountBaht:p.amount,OccurredAtUtc:p.occurred});return {recordset:[{Id:5}]};}
    if(/SET ANSI_NULLS ON/.test(text))return {};
    if(/SELECT a.CustId,e.RedemptionId/.test(text))return {recordset:[{CustId:9,RedemptionId:10,RedemptionListNo:1}]};
    if(/sp_getapplock/.test(text))return {recordset:[{LockResult:0}]};
    if(/FROM wf\.RebateClaim WITH/.test(text))return {recordset:[{Id:p.documentId,CustId:9,Status:'PENDING'}]};
    if(/FROM wf\.FertilizerTicketConversion WITH/.test(text))return {recordset:[{Id:p.documentId,CustId:9,Status:'ISSUED'}]};
    if(/SELECT Id,QuantityTon,AmountBaht,Status FROM wf\.RebateShipmentReservation/.test(text))return {recordset:[]};
    if(/SELECT COALESCE\(SUM\(QuantityTon\)/.test(text))return {recordset:[{QuantityTon:state.reservations.reduce((n,r)=>n+Number(r.quantity),0).toFixed(3),AmountBaht:state.reservations.reduce((n,r)=>n+Number(r.amount),0).toFixed(2)}]};
    if(/INSERT wf\.RebateShipmentReservation/.test(text)){state.reservations.push(p);return {recordset:[{Id:state.reservations.length}]};}
    throw new Error('unexpected pipeline SQL');
  };
  const [preview]=await prepareRebateBookingDecisions(query,{draft,lines:[line],saleDate:draft.SaleDate});
  await reviewBookingPricing(query,{user:{sub:1,role:'MANAGER'},draftId:51,lineNo:1,expectedRevision:3,expectedFingerprint:preview.fingerprint,reason:'approved',windowStartUtc:new Date('2025-12-31T17:00:00Z')},
    {getVisibleScope:async()=>({all:true,userIds:[],empIds:[]})});
  const decisions=await stageBookingInvoicePrices(query,{draft,lines:[line],saleDate:draft.SaleDate});
  await finalizeBookingPriceSnapshots(query,{bookingId:52,decisions});
  const overrides={participantFence:async()=>{},lockShipment:async()=>shipment};
  await accrueVerifiedShipment(query,epoch,{redemptionId:10,listNo:1},overrides);
  assert.equal(state.ledger[0].AmountBaht,'125.00');
  await reserveShipmentAccrual(query,epoch,{accrualId:5,custId:9,documentId:1,documentType:'CLAIM',quantityTon:'0.200'},overrides);
  await reserveShipmentAccrual(query,epoch,{accrualId:5,custId:9,documentId:2,documentType:'CONVERSION',quantityTon:'0.300'},overrides);
  await assert.rejects(reserveShipmentAccrual(query,epoch,{accrualId:5,custId:9,documentId:3,documentType:'CLAIM',quantityTon:'0.001'},overrides),{code:'REBATE_RESERVATION_INSUFFICIENT'});
  state.deliveryPrice=9999;
  await assert.rejects(reserveShipmentAccrual(query,epoch,{accrualId:5,custId:9,documentId:4,documentType:'CLAIM',quantityTon:'0.001'},overrides),{code:'REBATE_BOOKING_SOURCE_CHANGED'});
});
