'use strict';

/**
 * R12 item 9 — K bills (บัญชี 2).
 *  K-F3: K bills draw only D coupons, I bills only C (reserve + save/confirm + picker filter).
 *  K-F4: a K/D cut posted to a J invoice is flagged; read-only "active book" indicator.
 *  One account-series mapping (I→C→J, K→D→N).
 * Uses the real fixtures: K69-02419 / D6904967 / 69100005 → J69-04540 (mismatch) and
 * the real matched pair K69-01788 / D6903617 / 69060474 → N69-01899.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const state = { coupon: null, mismatchRows: [], books: [], pending: [] };
h.installDbStub(({ text }) => {
  if (/FROM dbo\.WFCoupon c WITH \(UPDLOCK, ROWLOCK\)/.test(text)) return state.coupon ? [state.coupon] : [];
  if (/FROM dbo\.WFRedemtionDT d WITH \(NOLOCK\)[\s\S]*JOIN dbo\.SOInvHD i/.test(text)) return state.mismatchRows;
  if (/FROM dbo\.EMRunBrch WITH \(NOLOCK\)\s+WHERE BrchID = 1 AND RunCode IN/.test(text)) return state.books;
  if (/ISNULL\(d\.SOInvID, 0\) = 0/.test(text)) return state.pending;
  return [];
});

const books = require('../services/account-books');
const { validateAndLockCouponReservations } = require('../services/coupon-service');

let app;
test.before(async () => { app = await h.startApp([['/api/coupons', '../../routes/coupons'], ['/api/recon', '../../routes/recon']]); });
test.after(async () => { await app.close(); });

test('mapping in one place: I→C→J (account 1), K→D→N (account 2)', () => {
  assert.equal(books.bookOf('K69-02419'), 'K');
  assert.equal(books.bookOf('D6904967'), 'K');
  assert.equal(books.bookOf('N69-01899'), 'K');
  assert.equal(books.bookOf('I69-04241'), 'I');
  assert.equal(books.bookOf('C6906919'), 'I');
  assert.equal(books.bookOf('J69-04540'), 'I');
  assert.equal(books.bookOf('AI69-06847'), null, 'AI approval numbers are shared');
  assert.equal(books.couponSeriesForBill('K'), 'D');
  assert.equal(books.invoiceSeriesForBill('I'), 'J');
  assert.equal(books.BOOKS.K.account, 2);
});

test('K-F3: reserving a C coupon on a K bill is refused (and D on an I bill)', async () => {
  state.coupon = { CouponID: 246001, CouponNo: 'C6906919', GoodID: 1114, GoodName: '15-15-15', GoodPrice: 0, NativeRemaQty: 2, OwnerCustId: '1141', OwnerCustName: 'x' };
  const body = { couponId: 246001, carrierSoId: 'DRAFT', beneficiaryCustId: '1141', reservedQty: 1, billPrefix: 'K' };
  const r = await app.call('POST', '/api/coupons/reserve', { body, user: { sub: 43, role: 'SALES' } });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /ตั๋วเล่ม D/);
  state.coupon = { ...state.coupon, CouponID: 246003, CouponNo: 'D6904967' };
  const r2 = await app.call('POST', '/api/coupons/reserve', { body: { ...body, couponId: 246003, billPrefix: 'I' }, user: { sub: 43, role: 'SALES' } });
  assert.equal(r2.status, 400);
  assert.match(r2.body.message, /ตั๋วเล่ม C/);
});

test('K-F3: saving/confirming a K bill that carries a C reservation is refused', async () => {
  const tx = { request() { return { input() { return this; }, async query() { return { recordset: [{ Id: 19, CouponId: 246001, CouponNo: 'C6906919', GoodId: 1114, ReservedQty: 1, Status: 'RESERVED', BeneficiaryCustId: '16002', OwnerCustId: '1141', CarrierSoId: null }] }; } }; } };
  await assert.rejects(
    validateAndLockCouponReservations(tx, [{ couponReservationId: 19, goodId: 1114, qtyTon: 1 }], '16002', null, null, 'K'),
    e => e.status === 400 && e.code === 'COUPON_BOOK_MISMATCH');
});

test('K-F3: the picker filter keeps only the bill\'s own series', () => {
  const rows = [{ couponNo: 'D6904967' }, { couponNo: 'C6906919' }, { couponNo: 'C6906918' }];
  assert.deepEqual(rows.filter(r => books.couponAllowedForBill(r.couponNo, 'K')).map(r => r.couponNo), ['D6904967']);
  assert.deepEqual(rows.filter(r => books.couponAllowedForBill(r.couponNo, 'I')).map(r => r.couponNo), ['C6906919', 'C6906918']);
});

test('K-F4: a K/D cut with a J invoice is flagged for ACCOUNTING; a real K→N pair is not', async () => {
  assert.equal(books.invoiceMismatch({ billNo: 'K69-01788', couponNo: 'D6903617', invoiceNo: 'N69-01899' }), null);
  state.mismatchRows = [
    { RedemtionID: 183004, CutNo: '69100005', CutDate: '2026-10-06', CouponNo: 'D6904967', CouponSoNo: 'K69-02419', SOInvID: 337008, InvoiceNo: 'J69-04540', InvoiceDate: '2026-10-04', NetAmnt: 19000 },
    { RedemtionID: 183005, CutNo: '69100006', CutDate: '2026-10-06', CouponNo: 'D6904967', CouponSoNo: 'K69-02419', SOInvID: 337009, InvoiceNo: 'J69-04541', InvoiceDate: '2026-10-04', NetAmnt: 19000 },
  ];
  const r = await app.call('GET', '/api/recon/account-mismatches?days=60', { user: { sub: 12, role: 'ACCOUNTING' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 2);
  assert.equal(r.body.data[0].expectedInvoiceSeries, 'N');
  assert.equal(r.body.data[0].account, 2);
  assert.match(r.body.data[0].message, /J69-04540/);
  const sales = await app.call('GET', '/api/recon/account-mismatches', { user: { sub: 43, role: 'SALES' } });
  assert.equal(sales.status, 403);
});

test('K-F4: active-book indicator reads which book WINSpeed is on (read-only)', async () => {
  state.books = [
    { RunCode: '103', RunFormat: 'Iyy-00000', LastNo: 'I69-04241' },
    { RunCode: 'couponno', RunFormat: 'Dyy00000', LastNo: 'D6904967' },
    { RunCode: 'creditsale_docuno', RunFormat: 'Jyy-00000', LastNo: 'J69-04541' },
  ];
  state.pending = [{ Series: 'D', Cuts: 3 }, { Series: 'C', Cuts: 1 }];
  const r = await app.call('GET', '/api/recon/active-books', { user: { sub: 12, role: 'ACCOUNTING' } });
  assert.equal(r.status, 200);
  const inv = r.body.books.find(b => b.runCode === 'creditsale_docuno');
  assert.equal(inv.activeBook, 'I'); assert.equal(inv.activeAccount, 1);
  const cpn = r.body.books.find(b => b.runCode === 'couponno');
  assert.equal(cpn.activeBook, 'K'); assert.equal(cpn.activeAccount, 2);
  assert.deepEqual(r.body.cutsAwaitingInvoice, { account1: 1, account2: 3 });
});
