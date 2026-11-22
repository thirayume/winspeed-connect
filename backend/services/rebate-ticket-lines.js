'use strict';
// Owner, 22 Nov 2026: a Rebate ticket is used inside a normal bill. Each ticket line is the ticket's goods at price 0
// (WinSpeed's 202 and 107 never carry a bill discount, so a price-0 line keeps the receivable right). A bill may
// hold several ticket lines. The tickets are deducted when the 103 is issued (RESERVED), given back when that 103 is
// cancelled before its 116 (RELEASED), and the deduction becomes final once the line's 116 is cut (FINAL).
// The receipt and its allocations are immutable (migration 209); wf.RebateTicketReceiptState (migration 258) holds
// the state. A receipt without a state row was written by the earlier redeem route and is final.
const crypto = require('crypto');
const { hasPermission } = require('./role-capabilities');
const { applyTicketRedemption } = require('./rebate-ticket-redemption-transaction');
const { verifyTicketTreatmentShape } = require('./rebate-ticket-financial-verifier');
const { ticketUnits, ticketQuantity } = require('./rebate-ticket-redemption-plan');
const { resolveRebateBasePrice, resolveRebateCustomer } = require('./rebate-price-authority');

const PARTICIPANT_LOCK = 'WF_REBATE_PARTICIPANT_V1';
const USABLE = ['ACTIVE', 'PARTIALLY_USED', 'EXTENDED_ACTIVE'];
function fail(code, message, status = 409) {
  throw Object.assign(new Error(message || code), { code, status });
}
const isTicket = line => Boolean(line?.IsRebateTicket || line?.isRebateTicket);
const bangkokToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

// A ticket line holds whole 50 kg bags (20 per ton) and no other attribute.
function assertTicketLineShape(line) {
  let units;
  try { units = ticketUnits(String(Number(line.qtyTon ?? line.QtyTon))); } catch { units = 0n; }
  if (units <= 0n || units % 500n !== 0n) fail('REBATE_TICKET_LINE_INVALID', 'จำนวนตั๋ว Rebate ต้องเป็นกระสอบเต็ม (0.05 ตัน)', 400);
  if (Number(line.pricePerTon ?? line.PricePerTon) !== 0 || (line.rebatePricingMode ?? line.RebatePricingMode) ||
      line.isGiveaway || line.IsGiveaway || line.isCouponDrawn || line.IsCouponDrawn || line.couponReservationId ||
      line.CouponReservationId || line.refCouponDocuNo || line.RefCouponDocuNo || line.isControlTicketDrawn ||
      line.IsControlTicketDrawn || line.refControlTicketNo || line.RefControlTicketNo)
    fail('REBATE_TICKET_LINE_INVALID', 'บรรทัดตั๋ว Rebate ต้องเป็นราคา 0 และไม่ใช่ของแถมหรือตั๋วปุ๋ย WinSpeed', 400);
  const goodId = Number(line.goodId ?? line.GoodId);
  if (!Number.isSafeInteger(goodId) || goodId <= 0) fail('REBATE_TICKET_LINE_INVALID', 'ไม่พบสินค้าของตั๋ว Rebate', 400);
  return { goodId, units };
}

/** Usable tickets of a customer on a date, oldest expiry first (the order a ticket line draws them). */
async function listUsableTickets(query, { custId, asOfDate = bangkokToday(), goodId = null }) {
  const rows = (await query(`SELECT Id,TicketNo,GoodId,GoodCode,GoodName,
      CONVERT(varchar(40),CAST(IssuedTonnage AS decimal(19,4))) AS IssuedTonnage,
      CONVERT(varchar(40),CAST(RemainingTonnage AS decimal(19,4))) AS RemainingTonnage,
      CONVERT(varchar(10),IssuedDate,23) AS IssuedDate,
      CONVERT(varchar(10),ISNULL(ExtendedExpiryDate,ExpiryDate),23) AS ExpiryDate,Status
    FROM wf.FertilizerTicket WITH (NOLOCK)
    WHERE CustId=@custId AND Status IN ('ACTIVE','PARTIALLY_USED','EXTENDED_ACTIVE') AND RemainingTonnage>0
      AND IssuedDate<=CAST(@asOfDate AS date) AND ISNULL(ExtendedExpiryDate,ExpiryDate)>=CAST(@asOfDate AS date)
      ${goodId ? 'AND GoodId=@goodId' : ''}
    ORDER BY ISNULL(ExtendedExpiryDate,ExpiryDate),IssuedDate,Id`, { custId: Number(custId), asOfDate, goodId })).recordset || [];
  return rows.map(r => ({ id: Number(r.Id), ticketNo: r.TicketNo, goodId: Number(r.GoodId), goodCode: r.GoodCode,
    goodName: r.GoodName, issuedTon: r.IssuedTonnage, remainingTon: r.RemainingTonnage, issuedDate: r.IssuedDate,
    expiryDate: r.ExpiryDate, status: r.Status }));
}

