// Ticket rehearsal on real native bookings in a rehearsal copy.
//
// Runs the candidate code's real redemption transaction (booking lock and fingerprint,
// customer aging, both reset fences, immutable receipt, FIFO over tickets) with the real
// treatment check, against two bookings keyed in WinSpeed UAT: one at price 0 and one at
// the selling price with a full bill discount. Ticket issue is simulated and labelled,
// because issuing from a conversion is still closed.
//
// EVERYTHING runs in one SQL transaction that is rolled back at the end, whatever happens.
// Output goes to the terminal only; it contains document numbers, so keep it private.
//
// Settings (environment): ONPREM_DB_NAME = primary rehearsal copy, RH_DB = session copy,
// REBATE_RESET_DATABASES and ONPREM_SWITCHABLE_DATABASES = the copies in the reset manifest,
// REBATE_POOL_103_ENABLED=true, RH_ZERO_SOID / RH_DISC_SOID = the 103 keyed at price 0 and
// the 103 keyed with a full bill discount, RH_USER_ID = an ADMIN user of the copy,
// RH_MODE = preflight (read-only) or run. It refuses any database that is not named
// dbwins_worldfert9_uat_fz<n>, and it never runs native writers.
'use strict';
const path = require('path');
const crypto = require('crypto');
const CAND = process.env.CAND_DIR || path.join(__dirname, '..');
const SESSION_DB = process.env.RH_DB;
const CASES = [
  { name: 'ZERO', treatment: 'ZERO', wrong: 'DISCOUNT', soid: Number(process.env.RH_ZERO_SOID) },
  { name: 'DISCOUNT', treatment: 'DISCOUNT', wrong: 'ZERO', soid: Number(process.env.RH_DISC_SOID) },
];
const USER = { sub: Number(process.env.RH_USER_ID), id: Number(process.env.RH_USER_ID), role: 'ADMIN', roles: ['ADMIN'], username: 'ticket-rehearsal' };
const OTHER_USER_ID = Number(process.env.RH_OTHER_USER_ID) || USER.sub + 1;
const MODE = process.env.RH_MODE || 'preflight';
if (!/^dbwins_worldfert9_uat_fz[0-9]$/.test(String(SESSION_DB)) || !/^dbwins_worldfert9_uat_fz[0-9]$/.test(String(process.env.ONPREM_DB_NAME)))
  { console.log('REFUSED: this script runs only on rehearsal copies'); process.exit(2); }

const db = require(path.join(CAND, 'db'));
const { withRebateOperationFence } = require(path.join(CAND, 'services/rebate-reset-fence'));
const { transactionQuery } = require(path.join(CAND, 'services/rebate-sql'));
const { applyTicketRedemption } = require(path.join(CAND, 'services/rebate-ticket-redemption-transaction'));
const { inspectTicketTreatmentShape, verifyTicketTreatmentShape } = require(path.join(CAND, 'services/rebate-ticket-financial-verifier'));
const { assertNoRedeemedTicketForBooking } = require(path.join(CAND, 'services/so-rebate-transaction'));
const { readGlobalDataWindow } = require(path.join(CAND, 'services/global-data-window-store'));

const ROLLBACK = new Error('REHEARSAL_ROLLBACK');
const report = { mode: MODE, primary: process.env.ONPREM_DB_NAME, sessionDb: SESSION_DB, startedAt: new Date().toISOString(), steps: [] };
const step = (name, result) => { report.steps.push({ name, ...result }); console.log(`STEP ${name}: ${JSON.stringify(result)}`); };
const expectFail = async (name, fn, codes) => {
  try { const r = await fn(); step(name, { pass: false, got: 'no error', value: r && r.id }); return false; }
  catch (e) { const pass = codes.includes(e.code); step(name, { pass, code: e.code || null, status: e.status || null, ...(pass ? {} : { message: String(e.message).slice(0, 160) }) }); return pass; }
};
const plain = rows => (rows || []).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 19) : typeof v === 'bigint' ? String(v) : v])));
const counts = async q => (await q(`SELECT (SELECT COUNT(*) FROM wf.FertilizerTicket) AS Tickets,
  (SELECT CAST(ISNULL(SUM(RemainingTonnage),0) AS decimal(14,4)) FROM wf.FertilizerTicket) AS RemainingTons,
  (SELECT COUNT(*) FROM wf.RebateTicketRedemptionReceipt) AS Receipts,
  (SELECT COUNT(*) FROM wf.RebateTicketRedemptionAllocation) AS Allocations,
  (SELECT COUNT(*) FROM wf.TicketRedemptionHistory) AS History`)).recordset[0];

