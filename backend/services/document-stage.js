'use strict';
const { isValidStartDate } = require('./data-window');
/**
 * Where a bill stands in WinSpeed's own document chain.
 *
 * The bill list shows a workflow status (waiting for delivery, loaded, weighed out). That status says
 * nothing about which WinSpeed documents exist, and every sales order (104) reads "104 issued" whether
 * its goods were hauled and invoiced or not. Accounting reads the chain by document instead
 * (their answers of 12 November 2026), so the list carries this second fact:
 *
 *   103 booking          waiting for approval, or approved (it then has an AI number)
 *   104 sales order      WinSpeed issues the fertilizer tickets (C for book I, D for book K) and the
 *                        receivable document 202 with it
 *   116 ticket cut       one row per haul; its number is the warehouse movement slip number
 *   107 delivery note    Post Invoice, book J for I and N for K, dated the day of the haul
 *
 * Read-only. Counts and tonnes only: no document number other than the bill's own leaves this module.
 *
 * WinSpeed has no index on WFCoupon.DocuID or WFRedemtionDT.CouponID, and a single joined query over
 * them took minutes on the real data. The read is therefore four short steps, each a primary-key seek,
 * the one index that exists (SOInvDT.RefID) or one pass over a single table.
 */

const EPSILON = 0.00005;
const MAX_IDS = 200;
const CHUNK = 500;

const STAGE = Object.freeze({
  DRAFT: 'DRAFT',
  BOOKING_WAITING_APPROVAL: 'BOOKING_WAITING_APPROVAL',
  BOOKING_APPROVED: 'BOOKING_APPROVED',
  BOOKING_ORDERED: 'BOOKING_ORDERED',
  ORDER_ISSUED: 'ORDER_ISSUED',
  TICKET_ISSUED: 'TICKET_ISSUED',
  TICKET_CLOSED_WITHOUT_CUT: 'TICKET_CLOSED_WITHOUT_CUT',
  CUT_PARTLY: 'CUT_PARTLY',
  CUT_WAITING_INVOICE: 'CUT_WAITING_INVOICE',
  INVOICED_PARTLY: 'INVOICED_PARTLY',
  INVOICED: 'INVOICED',
  CANCELLED: 'CANCELLED',
});

function tonnes(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;
}

/** The stage of one native row, from the counts `loadDocumentStageFacts` reads. */
function deriveDocumentStage(fact) {
  if (!fact) return null;
  // Preserve historic ticket balances elsewhere, but do not expose a stage
  // that could be inferred from an old or undated linked movement/invoice.
  if (Number(fact.HasOutsideWindow || 0) > 0) return null;
  const docuType = Number(fact.DocuType);
  const docuStatus = String(fact.DocuStatus || '').trim().toUpperCase();
  if (docuType !== 103 && docuType !== 104) return null;
  if (docuStatus === 'C') return { code: STAGE.CANCELLED, docType: docuType };

  if (docuType === 103) {
    // WinSpeed marks a booking Y once a sales order has taken it (P when only part of it).
    if (docuStatus === 'Y' || docuStatus === 'P') {
      const deliveries = (fact.Deliveries || []).map(deriveDocumentStage);
      if (deliveries.includes(null)) return null;
      if (deliveries.some(stage => stage.cutQty > 0)) {
        const quantities = Object.fromEntries(['ticketQty', 'ticketRemaining', 'cutQty', 'invoicedQty']
          .map(field => [field, tonnes(deliveries.reduce((sum, stage) => sum + (stage[field] || 0), 0))]));
        const invoiceBook = deliveries.find(stage => stage.invoiceBook)?.invoiceBook ?? null;
        const allInvoiced = docuStatus === 'Y' && deliveries.every(stage => stage.code === STAGE.INVOICED);
        if (quantities.invoicedQty > EPSILON) {
          return { code: allInvoiced ? STAGE.INVOICED : STAGE.INVOICED_PARTLY, docType: 107, ...quantities, invoiceBook };
        }
        const allHauled = docuStatus === 'Y' && deliveries.every(stage => stage.code === STAGE.CUT_WAITING_INVOICE);
        return { code: allHauled ? STAGE.CUT_WAITING_INVOICE : STAGE.CUT_PARTLY, docType: 116, ...quantities, invoiceBook };
      }
      return { code: STAGE.BOOKING_ORDERED, docType: 104 };
    }
    const approved = String(fact.AppvFlag || '').trim().toUpperCase() === 'Y' && Number(fact.HasApproval) === 1;
    return { code: approved ? STAGE.BOOKING_APPROVED : STAGE.BOOKING_WAITING_APPROVAL, docType: 103 };
  }

  const ticketQty = tonnes(fact.TicketQty);
  const ticketRemaining = tonnes(fact.TicketRemaining);
  const cutQty = tonnes(fact.CutQty);
  const invoicedQty = tonnes(fact.InvoicedQty);
  const book = String(fact.InvoiceBook || '').trim().toUpperCase();
  const quantities = { ticketQty, ticketRemaining, cutQty, invoicedQty, invoiceBook: /^[A-Z]$/.test(book) ? book : null };

  if (Number(fact.TicketCount || 0) <= 0) return { code: STAGE.ORDER_ISSUED, docType: 104, ...quantities };
  if (cutQty <= EPSILON) {
    // Tickets with nothing left and no cut on record were closed another way (a ticket return, for one).
    const untouched = ticketRemaining >= ticketQty - EPSILON;
    return { code: untouched ? STAGE.TICKET_ISSUED : STAGE.TICKET_CLOSED_WITHOUT_CUT, docType: 104, ...quantities };
  }
  const hauledAll = ticketRemaining <= EPSILON;
  if (invoicedQty <= EPSILON) {
    return { code: hauledAll ? STAGE.CUT_WAITING_INVOICE : STAGE.CUT_PARTLY, docType: 116, ...quantities };
  }
  const invoicedAll = Math.abs(invoicedQty - cutQty) <= EPSILON && hauledAll;
  return { code: invoicedAll ? STAGE.INVOICED : STAGE.INVOICED_PARTLY, docType: 107, ...quantities };
}