/**
 * Checked when a draft is saved: the ticket lines are well formed, the user may use tickets, the Rebate Pool is on
 * and the customer holds enough usable tickets for each goods. Nothing is reserved until the 103 is issued.
 */
async function validateDraftTicketLines(query, { user, custId, lines, env = process.env, asOfDate = bangkokToday() }) {
  const ticketLines = (lines || []).filter(isTicket);
  if (!ticketLines.length) return [];
  if (env.REBATE_POOL_103_ENABLED !== 'true') fail('REBATE_TICKET_UNAVAILABLE', 'ใช้ตั๋ว Rebate ได้เมื่อเปิดระบบ Rebate Pool', 409);
  if (!hasPermission(user, 'rebate.ticket-redeem')) fail('TICKET_PERMISSION_REQUIRED', 'บทบาทนี้ไม่มีสิทธิ์ใช้ตั๋ว Rebate', 403);
  const customer = await resolveRebateCustomer(query, custId);
  if (!customer) fail('REBATE_TICKET_CUSTOMER_REQUIRED', 'กรุณาเลือกลูกค้าก่อนใช้ตั๋ว Rebate', 400);
  const wanted = new Map();
  for (const line of ticketLines) {
    const { goodId, units } = assertTicketLineShape(line);
    wanted.set(goodId, (wanted.get(goodId) || 0n) + units);
  }
  for (const [goodId, units] of wanted) {
    const tickets = await listUsableTickets(query, { custId: customer, asOfDate, goodId });
    const available = tickets.reduce((sum, t) => sum + ticketUnits(t.remainingTon), 0n);
    if (available < units)
      fail('INSUFFICIENT_TICKET_BALANCE', `ตั๋ว Rebate ของสินค้านี้เหลือ ${ticketQuantity(available)} ตัน ไม่พอ ${ticketQuantity(units)} ตัน`, 409);
  }
  return ticketLines;
}

// Shared lock on the Rebate reset participant (the reset takes it exclusively) and a READY participant row.
async function acquireParticipantReady(query, env = process.env) {
  const kind = String(env.ONPREM_TARGET_KIND || '').trim().toLowerCase();
  const lock = (await query(`DECLARE @result int;
    EXEC @result=sp_getapplock @Resource=@resource,@LockMode='Shared',@LockOwner='Transaction',@LockTimeout=10000;
    SELECT @result AS LockResult;`, { resource: PARTICIPANT_LOCK })).recordset?.[0]?.LockResult;
  if (!(Number(lock) >= 0)) fail('REBATE_RESET_PARTICIPANT_LOCK_UNAVAILABLE', 'ระบบ Rebate กำลังทำงานอื่น กรุณาลองใหม่', 503);
  const row = (await query(`SELECT Phase FROM wf.RebateResetParticipant WITH (HOLDLOCK) WHERE EnvironmentKind=@kind`,
    { kind })).recordset?.[0];
  if (!row || row.Phase !== 'READY') fail('REBATE_RESET_PARTICIPANT_UNAVAILABLE', 'ระบบ Rebate ยังไม่พร้อม กรุณาลองใหม่', 503);
  return { kind };
}

/**
 * Inside the confirm transaction, right after wf.sp_ConfirmSalesOrder wrote the 103: deduct the tickets of every
 * ticket line (RESERVED). The 103 line must be the ticket's goods at price 0 for the whole ticket quantity.
 * `lines` are the draft lines read before the procedure ran (it deletes them); the 103 numbers its sale lines
 * 1..n in draft order, giveaways excluded (migration 165).
 */