async function bookingFacts(q, soid) {
  const r = (await q(`SELECT h.SOID, RTRIM(h.DocuNo) AS DocuNo, RTRIM(h.DocuStatus) AS St, h.CustID, d.ListNo, d.GoodID,
      RTRIM(g.GoodCode) AS GoodCode, RTRIM(g.GoodName1) AS GoodName,
      CONVERT(varchar(40),CAST(d.GoodQty2 AS decimal(19,4))) AS Qty, CONVERT(varchar(40),CAST(d.GoodPrice2 AS decimal(19,4))) AS Price,
      CONVERT(varchar(40),CAST(d.GoodAmnt AS decimal(19,4))) AS LineAmnt, CONVERT(varchar(40),CAST(h.BillDiscAmnt AS decimal(19,4))) AS BillDisc,
      CONVERT(varchar(40),CAST(h.NetAmnt AS decimal(19,4))) AS Net,
      (SELECT COUNT(*) FROM wf.RebateTicketRedemptionReceipt r WHERE r.BookingSOID = h.SOID) AS ExistingReceipts
    FROM dbo.SOHD h JOIN dbo.SODT d ON d.SOID = h.SOID AND d.DocuType = 103
    LEFT JOIN dbo.EMGood g ON g.GoodID = d.GoodID
    WHERE h.SOID = @soid AND h.DocuType = 103 AND d.ListNo = 1`, { soid })).recordset[0];
  return r || null;
}

