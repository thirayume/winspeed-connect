'use strict';

// Server-side check that a locked native 103 has the document shape of a ticket-only
// line under one of the two treatments rehearsed in WinSpeed UAT:
//   ZERO     - the line is keyed at price 0 (amount 0, no discount)
//   DISCOUNT - the line is keyed at the selling price and the bill discount, entered as
//              a plain amount, removes exactly that line's amount
// It reads the booking again inside the caller's transaction, under the locks the
// booking proof already holds, and uses exact 1/10000 arithmetic.
//
// This is NOT an accounting approval. It proves only that the 103 is shaped the way the
// treatment says. Which treatment is acceptable for receivables, VAT and GL, and which
// invoice book is used, is the accounting team's decision; until then no route may pass
// this function to the redemption transaction outside a rehearsal.
const { ticketUnits } = require('./rebate-ticket-redemption-plan');

const TREATMENTS = Object.freeze(['ZERO', 'DISCOUNT']);
const MONEY = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/;

function money(value) {
  const s = String(value ?? '').trim();
  if (!MONEY.test(s)) return null;
  const [whole, fraction = ''] = s.split('.');
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
}
function quantity(value) {
  try { return ticketUnits(String(value ?? '').trim()); } catch { return null; }
}
const decimal = column => `CONVERT(varchar(40),CAST(${column} AS decimal(19,4))) AS ${column.split('.').pop()}`;

/**
 * Reasons are returned for the rehearsal log and tests. Callers that gate a write use
 * verifyTicketTreatmentShape, which reduces the result to true/false.
 */
async function inspectTicketTreatmentShape(query, context, treatment) {
  const reject = reason => ({ ok: false, reason });
  if (typeof query !== 'function' || !context || !TREATMENTS.includes(treatment)) return reject('INPUT_INVALID');
  const bookingId = Number(context.bookingId), lineNo = Number(context.lineNo);
  if (!Number.isSafeInteger(bookingId) || bookingId < 1 || !Number.isSafeInteger(lineNo) || lineNo < 1) return reject('INPUT_INVALID');
  const requested = quantity(context.requestedTonnage);
  if (requested === null || requested <= 0n) return reject('QUANTITY_INVALID');

  const header = (await query(`SELECT ${decimal('h.SumGoodAmnt')},${decimal('h.BillDiscAmnt')},${decimal('h.NetAmnt')},
      ${decimal('h.VATAmnt')},RTRIM(h.BillDiscFormula) AS BillDiscFormula
    FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) WHERE h.SOID=@bookingId AND h.DocuType=103`, { bookingId })).recordset || [];
  if (header.length !== 1) return reject('BOOKING_NOT_FOUND');
  const lines = (await query(`SELECT d.ListNo,${decimal('d.GoodQty2')},${decimal('d.GoodPrice2')},${decimal('d.GoodAmnt')},
      ${decimal('d.GoodDiscAmnt')},RTRIM(d.FreeFlag) AS FreeFlag
    FROM dbo.SODT d WITH(UPDLOCK,HOLDLOCK) WHERE d.SOID=@bookingId AND d.DocuType=103 ORDER BY d.ListNo`, { bookingId })).recordset || [];
  if (!lines.length || lines.length > 1000) return reject('LINES_UNREADABLE');

  let sum = 0n, selected = null;
  for (const line of lines) {
    const amount = money(line.GoodAmnt);
    if (amount === null) return reject('LINES_UNREADABLE');
    sum += amount;
    if (Number(line.ListNo) === lineNo) { if (selected) return reject('LINES_UNREADABLE'); selected = line; }
  }
  if (!selected) return reject('LINE_NOT_FOUND');
  const qty = quantity(selected.GoodQty2), price = money(selected.GoodPrice2), amount = money(selected.GoodAmnt),
    lineDiscount = money(selected.GoodDiscAmnt);
  const sumGood = money(header[0].SumGoodAmnt), billDiscount = money(header[0].BillDiscAmnt),
    net = money(header[0].NetAmnt), vat = money(header[0].VATAmnt);
  if ([qty, price, amount, lineDiscount, sumGood, billDiscount, net, vat].some(v => v === null)) return reject('AMOUNTS_UNREADABLE');

  // A ticket pays for a whole line. A partly paid line would leave tons at price 0 or
  // discounted without a ticket behind them.
  if (qty !== requested) return reject('NOT_WHOLE_LINE');
  if (String(selected.FreeFlag || '').trim().toUpperCase() === 'Y') return reject('FREE_LINE');
  if (lineDiscount !== 0n) return reject('LINE_DISCOUNT_PRESENT');
  if (sum !== sumGood) return reject('HEADER_SUM_MISMATCH');
  if (billDiscount > sumGood) return reject('HEADER_DISCOUNT_EXCEEDS_GOODS');

  if (treatment === 'ZERO') {
    if (price !== 0n || amount !== 0n) return reject('ZERO_LINE_HAS_PRICE');
    return { ok: true, reason: null, treatment, lineAmount: '0.0000' };
  }

  // DISCOUNT
  if (price <= 0n) return reject('DISCOUNT_LINE_WITHOUT_PRICE');
  const gross = qty * price;
  if (gross % 10000n !== 0n || gross / 10000n !== amount) return reject('LINE_AMOUNT_NOT_QTY_TIMES_PRICE');
  const formula = String(header[0].BillDiscFormula || '').trim();
  if (money(formula) === null || money(formula) !== billDiscount) return reject('BILL_DISCOUNT_NOT_PLAIN_AMOUNT');
  if (billDiscount !== amount) return reject('BILL_DISCOUNT_NOT_TICKET_LINE');
  // Only the tax-free shape seen in UAT is recognised. With VAT on the bill the net
  // amount follows rules this check does not know.
  if (vat !== 0n || net !== sumGood - billDiscount) return reject('NET_NOT_GOODS_LESS_DISCOUNT');
  // One bill discount can stand for one ticket line only.
  const others = (await query(`SELECT COUNT(*) AS N FROM wf.RebateTicketRedemptionReceipt WITH(UPDLOCK,HOLDLOCK)
    WHERE BookingSOID=@bookingId AND BookingLineNo<>@lineNo AND Treatment='DISCOUNT'`, { bookingId, lineNo })).recordset?.[0];
  if (Number(others?.N) !== 0) return reject('DISCOUNT_ALREADY_USED_ON_BOOKING');
  return { ok: true, reason: null, treatment, lineAmount: `${amount / 10000n}.${String(amount % 10000n).padStart(4, '0')}` };
}