async function reserveTicketLinesAtConfirm(query, { user, bookingId, draft, lines, startDate, env = process.env, deps = {} }) {
  const saleLines = (lines || []).filter(l => !(l.IsGiveaway || l.isGiveaway))
    .sort((a, b) => Number(a.LineNum) - Number(b.LineNum));
  const ticketLines = saleLines.map((line, i) => ({ line, listNo: i + 1 })).filter(x => isTicket(x.line));
  if (!ticketLines.length) return [];
  if (env.REBATE_POOL_103_ENABLED !== 'true') fail('REBATE_TICKET_UNAVAILABLE', 'ใช้ตั๋ว Rebate ได้เมื่อเปิดระบบ Rebate Pool', 409);
  const ready = await (deps.participantReady || acquireParticipantReady)(query, env);
  const custId = await (deps.resolveCustomer || resolveRebateCustomer)(query, draft.CustId);
  const today = deps.today || bangkokToday();
  const results = [];
  for (const { line, listNo } of ticketLines) {
    const { goodId, units } = assertTicketLineShape(line);
    const requestId = (deps.uuid || crypto.randomUUID)();
    const receipt = await (deps.apply || applyTicketRedemption)(query, {
      user, bookingId: Number(bookingId), lineNo: listNo, requestedTonnage: ticketQuantity(units),
      requestId, treatment: 'ZERO', startDate,
    }, {
      epoch: ready, participantFence: async () => ready,
      verifyFinancialTreatment: deps.verifyShape || verifyTicketTreatmentShape,
      ...(deps.assertAging ? { assertAging: deps.assertAging } : {}),
      ...(deps.lockContext ? { lockContext: deps.lockContext } : {}),
    });
    if (receipt.replayed) fail('TICKET_REDEMPTION_CONFLICT', 'บรรทัดตั๋ว Rebate นี้ถูกบันทึกไว้แล้ว');
    // The value shown to people: the announced price on the bill's date, chosen as for every other line.
    let price = null;
    try {
      const base = await (deps.basePrice || resolveRebateBasePrice)(query, { goodId, saleDate: today, custId });
      price = Number(base.basePrice) > 0 ? Number(base.basePrice) : null;
    } catch { price = null; }
    const amount = price == null ? null : Math.round(Number(ticketQuantity(units)) * price * 100) / 100;
    await query(`INSERT wf.RebateTicketReceiptState(ReceiptId,Status,ReferencePricePerTon,ReferenceAmount,Reason)
      VALUES(@receiptId,'RESERVED',@price,@amount,@reason)`,
    { receiptId: receipt.id, price, amount, reason: `ออกใบสั่งจอง ${draft.WfRef || bookingId} บรรทัด ${listNo}` });
    results.push({ receiptId: receipt.id, lineNo: listNo, goodId, quantityTon: ticketQuantity(units),
      allocations: receipt.allocations, referencePrice: price, referenceAmount: amount });
  }
  return results;
}

function nextTicketStatus(ticket, remainingAfter, today) {
  const expiry = String(ticket.ExpiryDate || '').slice(0, 10);
  if (expiry && expiry < today) return 'EXPIRED';
  if (remainingAfter === ticketUnits(ticket.IssuedTonnage)) return ticket.ExtendedExpiryDate ? 'EXTENDED_ACTIVE' : 'ACTIVE';
  return 'PARTIALLY_USED';
}