// Read-only picture of what WinSpeed made from the booking: delivery, control ticket,
// transport slip and invoices. Amounts are for the accounting review.
async function downstream(q, soid) {
  const out = {};
  out.deliveries = plain((await q(`SELECT h.SOID, RTRIM(h.DocuNo) AS DocuNo, RTRIM(h.DocuStatus) AS St,
      CAST(h.SumGoodAmnt AS decimal(19,2)) AS SumGood, CAST(h.BillDiscAmnt AS decimal(19,2)) AS BillDisc,
      CAST(h.NetAmnt AS decimal(19,2)) AS Net, CAST(h.VATAmnt AS decimal(19,2)) AS Vat
    FROM dbo.SOHD h WITH (NOLOCK) WHERE h.DocuType = 104 AND EXISTS (SELECT 1 FROM dbo.SODT d WITH (NOLOCK) WHERE d.SOID = h.SOID AND d.RefSOID = @soid)`, { soid })).recordset);
  out.controlTickets = plain((await q(`SELECT c.CouponID, RTRIM(c.CouponNo) AS CouponNo, CAST(c.GoodQty AS decimal(12,4)) AS Qty, CAST(c.RemaQty AS decimal(12,4)) AS Remaining
    FROM dbo.WFCoupon c WITH (NOLOCK) WHERE c.DocuID IN (SELECT h.SOID FROM dbo.SOHD h WITH (NOLOCK) WHERE h.DocuType = 104
      AND EXISTS (SELECT 1 FROM dbo.SODT d WITH (NOLOCK) WHERE d.SOID = h.SOID AND d.RefSOID = @soid))`, { soid })).recordset);
  out.transportSlips = plain((await q(`SELECT rh.RedemtionID, RTRIM(rh.DocuNo) AS DocuNo, CAST(rd.GoodQty AS decimal(12,4)) AS Qty
    FROM dbo.WFRedemtionDT rd WITH (NOLOCK) JOIN dbo.WFRedemtionHD rh WITH (NOLOCK) ON rh.RedemtionID = rd.RedemtionID
    WHERE rd.CouponID IN (SELECT c.CouponID FROM dbo.WFCoupon c WITH (NOLOCK) WHERE c.DocuID IN (SELECT h.SOID FROM dbo.SOHD h WITH (NOLOCK)
      WHERE h.DocuType = 104 AND EXISTS (SELECT 1 FROM dbo.SODT d WITH (NOLOCK) WHERE d.SOID = h.SOID AND d.RefSOID = @soid)))`, { soid })).recordset);
  try {
    const { resolveNativeDocumentChain } = require(path.join(CAND, 'services/native-document-resolver'));
    const chain = await resolveNativeDocumentChain({ entityType: 'SO', exactId: String(soid) });
    const ids = [...new Set((chain?.chain?.invoices || []).map(i => Number(i.soInvId)).filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, 20);
    out.resolver = { resolved: Boolean(chain?.resolved), invoices: ids.length, truncated: Boolean(chain?.truncated) };
    if (ids.length) {
      const rows = (await q(`SELECT * FROM dbo.SOInvHD WITH (NOLOCK) WHERE SOInvID IN (${ids.join(',')})`)).recordset || [];
      out.invoices = plain(rows.map(r => Object.fromEntries(Object.entries(r).filter(([k, v]) => v != null &&
        /^(SOInvID|DocuNo|DocuType|DocuDate|DocuStatus|SumGoodAmnt|BillDiscAmnt|NetAmnt|RemaAmnt|VATAmnt|PostGL|PostID|StockEffc)$/i.test(k)))));
    }
  } catch (e) { out.resolver = { error: String(e.message || e).slice(0, 160) }; }
  return out;
}

async function runCase(q, tx, c, epoch, startDate) {
  const facts = await bookingFacts(q, c.soid);
  if (!facts) { step(`${c.name}.booking`, { pass: false, reason: 'not found' }); return; }
  step(`${c.name}.booking`, { pass: true, soid: facts.SOID, status: facts.St, qtyTon: facts.Qty, price: facts.Price, lineAmount: facts.LineAmnt,
    billDiscount: facts.BillDisc, net: facts.Net, existingReceipts: Number(facts.ExistingReceipts) });
  const base = { user: USER, bookingId: c.soid, lineNo: 1, startDate };
  const redeem = (over = {}, options = {}) => applyTicketRedemption(q, { ...base, requestedTonnage: facts.Qty, requestId: crypto.randomUUID(), treatment: c.treatment, ...over },
    { epoch, verifyFinancialTreatment: verifyTicketTreatmentShape, ...options });

  if (Number(facts.ExistingReceipts) > 0) {
    // The booking was used by an earlier rehearsal whose receipt is immutable.
    await expectFail(`${c.name}.second-redemption-of-used-booking`, () => redeem(), ['TICKET_REDEMPTION_CONFLICT', 'TICKET_LEGACY_PROOF_UNAVAILABLE']);
    await expectFail(`${c.name}.edit-guard-on-used-booking`, () => assertNoRedeemedTicketForBooking(tx, { Id: c.soid, ImportedDocuNo: facts.DocuNo }), ['TICKET_REDEMPTION_LINKED']);
    return;
  }

  try { await assertNoRedeemedTicketForBooking(tx, { Id: c.soid, ImportedDocuNo: facts.DocuNo }); step(`${c.name}.edit-guard-before`, { pass: true, note: 'booking may still be edited' }); }
  catch (e) { step(`${c.name}.edit-guard-before`, { pass: false, code: e.code }); }

  const wrongShape = await inspectTicketTreatmentShape(q, { bookingId: c.soid, lineNo: 1, requestedTonnage: facts.Qty }, c.wrong);
  step(`${c.name}.shape-check-wrong-treatment`, { pass: wrongShape.ok === false, reason: wrongShape.reason });
  await expectFail(`${c.name}.reject-wrong-treatment`, () => redeem({ treatment: c.wrong }), ['TICKET_FINANCIAL_PROOF_UNAVAILABLE']);
  await expectFail(`${c.name}.reject-partial-line`, () => redeem({ requestedTonnage: '0.3000' }), ['TICKET_FINANCIAL_PROOF_UNAVAILABLE']);
  await expectFail(`${c.name}.reject-more-than-line`, () => redeem({ requestedTonnage: '0.7000' }), ['TICKET_BOOKING_QUANTITY_INVALID']);
  await expectFail(`${c.name}.reject-without-verifier`, () => redeem({}, { verifyFinancialTreatment: undefined }), ['TICKET_FINANCIAL_PROOF_UNAVAILABLE']);
  await expectFail(`${c.name}.reject-booking-before-data-start`, () => redeem({ startDate: '2027-01-01' }), ['TICKET_BOOKING_NOT_FOUND']);
  const untouched = await counts(q);
  step(`${c.name}.nothing-written-by-rejections`, { pass: Number(untouched.Receipts) === Number(c.before.Receipts) && String(untouched.RemainingTons) === String(c.before.RemainingTons),
    receipts: Number(untouched.Receipts), remainingTons: String(untouched.RemainingTons) });

  const requestId = crypto.randomUUID();
  let first;
  try {
    first = await redeem({ requestId });
    step(`${c.name}.redeem`, { pass: first.replayed === false && first.allocations.length > 0, receiptId: first.id, replayed: first.replayed,
      allocations: first.allocations.map(a => `${a.quantityTon} t: ${a.remainingBefore} -> ${a.remainingAfter} (${a.status})`) });
  } catch (e) {
    step(`${c.name}.redeem`, { pass: false, code: e.code || null, status: e.status || null, message: String(e.message).slice(0, 200), details: e.details || null });
    return;
  }
  const again = await redeem({ requestId });
  step(`${c.name}.replay-same-request`, { pass: again.replayed === true && again.id === first.id, replayed: again.replayed, sameReceipt: again.id === first.id });
  await expectFail(`${c.name}.reject-new-request-same-line`, () => redeem(), ['TICKET_REDEMPTION_CONFLICT']);
  await expectFail(`${c.name}.reject-same-request-other-user`, () => redeem({ requestId, user: { ...USER, sub: OTHER_USER_ID, id: OTHER_USER_ID } }), ['TICKET_REDEMPTION_CONFLICT']);

  const receipt = (await q(`SELECT Id, BookingSOID, BookingLineNo, CustId, GoodId, CAST(QuantityTon AS decimal(14,4)) AS QuantityTon, Treatment,
      LEN(NativeFingerprint) AS FingerprintLength, ActorPrimaryId, EffectivePrimaryId, ActorBusinessId, EffectiveBusinessId
    FROM wf.RebateTicketRedemptionReceipt WHERE Id = @id`, { id: first.id })).recordset[0];
  const history = (await q(`SELECT TicketId, SoId, RedemptionOrder, CAST(RedeemedTonnage AS decimal(14,4)) AS Tons, CAST(RemainingBefore AS decimal(14,4)) AS Before,
      CAST(RemainingAfter AS decimal(14,4)) AS After, RedeemedByUserId FROM wf.TicketRedemptionHistory WHERE SoId = @soid ORDER BY RedemptionOrder`, { soid: c.soid })).recordset;
  const allocated = (await q(`SELECT CAST(ISNULL(SUM(QuantityTon),0) AS decimal(14,4)) AS Tons, COUNT(*) AS N FROM wf.RebateTicketRedemptionAllocation WHERE ReceiptId = @id`, { id: first.id })).recordset[0];
  step(`${c.name}.receipt`, { pass: receipt && receipt.Treatment === c.treatment && Number(receipt.QuantityTon) === Number(facts.Qty) && Number(receipt.FingerprintLength) === 64 &&
      Number(allocated.Tons) === Number(facts.Qty) && history.length === Number(allocated.N) && Number(receipt.ActorPrimaryId) === USER.sub,
    treatment: receipt?.Treatment, quantityTon: String(receipt?.QuantityTon), allocations: Number(allocated.N), allocatedTons: String(allocated.Tons),
    historyRows: history.length, actor: receipt?.ActorPrimaryId, effective: receipt?.EffectivePrimaryId });
  await expectFail(`${c.name}.edit-guard-after`, () => assertNoRedeemedTicketForBooking(tx, { Id: c.soid, ImportedDocuNo: facts.DocuNo }), ['TICKET_REDEMPTION_LINKED']);
  c.receiptId = first.id;
}

(async () => {
  const window = await db.runWithTarget('onprem', () => readGlobalDataWindow(), SESSION_DB);
  report.dataStart = window.businessDate;
  await db.runWithTarget('onprem', async () => {
    const read = (text, inputs) => db.wfQuery(text, Object.fromEntries(Object.entries(inputs || {}).map(([k, v]) => [k, { type: db.sql.Int, value: v }])));
    const before = await counts(read);
    report.before = before;
    console.log('BEFORE ' + JSON.stringify(before));
    for (const c of CASES) {
      c.before = before;
      const d = await downstream(read, c.soid);
      report[`downstream_${c.name}`] = d;
      console.log(`DOWNSTREAM ${c.name} ` + JSON.stringify(d));
    }
    let fenceEpoch = null;
    try {
      await withRebateOperationFence(async epoch => {
        fenceEpoch = { generation: Number(epoch.generation), environment: epoch.environment || null };
        if (MODE !== 'run') return;
        try {
          await db.wfTransaction(async tx => {
            const q = transactionQuery(tx, db.sql);
            const facts = await bookingFacts(q, CASES[0].soid) || await bookingFacts(q, CASES[1].soid);
            const today = (await q("SELECT CONVERT(char(10), DATEADD(hour,7,GETUTCDATE()), 120) AS D, CONVERT(char(10), DATEADD(day,30,DATEADD(hour,7,GETUTCDATE())), 120) AS D30, CONVERT(char(10), DATEADD(day,90,DATEADD(hour,7,GETUTCDATE())), 120) AS D90")).recordset[0];
            // Before any usable ticket exists: no balance, and an expired ticket must not count.
            const pre = CASES[1], preFacts = await bookingFacts(q, pre.soid);
            if (preFacts && Number(preFacts.ExistingReceipts) === 0) {
              const attempt = () => applyTicketRedemption(q, { user: USER, bookingId: pre.soid, lineNo: 1, startDate: window.businessDate,
                requestedTonnage: preFacts.Qty, requestId: crypto.randomUUID(), treatment: pre.treatment }, { epoch, verifyFinancialTreatment: verifyTicketTreatmentShape });
              await expectFail('reject-when-balance-too-small', attempt, ['INSUFFICIENT_TICKET_BALANCE']);
              const old = (await q("SELECT CONVERT(char(10), DATEADD(day,-100,DATEADD(hour,7,GETUTCDATE())), 120) AS Issued, CONVERT(char(10), DATEADD(day,-10,DATEADD(hour,7,GETUTCDATE())), 120) AS Expiry")).recordset[0];
              await q(`INSERT wf.FertilizerTicket (TicketNo, ConversionId, CustId, CustName, GoodId, GoodCode, GoodName, Oct31ReferencePrice, ConvertedRebateAmount,
                  IssuedTonnage, RemainingTonnage, IssuedDate, ExpiryDate, Status, CreatedByUserId)
                VALUES ('UAT-SIM-CLAUDE-RH-EXPIRED', NULL, @cust, N'UAT SIMULATED EXPIRED TICKET - REHEARSAL ONLY', @good, @code, @name, 17500, 87500, 5, 5, @issued, @expiry, 'ACTIVE', @uid)`,
              { cust: Number(preFacts.CustID), good: Number(preFacts.GoodID), code: String(preFacts.GoodCode || 'UAT'), name: String(preFacts.GoodName || 'UAT'), issued: old.Issued, expiry: old.Expiry, uid: USER.sub });
              await expectFail('reject-expired-ticket-5-tons', attempt, ['INSUFFICIENT_TICKET_BALANCE']);
            }
            // Simulated issue of two tickets, 1 ton each, labelled. T1 expires first so FIFO must use it first.
            for (const [no, expiry] of [['UAT-SIM-CLAUDE-RH-T1', today.D30], ['UAT-SIM-CLAUDE-RH-T2', today.D90]]) {
              await q(`INSERT wf.FertilizerTicket (TicketNo, ConversionId, CustId, CustName, GoodId, GoodCode, GoodName, Oct31ReferencePrice, ConvertedRebateAmount,
                  IssuedTonnage, RemainingTonnage, IssuedDate, ExpiryDate, Status, CreatedByUserId)
                VALUES (@no, NULL, @cust, N'UAT SIMULATED TICKET - REHEARSAL ONLY', @good, @code, @name, 17500, 17500, 1, 1, @issued, @expiry, 'ACTIVE', @uid)`,
              { no, cust: Number(facts.CustID), good: Number(facts.GoodID), code: String(facts.GoodCode || 'UAT'), name: String(facts.GoodName || 'UAT'), issued: today.D, expiry, uid: USER.sub });
            }
            const afterIssue = await counts(q);
            step('simulated-issue', { pass: Number(afterIssue.Tickets) >= Number(before.Tickets) + 2, tickets: Number(afterIssue.Tickets), remainingTons: String(afterIssue.RemainingTons), expiries: [today.D30, today.D90] });
            for (const c of CASES) { c.before = await counts(q); await runCase(q, tx, c, epoch, window.businessDate); }
            const sim = (await q(`SELECT TicketNo, CAST(RemainingTonnage AS decimal(14,4)) AS Remaining, Status FROM wf.FertilizerTicket WHERE TicketNo LIKE 'UAT-SIM-CLAUDE-RH-%' ORDER BY TicketNo`)).recordset;
            const expired = sim.find(t => /EXPIRED$/.test(t.TicketNo));
            step('simulated-tickets-after', { pass: !expired || Number(expired.Remaining) === 5, tickets: sim.map(t => `${t.TicketNo.replace('UAT-SIM-CLAUDE-RH-', '')} ${t.Remaining} ${t.Status}`) });
            report.insideTransaction = await counts(q);
            console.log('INSIDE ' + JSON.stringify(report.insideTransaction));
            // Last on purpose: if the trigger's error were to end the transaction, nothing after it is lost.
            const made = CASES.map(c => c.receiptId).filter(Boolean);
            if (made.length) await expectFail('receipt-is-immutable', async () => {
              try { await q('DELETE wf.RebateTicketRedemptionReceipt WHERE Id = @id', { id: made[made.length - 1] }); }
              catch (e) { throw Object.assign(new Error(String(e.message).slice(0, 80)), { code: /immutable/i.test(String(e.message)) ? 'IMMUTABLE' : (e.code || 'OTHER') }); }
            }, ['IMMUTABLE']);
            throw ROLLBACK;
          });
        } catch (e) { if (e !== ROLLBACK) { report.transactionError = { code: e.code || null, message: String(e.message || e).slice(0, 300) }; console.log('TXERROR ' + JSON.stringify(report.transactionError)); } }
      });
    } catch (e) { report.fenceError = { code: e.code || null, message: String(e.message || e).slice(0, 200) }; console.log('FENCEERROR ' + JSON.stringify(report.fenceError)); }
    report.fence = fenceEpoch;
    console.log('FENCE ' + JSON.stringify(fenceEpoch));
    const after = await counts(read);
    report.after = after;
    const leftovers = (await read("SELECT COUNT(*) AS N FROM wf.FertilizerTicket WHERE TicketNo LIKE 'UAT-SIM-CLAUDE-RH-%'")).recordset[0].N;
    report.rolledBack = JSON.stringify(after) === JSON.stringify(before) && Number(leftovers) === 0;
    console.log('AFTER ' + JSON.stringify(after) + ` leftovers=${leftovers} rolledBack=${report.rolledBack}`);
  }, SESSION_DB);
  const failed = report.steps.filter(s => s.pass === false).map(s => s.name);
  console.log(`SUMMARY mode=${MODE} steps=${report.steps.length} failed=${failed.length} ${failed.join(',')} rolledBack=${report.rolledBack}`);
  try { await db.closeAll(); } catch (_) {}
  process.exit(failed.length || report.rolledBack !== true ? 1 : 0);
})().catch(async e => {
  console.log('REHEARSAL_FAILED ' + (e.code || '') + ' ' + String(e.stack || e.message || e).slice(0, 500));
  try { await db.closeAll(); } catch (_) {}
  process.exit(1);
});