function safeIds(ids, limit = MAX_IDS) {
  const seen = new Set();
  for (const raw of ids || []) {
    const text = String(raw == null ? '' : raw).trim();
    if (!/^[0-9]{1,10}$/.test(text)) continue;
    const n = Number(text);
    if (n > 0 && n <= 2147483647) seen.add(n);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

function chunks(list, size = CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function intInputs(sql, prefix, list) {
  return {
    names: list.map((_, i) => `@${prefix}${i}`).join(','),
    inputs: Object.fromEntries(list.map((id, i) => [`${prefix}${i}`, { type: sql.Int, value: id }])),
  };
}

const headSql = names => `
  SELECT h.SOID, h.DocuType, RTRIM(h.DocuNo) AS DocuNo, RTRIM(ISNULL(h.DocuStatus, '')) AS DocuStatus,
         RTRIM(ISNULL(h.AppvFlag, '')) AS AppvFlag,
         CASE WHEN NULLIF(RTRIM(ISNULL(h.AppvDocuNo, '')), '') IS NULL THEN 0 ELSE 1 END AS HasApproval
  FROM dbo.SOHD h WITH (NOLOCK)
  WHERE h.SOID IN (${names}) AND h.DocuType IN (103, 104) AND h.DocuDate >= @stageStartDate`;

// The sales list keeps the booking row for app-created sales. Follow the same
// approval reference as the native de-duplication, scoped to customer and branch.
const deliverySql = names => `
  SELECT b.SOID AS BookingId, d.SOID, d.DocuType, RTRIM(d.DocuNo) AS DocuNo, d.DocuStatus,
         CASE WHEN d.DocuDate IS NULL OR d.DocuDate < @stageStartDate THEN 1 ELSE 0 END AS HasOutsideWindow
  FROM dbo.SOHD b
  JOIN dbo.SOHD d ON d.DocuType = 104 AND ISNULL(d.DocuStatus, '') <> 'C'
    AND d.RefNo = COALESCE(NULLIF(RTRIM(b.AppvDocuNo), ''), b.DocuNo)
    AND d.CustID = b.CustID AND d.BrchID = b.BrchID
  WHERE b.SOID IN (${names}) AND b.DocuType = 103 AND b.DocuStatus IN ('Y', 'P')`;

const ticketSql = names => `
  SELECT c.CouponID, c.DocuID, c.GoodQty, c.RemaQty
  FROM dbo.WFCoupon c
  WHERE c.Docutype = 104 AND c.DocuID IN (${names})`;

// The range keeps the single pass over WFRedemtionDT cheap; the list keeps it exact.
// Use committed rows for the evidence that closes a sale. WinSpeed can group
// several cuts against the same invoice line, including across coupon batches.
const cutSql = names => `
  WITH cuts AS (
    SELECT rd.CouponID, rd.PostInv, rd.SOInvID, rd.SOListNo, SUM(rd.GoodQty) AS CutQty,
           MAX(CASE WHEN rh.DocuDate IS NULL OR rh.DocuDate < @stageStartDate THEN 1 ELSE 0 END) AS HasOutsideWindow
    FROM dbo.WFRedemtionDT rd
    JOIN dbo.WFRedemtionHD rh ON rh.RedemtionID = rd.RedemtionID
    WHERE rd.CouponID BETWEEN @cutLow AND @cutHigh AND rd.CouponID IN (${names})
      AND rh.DocuType = 116 AND ISNULL(rh.DocuStatus, '') <> 'C'
    GROUP BY rd.CouponID, rd.PostInv, rd.SOInvID, rd.SOListNo
  )
  SELECT c.*, i.RefID AS InvoiceOrderId, i.GoodQty2 AS InvoiceQty,
         LEFT(LTRIM(ih.DocuNo), 1) AS InvoiceBook
  FROM cuts c
  LEFT JOIN dbo.SOInvHD ih ON c.PostInv = 'Y' AND ih.SOInvID = c.SOInvID
    AND ih.DocuType = 107 AND ISNULL(ih.DocuStatus, '') <> 'C' AND ih.DocuDate >= @stageStartDate
  LEFT JOIN dbo.SOInvDT i ON i.SOInvID = ih.SOInvID AND i.ListNo = c.SOListNo AND i.DocuType = 107`;

const invoiceWindowSql = names => `
  SELECT i.RefID, MAX(CASE WHEN ih.DocuDate IS NULL OR ih.DocuDate < @stageStartDate THEN 1 ELSE 0 END) AS HasOutsideWindow
  FROM dbo.SOInvDT i
  JOIN dbo.SOInvHD ih ON ih.SOInvID = i.SOInvID
  WHERE i.RefID IN (${names}) AND i.Docutype = 107 AND ih.Docutype = 107 AND ISNULL(ih.DocuStatus, '') <> 'C'
  GROUP BY i.RefID`;

/** Map of SOID to the counts behind its stage, for native bookings and sales orders among `ids`. */
async function loadDocumentStageFacts(query, sql, ids, dataWindow) {
  if (!isValidStartDate(dataWindow?.businessDate)) throw Object.assign(new Error('DATA_WINDOW_UNAVAILABLE'), {code:'DATA_WINDOW_UNAVAILABLE'});
  const windowInput = { stageStartDate: { type: sql.Date, value: dataWindow.businessDate } };
  const list = safeIds(ids);
  const facts = new Map();
  if (!list.length) return facts;

  const withQuantities = row => ({ ...row, TicketCount: 0, TicketQty: 0, TicketRemaining: 0, CutQty: 0, InvoicedQty: 0, InvoiceBook: null });
  const head = intInputs(sql, 'dsId', list);
  for (const row of (await query(headSql(head.names), { ...head.inputs, ...windowInput })).recordset || []) {
    facts.set(Number(row.SOID), withQuantities(row));
  }
  const orders = new Map([...facts.values()]
    .filter(f => Number(f.DocuType) === 104 && String(f.DocuStatus || '').toUpperCase() !== 'C')
    .map(f => [Number(f.SOID), f]));
  const bookings = [...facts.values()].filter(f => Number(f.DocuType) === 103 && ['Y', 'P'].includes(f.DocuStatus));
  if (bookings.length) {
    const booking = intInputs(sql, 'dsBooking', bookings.map(f => Number(f.SOID)));
    for (const row of (await query(deliverySql(booking.names), { ...booking.inputs, ...windowInput })).recordset || []) {
      const parent = facts.get(Number(row.BookingId));
      const id = Number(row.SOID);
      if (!orders.has(id)) orders.set(id, withQuantities(row));
      (parent.Deliveries ||= []).push(orders.get(id));
    }
  }
  for (const part of chunks([...orders.keys()])) await loadOrderQuantities(query, sql, part, orders, windowInput);
  return facts;
}

async function loadOrderQuantities(query, sql, orderIds, orders, windowInput) {
  const order = intInputs(sql, 'dsOrder', orderIds);

  const readTicketsAndCuts = async () => {
    const couponOwner = new Map();
    const invoiceLines = new Map();
    for (const row of (await query(ticketSql(order.names), order.inputs)).recordset || []) {
      const fact = orders.get(Number(row.DocuID));
      if (!fact) continue;
      fact.TicketCount += 1;
      fact.TicketQty += Number(row.GoodQty) || 0;
      fact.TicketRemaining += Number(row.RemaQty) || 0;
      couponOwner.set(Number(row.CouponID), fact);
    }
    for (const part of chunks(safeIds([...couponOwner.keys()], Number.MAX_SAFE_INTEGER))) {
      const coupon = intInputs(sql, 'dsCoupon', part);
      const cuts = await query(cutSql(coupon.names), {
        ...coupon.inputs,
        ...windowInput,
        cutLow: { type: sql.Int, value: Math.min(...part) },
        cutHigh: { type: sql.Int, value: Math.max(...part) },
      });
      for (const row of cuts.recordset || []) {
        const fact = couponOwner.get(Number(row.CouponID));
        if (!fact) continue;
        const cutQty = Number(row.CutQty) || 0;
        fact.CutQty += cutQty;
        fact.HasOutsideWindow = Math.max(Number(fact.HasOutsideWindow || 0), Number(row.HasOutsideWindow || 0));
        const expectedBook = { I: 'J', K: 'N' }[String(fact.DocuNo || '').trim().charAt(0).toUpperCase()];
        const book = String(row.InvoiceBook || '').trim().toUpperCase();
        if (cutQty <= 0 || !expectedBook || book !== expectedBook || Number(row.InvoiceOrderId) !== Number(fact.SOID)) continue;
        const key = `${row.SOInvID}:${row.SOListNo}`;
        if (!invoiceLines.has(key)) {
          invoiceLines.set(key, { fact, book, invoiceQty: tonnes(row.InvoiceQty), cutQty: 0 });
        }
        invoiceLines.get(key).cutQty += cutQty;
      }
    }
    for (const line of invoiceLines.values()) {
      if (Math.abs(tonnes(line.cutQty) - line.invoiceQty) > EPSILON) continue;
      line.fact.InvoicedQty += line.cutQty;
      line.fact.InvoiceBook = line.book;
    }
  };
  const checkInvoiceWindow = async () => {
    for (const row of (await query(invoiceWindowSql(order.names), { ...order.inputs, ...windowInput })).recordset || []) {
      const fact = orders.get(Number(row.RefID));
      if (fact) fact.HasOutsideWindow = Math.max(Number(fact.HasOutsideWindow || 0), Number(row.HasOutsideWindow || 0));
    }
  };
  await Promise.all([readTicketsAndCuts(), checkInvoiceWindow()]);
}

/**
 * Sets `docStage` on each bill of a page. A draft that lives only in Sale-App has no WinSpeed document.
 * A native row is matched by its id and by its own document number together, because a draft's id can
 * equal another document's SOID.
 */
async function attachDocumentStages(orders, { query, sql, dataWindow }) {
  if (!isValidStartDate(dataWindow?.businessDate)) throw Object.assign(new Error('DATA_WINDOW_UNAVAILABLE'), {code:'DATA_WINDOW_UNAVAILABLE'});
  const rows = Array.isArray(orders) ? orders : [];
  // The board can contain several scoped columns of up to 100 cards each.
  // Do not silently drop the rows after the first 200; bound each SQL batch.
  const ids = safeIds(rows.filter(o => o && o.importedDocuNo).map(o => o.id), Number.MAX_SAFE_INTEGER);
  const facts = new Map();
  for (const part of chunks(ids, MAX_IDS)) {
    for (const [id, fact] of await loadDocumentStageFacts(query, sql, part, dataWindow)) facts.set(id, fact);
  }
  for (const order of rows) {
    if (!order) continue;
    const docuNo = String(order.importedDocuNo || '').trim();
    const fact = docuNo ? facts.get(Number(order.id)) : null;
    if (fact && String(fact.DocuNo || '').trim() === docuNo) order.docStage = deriveDocumentStage(fact);
    else if (!docuNo && order.status === 'DRAFT') order.docStage = { code: STAGE.DRAFT, docType: null };
    else order.docStage = null;
  }
  return rows;
}

// Aging endpoints return one row per item, using native SOID and DocuNo. Only
// call this after the endpoint has applied both user scopes and the cutoff.
async function attachAgingDocumentStages(rows, options) {
  const result = Array.isArray(rows) ? rows : [];
  const carriers = result.map(row => ({ id: row.SoId, importedDocuNo: row.WfRef, status: row.Status }));
  await attachDocumentStages(carriers, options);
  result.forEach((row, index) => { row.docStage = carriers[index].docStage || null; });
  return result;
}

module.exports = { STAGE, deriveDocumentStage, loadDocumentStageFacts, attachDocumentStages, attachAgingDocumentStages, safeIds };