// Give one RESERVED receipt's tickets back. Caller owns the transaction and has locked the state row.
async function releaseReceipt(query, { receiptId, bookingId, docuNo, reason, userId = null, today = bangkokToday() }) {
  const allocations = (await query(`SELECT TicketId,Ordinal,CONVERT(varchar(40),CAST(QuantityTon AS decimal(19,4))) AS QuantityTon
    FROM wf.RebateTicketRedemptionAllocation WITH (UPDLOCK,HOLDLOCK) WHERE ReceiptId=@receiptId ORDER BY Ordinal`,
  { receiptId })).recordset || [];
  if (!allocations.length) fail('TICKET_REDEMPTION_RECEIPT_INVALID', 'ไม่พบรายการตั๋วของใบรับ');
  for (const a of allocations) {
    const ticket = (await query(`SELECT Id,Status,CONVERT(varchar(40),CAST(IssuedTonnage AS decimal(19,4))) AS IssuedTonnage,
        CONVERT(varchar(40),CAST(RemainingTonnage AS decimal(19,4))) AS RemainingTonnage,
        CONVERT(varchar(10),ISNULL(ExtendedExpiryDate,ExpiryDate),23) AS ExpiryDate,ExtendedExpiryDate
      FROM wf.FertilizerTicket WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id`, { id: Number(a.TicketId) })).recordset?.[0];
    if (!ticket) fail('TICKET_REDEMPTION_RECEIPT_INVALID', 'ไม่พบตั๋วที่ต้องคืน');
    const before = ticketUnits(ticket.RemainingTonnage), qty = ticketUnits(a.QuantityTon), after = before + qty;
    if (after > ticketUnits(ticket.IssuedTonnage)) fail('TICKET_REDEMPTION_RECEIPT_INVALID', 'ยอดตั๋วที่คืนเกินยอดที่ออก');
    const status = nextTicketStatus(ticket, after, today);
    const update = await query(`UPDATE wf.FertilizerTicket SET RemainingTonnage=CAST(@after AS decimal(14,4)),Status=@status,
        UpdatedAt=DATEADD(hour,7,GETUTCDATE())
      WHERE Id=@id AND RemainingTonnage=CAST(@before AS decimal(14,4))`,
    { id: Number(a.TicketId), before: ticketQuantity(before), after: ticketQuantity(after), status });
    if (Number(update.rowsAffected?.[0]) !== 1) fail('TICKET_REDEMPTION_STALE', 'ยอดตั๋วเปลี่ยน กรุณาลองใหม่');
    await query(`INSERT wf.TicketRedemptionHistory(TicketId,SoId,DocNo,RedemptionOrder,RedeemedTonnage,
        RemainingBefore,RemainingAfter,RedeemedByUserId,Note)
      VALUES(@ticketId,@bookingId,@docuNo,@ordinal,CAST(@qty AS decimal(14,4)),CAST(@before AS decimal(14,4)),
        CAST(@after AS decimal(14,4)),@userId,@note)`,
    { ticketId: Number(a.TicketId), bookingId: Number(bookingId), docuNo: docuNo || null, ordinal: Number(a.Ordinal),
      qty: `-${ticketQuantity(qty)}`, before: ticketQuantity(before), after: ticketQuantity(after), userId,
      note: `คืนตั๋ว Rebate (ใบรับ ${receiptId}): ${reason}` });
  }
  const state = await query(`UPDATE wf.RebateTicketReceiptState SET Status='RELEASED',Reason=@reason,
      Revision=Revision+1,ChangedAtUtc=GETUTCDATE() WHERE ReceiptId=@receiptId AND Status='RESERVED'`,
  { receiptId, reason: String(reason).slice(0, 200) });
  if (Number(state.rowsAffected?.[0]) !== 1) fail('TICKET_REDEMPTION_STALE', 'สถานะตั๋วเปลี่ยน กรุณาลองใหม่');
  return allocations.length;
}

/**
 * A Sale-App cancel of an issued 103: give RESERVED tickets back in the caller's transaction. A final deduction
 * (FINAL, or a receipt from the earlier redeem route) still blocks the cancel, as before.
 */
async function releaseReservedTicketsForBooking(query, { bookingId, docuNo = null, reason, userId = null, env = process.env }) {
  const receipts = (await query(`SELECT r.Id,st.Status FROM wf.RebateTicketRedemptionReceipt r WITH (UPDLOCK,HOLDLOCK)
    LEFT JOIN wf.RebateTicketReceiptState st WITH (UPDLOCK,HOLDLOCK) ON st.ReceiptId=r.Id
    WHERE r.BookingSOID=@bookingId ORDER BY r.Id`, { bookingId: Number(bookingId) })).recordset || [];
  if (!receipts.length) return 0;
  if (receipts.some(r => r.Status == null || r.Status === 'FINAL'))
    fail('TICKET_REDEMPTION_LINKED', 'บิลนี้ตัดตั๋ว Rebate เป็นที่สุดแล้ว (มีใบตัดตั๋ว 116) กรุณาติดต่อผู้ดูแลก่อนแก้ไขหรือยกเลิก');
  const reserved = receipts.filter(r => r.Status === 'RESERVED');
  if (reserved.length) await acquireParticipantReady(query, env);
  for (const r of reserved)
    await releaseReceipt(query, { receiptId: Number(r.Id), bookingId, docuNo, reason, userId });
  return reserved.length;
}

const money4 = v => { try { return ticketUnits(String(v)); } catch { return null; } };

/**
 * One RESERVED receipt against WinSpeed, inside its own transaction:
 *  - the 103 is gone or cancelled            -> RELEASED (tickets back)
 *  - the line's 116 cut the whole ticket qty  -> FINAL
 *  - the 103 or 104 line no longer matches    -> a REBATE_TICKET_DOCUMENT_MISMATCH incident; the receipt stays RESERVED
 * Returns { receiptId, outcome }.
 */
