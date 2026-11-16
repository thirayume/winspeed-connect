'use strict';
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
  const docuType = Number(fact.DocuType);
  const docuStatus = String(fact.DocuStatus || '').trim().toUpperCase();
  if (docuType !== 103 && docuType !== 104) return null;
  if (docuStatus === 'C') return { code: STAGE.CANCELLED, docType: docuType };

  if (docuType === 103) {
    // WinSpeed marks a booking Y once a sales order has taken it (P when only part of it).
    if (docuStatus === 'Y' || docuStatus === 'P') return { code: STAGE.BOOKING_ORDERED, docType: 104 };
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
  const invoicedAll = invoicedQty >= cutQty - EPSILON && hauledAll;
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
  WHERE h.SOID IN (${names}) AND h.DocuType IN (103, 104)`;

const ticketSql = names => `
  SELECT c.CouponID, c.DocuID, c.GoodQty, c.RemaQty
  FROM dbo.WFCoupon c WITH (NOLOCK)
  WHERE c.Docutype = 104 AND c.DocuID IN (${names})`;

// The range keeps the single pass over WFRedemtionDT cheap; the list keeps it exact.
const cutSql = names => `
  SELECT rd.CouponID, SUM(rd.GoodQty) AS CutQty, SUM(CASE WHEN rd.PostInv = 'Y' THEN rd.GoodQty ELSE 0 END) AS InvoicedQty
  FROM dbo.WFRedemtionDT rd WITH (NOLOCK)
  JOIN dbo.WFRedemtionHD rh WITH (NOLOCK) ON rh.RedemtionID = rd.RedemtionID
  WHERE rd.CouponID BETWEEN @cutLow AND @cutHigh AND rd.CouponID IN (${names})
    AND rh.DocuType = 116 AND ISNULL(rh.DocuStatus, '') <> 'C'
  GROUP BY rd.CouponID`;

const bookSql = names => `
  SELECT i.RefID, MIN(LEFT(RTRIM(ih.DocuNo), 1)) AS InvoiceBook
  FROM dbo.SOInvDT i WITH (NOLOCK)
  JOIN dbo.SOInvHD ih WITH (NOLOCK) ON ih.SOInvID = i.SOInvID
  WHERE i.RefID IN (${names}) AND i.Docutype = 107 AND ih.Docutype = 107 AND ISNULL(ih.DocuStatus, '') <> 'C'
  GROUP BY i.RefID`;

/** Map of SOID to the counts behind its stage, for native bookings and sales orders among `ids`. */
async function loadDocumentStageFacts(query, sql, ids) {
  const list = safeIds(ids);
  const facts = new Map();
  if (!list.length) return facts;

  const head = intInputs(sql, 'dsId', list);
  for (const row of (await query(headSql(head.names), head.inputs)).recordset || []) {
    facts.set(Number(row.SOID), { ...row, TicketCount: 0, TicketQty: 0, TicketRemaining: 0, CutQty: 0, InvoicedQty: 0, InvoiceBook: null });
  }
  const orderIds = [...facts.values()]
    .filter(f => Number(f.DocuType) === 104 && String(f.DocuStatus || '').toUpperCase() !== 'C')
    .map(f => Number(f.SOID));
  if (!orderIds.length) return facts;
  const order = intInputs(sql, 'dsOrder', orderIds);

  const readTicketsAndCuts = async () => {
    const couponOwner = new Map();
    for (const row of (await query(ticketSql(order.names), order.inputs)).recordset || []) {
      const fact = facts.get(Number(row.DocuID));
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
        cutLow: { type: sql.Int, value: Math.min(...part) },
        cutHigh: { type: sql.Int, value: Math.max(...part) },
      });
      for (const row of cuts.recordset || []) {
        const fact = couponOwner.get(Number(row.CouponID));
        if (!fact) continue;
        fact.CutQty += Number(row.CutQty) || 0;
        fact.InvoicedQty += Number(row.InvoicedQty) || 0;
      }
    }
  };
  const readInvoiceBooks = async () => {
    for (const row of (await query(bookSql(order.names), order.inputs)).recordset || []) {
      const fact = facts.get(Number(row.RefID));
      if (fact) fact.InvoiceBook = row.InvoiceBook;
    }
  };
  await Promise.all([readTicketsAndCuts(), readInvoiceBooks()]);
  return facts;
}

/**
 * Sets `docStage` on each bill of a page. A draft that lives only in Sale-App has no WinSpeed document.
 * A native row is matched by its id and by its own document number together, because a draft's id can
 * equal another document's SOID.
 */
async function attachDocumentStages(orders, { query, sql }) {
  const rows = Array.isArray(orders) ? orders : [];
  const facts = await loadDocumentStageFacts(query, sql, rows.filter(o => o && o.importedDocuNo).map(o => o.id));
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

module.exports = { STAGE, deriveDocumentStage, loadDocumentStageFacts, attachDocumentStages, safeIds };