async function verifyTicketTreatmentShape(query, context, treatment) {
  return (await inspectTicketTreatmentShape(query, context, treatment)).ok === true;
}

// The supported accounting contract is a fully covered, single-line sale
// with an actual WinSpeed 202 at zero net and zero VAT. A draft 103 or a
// 202 still carrying an undiscounted balance cannot consume a ticket.
async function verifyPostedTicketSale(query, context, treatment) {
  if (context.documentStatus !== 'Y' || context.financial.vatType !== '3'
      || money(context.financial.nativeFields.VATAmnt) !== 0n
      || money(context.financial.net) !== 0n
      || !await verifyTicketTreatmentShape(query, context, treatment)) return false;

  const rows = (await query(`
    SELECT TOP (2) s.SOID, f.SOInvID
    FROM dbo.SODT line WITH (UPDLOCK,HOLDLOCK)
    JOIN dbo.SOHD s WITH (UPDLOCK,HOLDLOCK) ON s.SOID=line.SOID AND s.DocuType=104
    JOIN dbo.SOHD b WITH (UPDLOCK,HOLDLOCK) ON b.SOID=line.RefSOID AND b.DocuType=103
    JOIN dbo.SOInvDT debt WITH (UPDLOCK,HOLDLOCK)
      ON debt.RefID=line.SOID AND debt.RefListNo=line.ListNo AND debt.DocuType=202
    JOIN dbo.SOInvHD f WITH (UPDLOCK,HOLDLOCK) ON f.SOInvID=debt.SOInvID AND f.DocuType=202
    WHERE line.DocuType=104 AND line.RefSOID=@bookingId AND line.RefListNo=@lineNo
      AND s.DocuStatus IN ('N','P','Y') AND f.DocuStatus IN ('N','P','Y')
      AND ISNULL(f.ReplaceFlag,'N')='N'
      AND s.CustID=b.CustID AND f.CustID=s.CustID AND s.BrchID=b.BrchID AND f.BrchID=s.BrchID
      AND line.GoodID=@good
      AND CONVERT(decimal(19,4),line.GoodQty2)=CAST(@quantity AS decimal(19,4))
      AND ((debt.GoodID=line.GoodID AND CONVERT(decimal(19,4),debt.GoodQty2)=CAST(@quantity AS decimal(19,4)))
        OR (debt.GoodID IS NULL AND debt.GoodQty2 IS NULL AND debt.ExpnID>0
          AND debt.GoodAmnt=0 AND debt.TotaExcludeAmnt=0))
      AND CONVERT(decimal(19,4),line.GoodPrice2)=CAST(@price AS decimal(19,4))
      AND s.VatType='3' AND s.VatAmnt=0 AND s.NetAmnt=0 AND s.BillDiscAmnt=b.BillDiscAmnt
      AND f.VatType='3' AND f.VatAmnt=0 AND f.NetAmnt=0 AND f.RemaAmnt=0 AND f.StockEffc='N'
      AND f.BillDiscAmnt=b.BillDiscAmnt
      AND NOT EXISTS(SELECT 1 FROM dbo.SODT d WITH (UPDLOCK,HOLDLOCK)
        WHERE d.SOID=b.SOID AND d.ListNo<>@lineNo)
      AND NOT EXISTS(SELECT 1 FROM dbo.SODT d WITH (UPDLOCK,HOLDLOCK)
        WHERE d.SOID=s.SOID AND d.ListNo<>line.ListNo)
      AND NOT EXISTS(SELECT 1 FROM dbo.SOInvDT d WITH (UPDLOCK,HOLDLOCK)
        WHERE d.SOInvID=f.SOInvID AND d.ListNo<>debt.ListNo)
      AND NOT EXISTS(SELECT 1 FROM dbo.SODT d WITH (UPDLOCK,HOLDLOCK)
        JOIN dbo.SOHD h WITH (UPDLOCK,HOLDLOCK) ON h.SOID=d.SOID AND h.DocuType=104
        WHERE d.DocuType=104 AND d.RefSOID=b.SOID AND d.SOID<>s.SOID AND ISNULL(h.DocuStatus,'')<>'C')
      AND NOT EXISTS(SELECT 1 FROM dbo.SOInvDT d WITH (UPDLOCK,HOLDLOCK)
        JOIN dbo.SOInvHD h WITH (UPDLOCK,HOLDLOCK) ON h.SOInvID=d.SOInvID AND h.DocuType=202
        WHERE d.DocuType=202 AND d.RefID=s.SOID AND d.SOInvID<>f.SOInvID AND ISNULL(h.DocuStatus,'')<>'C')`, {
    bookingId: context.bookingId, lineNo: context.lineNo, good: context.good,
    quantity: context.requestedTonnage, price: context.financial.price,
  })).recordset || [];
  return rows.length === 1;
}

module.exports = { verifyTicketTreatmentShape, inspectTicketTreatmentShape, verifyPostedTicketSale, TREATMENTS };