async function settleReceipt(query, receiptId, { recordIncident, today = bangkokToday() } = {}) {
  const row = (await query(`SELECT st.ReceiptId,st.Status,r.BookingSOID,r.BookingLineNo,r.CustId,r.GoodId,
      CONVERT(varchar(40),CAST(r.QuantityTon AS decimal(19,4))) AS Qty,
      h.SOID AS HeadSOID,RTRIM(h.DocuStatus) AS HeadStatus,RTRIM(h.DocuNo) AS DocuNo,h.CustID AS HeadCust,
      d.ListNo AS LineListNo,d.GoodID AS LineGood,CONVERT(varchar(40),CAST(d.GoodQty2 AS decimal(19,4))) AS LineQty,
      CONVERT(varchar(40),CAST(d.GoodPrice2 AS decimal(19,4))) AS LinePrice,
      CONVERT(varchar(40),CAST(d.GoodAmnt AS decimal(19,4))) AS LineAmount,RTRIM(d.FreeFlag) AS LineFree
    FROM wf.RebateTicketReceiptState st WITH (UPDLOCK,HOLDLOCK)
    JOIN wf.RebateTicketRedemptionReceipt r ON r.Id=st.ReceiptId
    LEFT JOIN dbo.SOHD h WITH (UPDLOCK,HOLDLOCK) ON h.SOID=r.BookingSOID AND h.DocuType=103
    LEFT JOIN dbo.SODT d WITH (UPDLOCK,HOLDLOCK) ON d.SOID=h.SOID AND d.DocuType=103 AND d.ListNo=r.BookingLineNo
    WHERE st.ReceiptId=@receiptId`, { receiptId })).recordset?.[0];
  if (!row || row.Status !== 'RESERVED') return { receiptId, outcome: 'SKIPPED' };
  const bookingId = Number(row.BookingSOID), lineNo = Number(row.BookingLineNo), qty = ticketUnits(row.Qty);
  if (row.HeadSOID == null || String(row.HeadStatus || '').toUpperCase() === 'C') {
    await releaseReceipt(query, { receiptId, bookingId, docuNo: row.DocuNo, today,
      reason: row.HeadSOID == null ? 'ไม่พบใบสั่งจองใน WinSpeed' : 'ใบสั่งจองถูกยกเลิก' });
    return { receiptId, outcome: 'RELEASED' };
  }
  const mismatch = async (reason, detail) => {
    if (recordIncident) await recordIncident({ key: `REBATE_TICKET_DOCUMENT_MISMATCH:${receiptId}:${reason}`,
      type: 'REBATE_TICKET_DOCUMENT_MISMATCH', soid: bookingId, docuNo: row.DocuNo,
      detail: `บรรทัด ${lineNo} ตั๋ว Rebate ${ticketQuantity(qty)} ตัน: ${detail}` });
    return { receiptId, outcome: 'MISMATCH', reason };
  };
  if (row.LineListNo == null) return mismatch('BOOKING_LINE_MISSING', 'ไม่พบบรรทัดในใบสั่งจอง WinSpeed');
  if (Number(row.LineGood) !== Number(row.GoodId) || money4(row.LineQty) !== qty || money4(row.LinePrice) !== 0n ||
      money4(row.LineAmount) !== 0n || String(row.LineFree || '').toUpperCase() === 'Y' || Number(row.HeadCust) !== Number(row.CustId))
    return mismatch('BOOKING_LINE_CHANGED', `ใบสั่งจองถูกแก้ใน WinSpeed (สินค้า ${row.LineGood} ${row.LineQty} ตัน ราคา ${row.LinePrice})`);
  const deliveries = (await query(`SELECT s.SOID,RTRIM(s.DocuNo) AS DocuNo,l.ListNo,l.GoodID,
      CONVERT(varchar(40),CAST(l.GoodQty2 AS decimal(19,4))) AS Qty,CONVERT(varchar(40),CAST(l.GoodPrice2 AS decimal(19,4))) AS Price,
      CONVERT(varchar(40),CAST(l.GoodAmnt AS decimal(19,4))) AS Amount,c.CouponID,
      CONVERT(varchar(40),CAST(c.GoodQty AS decimal(19,4))) AS CouponQty,CONVERT(varchar(40),CAST(c.RemaQty AS decimal(19,4))) AS CouponRema
    FROM dbo.SODT l WITH (UPDLOCK,HOLDLOCK)
    JOIN dbo.SOHD s WITH (UPDLOCK,HOLDLOCK) ON s.SOID=l.SOID AND s.DocuType=104 AND ISNULL(s.DocuStatus,'')<>'C'
    LEFT JOIN dbo.WFCoupon c WITH (UPDLOCK,HOLDLOCK) ON c.DocuID=s.SOID AND c.Docutype=104 AND c.RefListno=l.ListNo
    WHERE l.DocuType=104 AND l.RefSOID=@bookingId AND l.RefListNo=@lineNo`, { bookingId, lineNo })).recordset || [];
  if (!deliveries.length) return { receiptId, outcome: 'WAITING_104' };
  if (deliveries.length !== 1) return mismatch('DELIVERY_SPLIT', `ใบสั่งขาย (104) แยก ${deliveries.length} ใบ บรรทัดตั๋วต้องอยู่ใน 104 ใบเดียวเต็มจำนวน`);
  const dl = deliveries[0];
  if (Number(dl.GoodID) !== Number(row.GoodId) || money4(dl.Qty) !== qty || money4(dl.Price) !== 0n || money4(dl.Amount) !== 0n)
    return mismatch('DELIVERY_LINE_CHANGED', `ใบสั่งขาย ${dl.DocuNo} ไม่ใช่สินค้าตั๋วราคา 0 เต็มจำนวน (${dl.Qty} ตัน ราคา ${dl.Price})`);
  if (dl.CouponID == null) return { receiptId, outcome: 'WAITING_COUPON' };
  if (money4(dl.CouponQty) !== qty) return mismatch('COUPON_QTY_CHANGED', `ตั๋ว 104 ${dl.CouponQty} ตัน ไม่เท่ากับตั๋ว Rebate`);
  const cuts = (await query(`SELECT h.RedemtionID,RTRIM(h.DocuNo) AS DocuNo,CONVERT(varchar(40),CAST(x.GoodQty AS decimal(19,4))) AS Qty
    FROM dbo.WFRedemtionDT x WITH (UPDLOCK,HOLDLOCK)
    JOIN dbo.WFRedemtionHD h WITH (UPDLOCK,HOLDLOCK) ON h.RedemtionID=x.RedemtionID AND h.DocuType=116 AND ISNULL(h.DocuStatus,'')<>'C'
    WHERE x.CouponID=@coupon ORDER BY h.RedemtionID`, { coupon: Number(dl.CouponID) })).recordset || [];
  const cut = cuts.reduce((s, c) => s + (money4(c.Qty) || 0n), 0n);
  if (!cuts.length || cut < qty || money4(dl.CouponRema) !== 0n) return { receiptId, outcome: 'WAITING_116' };
  const last = cuts[cuts.length - 1];
  const done = await query(`UPDATE wf.RebateTicketReceiptState SET Status='FINAL',FinalRedemptionId=@id,FinalRedemptionNo=@no,
      Reason=@reason,Revision=Revision+1,ChangedAtUtc=GETUTCDATE() WHERE ReceiptId=@receiptId AND Status='RESERVED'`,
  { receiptId, id: Number(last.RedemtionID), no: last.DocuNo, reason: `ตัดตั๋ว 116 ${last.DocuNo}` });
  if (Number(done.rowsAffected?.[0]) !== 1) fail('TICKET_REDEMPTION_STALE', 'สถานะตั๋วเปลี่ยน');
  return { receiptId, outcome: 'FINAL', redemptionNo: last.DocuNo };
}

/** Worker step: settle up to `limit` RESERVED receipts, each in its own transaction. */
async function settleReservedTickets({ limit = 50, runTx, listQuery, recordIncident, env = process.env } = {}) {
  const ids = ((await listQuery(`SELECT TOP (@limit) ReceiptId FROM wf.RebateTicketReceiptState WITH (NOLOCK)
    WHERE Status='RESERVED' ORDER BY ChangedAtUtc,ReceiptId`, { limit })).recordset || []).map(r => Number(r.ReceiptId));
  const results = [];
  for (const id of ids) {
    results.push(await runTx(async query => {
      await acquireParticipantReady(query, env);
      return settleReceipt(query, id, { recordIncident });
    }));
  }
  return results;
}

module.exports = { isTicket, assertTicketLineShape, listUsableTickets, validateDraftTicketLines,
  reserveTicketLinesAtConfirm, releaseReservedTicketsForBooking, releaseReceipt, settleReceipt, settleReservedTickets,
  acquireParticipantReady, nextTicketStatus };
