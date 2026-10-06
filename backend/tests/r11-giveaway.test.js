'use strict';

/**
 * R11 B — giveaways: U-5 pieces, U-7/U-8 server quota (save + approval, one matcher),
 * U-6 borrow (regions, one transaction, 400/409), plus R12 item 8 (borrow cap setting).
 * Real routers over HTTP with a recording DB stub.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

// Scenario state the stub reads; each test sets what it needs.
const state = {
  so: null,              // row returned by wf.v_AllSalesOrders
  draftLines: [],        // wf.SalesOrderLine rows of that draft
  quotaRows: [],         // wf.v_GiveawayBudgetStatus rows of the sales user
  otherDrafts: [],       // giveaway lines on the user's other open drafts
  mapping: { '28000': { Brand: 'รถเกษตร', ItemName: 'เสื้อยืดแขนยาว' } },
  borrow: null,          // wf.GiveawayBorrowRequest row
  lenderBudget: null, lenderWithdrawn: 0, requesterBudget: null,
  borrowPct: null,       // GIVEAWAY_BORROW_MAX_PCT
  lenderLine: null, requesterLine: null,
};

const db = h.installDbStub(({ text, inputs }) => {
  // shared
  if (/GIVEAWAY_BORROW_MAX_PCT/.test(text)) return state.borrowPct == null ? [] : [{ SettingValue: String(state.borrowPct) }];
  if (/FROM wf\.GiveawayItemMapping/.test(text)) { const m = state.mapping[String(inputs.g)]; return m ? [m] : []; }
  if (/FROM wf\.v_GiveawayBudgetStatus\s+WHERE SalesUserId = @su AND PeriodYear = @y/.test(text)) return state.quotaRows;
  if (/JOIN wf\.SalesOrder s ON s\.Id = l\.SoId/.test(text)) return state.otherDrafts;
  // so.js approval route
  if (/FROM wf\.v_AllSalesOrders/.test(text)) return state.so ? [state.so] : [];
  if (/COL_LENGTH\('wf\.SalesOrderLine', 'GiveawayApprovalStatus'\)/.test(text)) return [{ HasColumns: 1 }];
  if (/FROM wf\.SalesOrderLine WHERE SoId = @soId/.test(text)) return state.draftLines;
  if (/SET GiveawayApprovalStatus='APPROVED'/.test(text)) return [{ Affected: 1 }];
  // giveaway.js borrow
  if (/SELECT \* FROM wf\.GiveawayBorrowRequest WITH \(UPDLOCK, ROWLOCK\)/.test(text)) return state.borrow ? [state.borrow] : [];
  if (/SELECT RequesterId, LenderId, Status FROM wf\.GiveawayBorrowRequest/.test(text)) return state.borrow ? [state.borrow] : [];
  if (/SET Status = 'REJECTED'/.test(text)) return { recordset: [], rowsAffected: [1] };
  if (/FROM wf\.GiveawayBudget WITH \(UPDLOCK, ROWLOCK\)/.test(text)) {
    return inputs.rg === state.borrow?.LenderRegion ? (state.lenderBudget ? [state.lenderBudget] : [])
      : (state.requesterBudget ? [state.requesterBudget] : []);
  }
  if (/SUM\(Qty\), 0\) AS Withdrawn/.test(text)) return [{ Withdrawn: state.lenderWithdrawn }];
  if (/UPDATE wf\.GiveawayBudget/.test(text)) return { recordset: [], rowsAffected: [1] };
  if (/SET Status = 'APPROVED'/.test(text)) return { recordset: [], rowsAffected: [1] };
  if (/SELECT TOP 1 Region, RemainingQty FROM wf\.v_GiveawayBudgetStatus/.test(text)) return state.lenderLine ? [state.lenderLine] : [];
  if (/SELECT TOP 1 Region FROM wf\.GiveawayBudget WHERE SalesUserId=@u/.test(text)) return state.requesterLine ? [state.requesterLine] : [];
  if (/COL_LENGTH\('wf\.GiveawayBorrowRequest', 'RequesterRegion'\)/.test(text)) return [{ HasCol: 1 }];
  if (/INSERT INTO wf\.GiveawayBorrowRequest/.test(text)) return [{ Id: 501 }];
  return [];
});

const { checkGiveawayQuota, linePieces } = require('../services/giveaway-quota');
const quotaRow = (remaining) => ({ Region: 'ภาคกลาง', Brand: 'รถเกษตร', ItemName: 'เสื้อยืดแขนยาว', BudgetQty: 5000, WithdrawnQty: 5000 - remaining, RemainingQty: remaining });
const gwLine = (pieces, extra = {}) => ({ isGiveaway: true, goodId: '28000', goodName: 'เสื้อยืดแขนยาว ตรารถเกษตร', qtyTon: pieces, ...extra });

let app;
test.before(async () => {
  app = await h.startApp([['/api/so', '../../routes/so'], ['/api/giveaway', '../../routes/giveaway']]);
});
test.after(async () => { await app.close(); });

// ── U-5: one piece rule ─────────────────────────────────────────────────────
test('U-5: pieces come from pieceQty, then the editor ton field, then QtyBag (rows since U-5)', () => {
  assert.equal(linePieces({ pieceQty: 250, qtyTon: 1, qtyBag: 20 }), 250);
  assert.equal(linePieces({ qtyTon: 250, qtyBag: 5000 }), 250, 'editor keeps pieces in qtyTon; qtyBag = qtyTon × BagPerTon is ignored');
  assert.equal(linePieces({ QtyTon: 0, QtyBag: 250 }), 250, 'rows saved since U-5');
  assert.equal(linePieces({}), 0);
});

// ── U-7/U-8: quota check unit ───────────────────────────────────────────────
test('U-8: within quota passes; over quota and missing budget line fail with the borrow hint data', async () => {
  const queryFn = (text, inputs) => db.stub.wfQuery(text, inputs);
  state.quotaRows = [quotaRow(300)]; state.otherDrafts = [];
  const ok = await checkGiveawayQuota({ queryFn, salesUserId: 34, lines: [gwLine(300)] });
  assert.equal(ok.ok, true);
  assert.equal(ok.checked[0].available, 300);

  state.otherDrafts = [{ SoId: '900', GoodId: '28000', GoodName: 'เสื้อยืดแขนยาว ตรารถเกษตร', QtyTon: 0, QtyBag: 100 }];
  const over = await checkGiveawayQuota({ queryFn, salesUserId: 34, lines: [gwLine(250)] });
  assert.equal(over.ok, false, 'other open drafts reduce what is available');
  assert.equal(over.problems[0].reason, 'OVER_QUOTA');
  assert.equal(over.problems[0].available, 200);

  state.quotaRows = [];
  const none = await checkGiveawayQuota({ queryFn, salesUserId: 34, lines: [gwLine(1)] });
  assert.equal(none.problems[0].reason, 'NO_BUDGET_LINE');
  state.otherDrafts = [];
});

// ── U-7: approval re-checks quota ───────────────────────────────────────────
test('U-7: MANAGER approval is refused when the draft is now over quota (no approval UPDATE)', async () => {
  state.so = { Id: 123, Status: 'DRAFT', SalesUserId: 34, WfRef: 'I69-09999' };
  state.draftLines = [{ LineNum: 1, GoodId: '28000', GoodName: 'เสื้อยืดแขนยาว ตรารถเกษตร', QtyTon: 0, QtyBag: 300, IsGiveaway: 1 }];
  state.quotaRows = [quotaRow(250)];
  const before = db.calls.length;
  const r = await app.call('PATCH', '/api/so/123/giveaway-lines/1/approve', { body: { note: 'ok' }, user: { sub: 25, role: 'MANAGER' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'GIVEAWAY_OVER_QUOTA');
  assert.match(r.body.message, /ขอยืม/);
  assert.equal(db.calls.slice(before).filter(c => /SET GiveawayApprovalStatus='APPROVED'/.test(c.text)).length, 0);
});

test('U-7: approval within quota proceeds', async () => {
  state.quotaRows = [quotaRow(400)];
  const r = await app.call('PATCH', '/api/so/123/giveaway-lines/1/approve', { body: { note: 'ok' }, user: { sub: 25, role: 'MANAGER' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'APPROVED');
});

// ── U-6: borrow approve in one transaction ──────────────────────────────────
function pendingBorrow(extra = {}) {
  return {
    Id: 5, RequesterId: 41, LenderId: 40, Status: 'PENDING', PeriodYear: 2569, Brand: 'รถเกษตร', ItemName: 'เสื้อยืดแขนยาว',
    Qty: 100, Region: 'ภาคเหนือ', RequesterRegion: 'ภาคเหนือ', LenderRegion: 'ภาคกลาง', Reason: '', ...extra,
  };
}

test('U-6: approve moves the qty from the lender region row to the requester region row', async () => {
  state.borrow = pendingBorrow(); state.lenderBudget = { Id: 1, BudgetQty: 500 }; state.lenderWithdrawn = 100;
  state.requesterBudget = { Id: 2, BudgetQty: 50 }; state.borrowPct = null;
  const before = db.calls.length;
  const r = await app.call('PATCH', '/api/giveaway/borrow-requests/5/resolve', { body: { approve: true }, user: { sub: 25, role: 'MANAGER' } });
  assert.equal(r.status, 200);
  const upd = db.calls.slice(before).filter(c => /UPDATE wf\.GiveawayBudget/.test(c.text));
  assert.equal(upd.length, 2);
  assert.match(upd[0].text, /BudgetQty - @qty/); assert.equal(upd[0].inputs.id, 1); assert.equal(Number(upd[0].inputs.qty), 100);
  assert.match(upd[1].text, /BudgetQty \+ @qty/); assert.equal(upd[1].inputs.id, 2);
});

test('U-6: insufficient lender quota → 400 and no budget row changes', async () => {
  state.borrow = pendingBorrow(); state.lenderWithdrawn = 450; // remaining 50 < 100
  const before = db.calls.length;
  const r = await app.call('PATCH', '/api/giveaway/borrow-requests/5/resolve', { body: { approve: true }, user: { sub: 25, role: 'MANAGER' } });
  assert.equal(r.status, 400);
  assert.equal(db.calls.slice(before).filter(c => /UPDATE wf\.GiveawayBudget/.test(c.text)).length, 0);
});

test('U-6: a second approve of the same request → 409', async () => {
  state.borrow = pendingBorrow({ Status: 'APPROVED' });
  const r = await app.call('PATCH', '/api/giveaway/borrow-requests/5/resolve', { body: { approve: true }, user: { sub: 25, role: 'MANAGER' } });
  assert.equal(r.status, 409);
});

test('U-6: an unrelated SALES user cannot reject someone else\'s request', async () => {
  state.borrow = pendingBorrow();
  const r = await app.call('PATCH', '/api/giveaway/borrow-requests/5/resolve', { body: { approve: false }, user: { sub: 99, role: 'SALES' } });
  assert.equal(r.status, 403);
  const own = await app.call('PATCH', '/api/giveaway/borrow-requests/5/resolve', { body: { approve: false }, user: { sub: 41, role: 'SALES' } });
  assert.equal(own.status, 200, 'the requester may withdraw their own request');
});

test('U-6: borrowing from yourself is blocked', async () => {
  const r = await app.call('POST', '/api/giveaway/borrow-requests', { body: { lenderId: 41, brand: 'รถเกษตร', itemName: 'เสื้อยืดแขนยาว', qty: 10 }, user: { sub: 41, role: 'SALES' } });
  assert.equal(r.status, 400);
});

test('U-6: the server stores the regions from the budgets, not from the client', async () => {
  state.lenderLine = { Region: 'ภาคกลาง', RemainingQty: 1000 }; state.requesterLine = { Region: 'ภาคเหนือ' }; state.borrowPct = null;
  const before = db.calls.length;
  const r = await app.call('POST', '/api/giveaway/borrow-requests', {
    body: { lenderId: 40, region: 'ภาคใต้', requesterRegion: 'ภาคใต้', lenderRegion: 'ภาคใต้', brand: 'รถเกษตร', itemName: 'เสื้อยืดแขนยาว', qty: 100 },
    user: { sub: 41, role: 'SALES' },
  });
  assert.equal(r.status, 200);
  const ins = db.calls.slice(before).find(c => /INSERT INTO wf\.GiveawayBorrowRequest/.test(c.text));
  assert.equal(ins.inputs.reqRg, 'ภาคเหนือ');
  assert.equal(ins.inputs.lenRg, 'ภาคกลาง');
});

// ── R12 item 8: borrow cap setting ──────────────────────────────────────────
test('R12-8: GIVEAWAY_BORROW_MAX_PCT caps the request (and defaults to 100%)', async () => {
  state.lenderLine = { Region: 'ภาคกลาง', RemainingQty: 100 }; state.requesterLine = { Region: 'ภาคเหนือ' };
  state.borrowPct = 50;
  const body = { lenderId: 40, brand: 'รถเกษตร', itemName: 'เสื้อยืดแขนยาว', qty: 60 };
  const capped = await app.call('POST', '/api/giveaway/borrow-requests', { body, user: { sub: 41, role: 'SALES' } });
  assert.equal(capped.status, 400);
  assert.match(capped.body.message, /50%/);
  state.borrowPct = null;
  const full = await app.call('POST', '/api/giveaway/borrow-requests', { body: { ...body, qty: 100 }, user: { sub: 41, role: 'SALES' } });
  assert.equal(full.status, 200);
});

test('R12-8: the cap is enforced again at approval', async () => {
  state.borrow = pendingBorrow({ Qty: 100 }); state.lenderBudget = { Id: 1, BudgetQty: 500 }; state.lenderWithdrawn = 300; // remaining 200
  state.requesterBudget = { Id: 2, BudgetQty: 0 }; state.borrowPct = 40;                                                  // 40% of 200 = 80 < 100
  const r = await app.call('PATCH', '/api/giveaway/borrow-requests/5/resolve', { body: { approve: true }, user: { sub: 25, role: 'MANAGER' } });
  assert.equal(r.status, 400);
  state.borrowPct = null;
});
