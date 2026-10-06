/**
 * account-books.js — the I/K account-series mapping in ONE place (R12 item 9).
 *
 *   book I  (account 1, Post บัญชี 1): booking/sales order I → coupon C → invoice J
 *   book K  (account 2, Post บัญชี 2): booking/sales order K → coupon D → invoice N
 *
 * Matches WINSpeed's own pairing in dbo.EMRunChar.ListNo (1 = I/C/J, 2 = K/D/N).
 * Rule confirmed by the owner (2026-10-06): K bills draw only D coupons, I bills only C.
 */

const BOOKS = Object.freeze({
  I: Object.freeze({ book: 'I', account: 1, listNo: 1, bill: 'I', coupon: 'C', invoice: 'J' }),
  K: Object.freeze({ book: 'K', account: 2, listNo: 2, bill: 'K', coupon: 'D', invoice: 'N' }),
});

const BY_PREFIX = Object.freeze(Object.fromEntries(
  Object.values(BOOKS).flatMap(b => [[b.bill, b], [b.coupon, b], [b.invoice, b]])
));

/** Book ('I' | 'K') of any bill, coupon or invoice number, or null if unknown (e.g. AI, QU). */
function bookOf(docNo) {
  const s = String(docNo || '').trim().toUpperCase();
  if (!s) return null;
  if (s.startsWith('AI')) return null; // AI approval numbers are shared by both books
  return BY_PREFIX[s[0]]?.book || null;
}

function couponSeriesForBill(billPrefix) {
  return BOOKS[String(billPrefix || '').toUpperCase()]?.coupon || null;
}

function invoiceSeriesForBill(billPrefix) {
  return BOOKS[String(billPrefix || '').toUpperCase()]?.invoice || null;
}

/** True when the coupon may be drawn on a bill of that prefix (unknown prefixes are not restricted). */
function couponAllowedForBill(couponNo, billPrefix) {
  const want = couponSeriesForBill(billPrefix);
  if (!want) return true;
  return String(couponNo || '').trim().toUpperCase().startsWith(want);
}

function couponBookMismatchMessage(couponNo, billPrefix) {
  const want = couponSeriesForBill(billPrefix);
  return `บิล ${String(billPrefix).toUpperCase()} ใช้ได้เฉพาะตั๋วเล่ม ${want} (บัญชี ${BOOKS[String(billPrefix).toUpperCase()].account}) — ตั๋ว ${couponNo} อยู่คนละบัญชี`;
}

/**
 * Account mismatch between a cut's bill/coupon and the invoice it was posted to
 * (K-F4: staff forgot to switch creditsale_docuno before Post Invoice).
 * @returns {null | { expected: 'J'|'N', actual: string, book: 'I'|'K' }}
 */
function invoiceMismatch({ billNo, couponNo, invoiceNo }) {
  const inv = String(invoiceNo || '').trim().toUpperCase();
  if (!inv) return null;
  const book = bookOf(couponNo) || bookOf(billNo);
  if (!book) return null;
  const expected = BOOKS[book].invoice;
  return inv.startsWith(expected) ? null : { book, expected, actual: inv[0] };
}

module.exports = { BOOKS, bookOf, couponSeriesForBill, invoiceSeriesForBill, couponAllowedForBill, couponBookMismatchMessage, invoiceMismatch };
