'use strict';
// Read-only check that what Sale-App counts for giveaways and Rebate still agrees with the WinSpeed documents
// it rests on (owner, 21 Nov 2026: "Winspeed และ WF-SaleApp ข้อมูลถูกต้อง ตรงกัน 100%"). Runs on every company
// database of this environment (the reviewed manifest, as for Set Zero and Rebate Reset). Writes nothing.
//
// Giveaway (the counting period that started at the latest Set Zero):
//   usageOnCancelledBill  usage still counted for a booking (103) that WinSpeed cancelled or no longer has
//   billWithoutUsage      a live booking with a giveaway line but no usage recorded for it
//   piecesMismatch        pieces on the bill differ from the pieces counted as usage
// Rebate (the current reset generation of that database):
//   lotSourceChanged      a lot whose 116 line was cancelled, removed or changed tonnage in WinSpeed
//   lotOrderCancelled     a lot whose sales order (104) was cancelled or removed
//   useOnCancelledBooking ticket use whose booking (103) was cancelled, removed, or now carries less than was used
// Each list holds at most SAMPLE rows with the WinSpeed document number so accounting can open it.
const SAMPLE = 50;
const { companyTargets } = require('./giveaway-set-zero');

const GIVEAWAY_SQL = `
DECLARE @zeroAt datetime2 = ISNULL((SELECT MAX(ZeroAt) FROM wf.GiveawayZeroLog), CONVERT(datetime2, '1900-01-01'));
SELECT 'usageOnCancelledBill' AS Issue, CONVERT(varchar(20), w.SoId) AS Ref, RTRIM(h.DocuNo) AS DocuNo,
       CAST(SUM(w.Qty) AS decimal(18,2)) AS AppQty, CAST(NULL AS decimal(18,2)) AS WinspeedQty,
       CASE WHEN h.SOID IS NULL THEN N'ไม่พบใบจองใน WinSpeed' ELSE N'ใบจองถูกยกเลิกใน WinSpeed' END AS Detail
FROM wf.GiveawayWithdrawal w
LEFT JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = w.SoId AND h.DocuType = 103
WHERE w.SoId IS NOT NULL AND w.CreatedAt >= @zeroAt AND (h.SOID IS NULL OR h.DocuStatus = 'C')
GROUP BY w.SoId, h.DocuNo, h.SOID
UNION ALL
SELECT 'billWithoutUsage', CONVERT(varchar(20), h.SOID), RTRIM(h.DocuNo), CAST(0 AS decimal(18,2)), CAST(SUM(gw.GiveawayPieces) AS decimal(18,2)),
       N'บิลมีของแถมแต่ไม่ได้ตัดโควต้า'
FROM wf.SalesOrderLineExt gw
JOIN dbo.SOHD h WITH (NOLOCK) ON CONVERT(varchar(50), h.SOID) = gw.SOID AND h.DocuType = 103
WHERE gw.IsGiveaway = 1 AND ISNULL(gw.GiveawayPieces, 0) > 0 AND ISNULL(h.DocuStatus, '') <> 'C' AND h.DocuDate >= @windowStart
  AND NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal w WHERE w.SoId = h.SOID)
GROUP BY h.SOID, h.DocuNo
UNION ALL
SELECT 'piecesMismatch', CONVERT(varchar(20), h.SOID), RTRIM(h.DocuNo), CAST(u.Qty AS decimal(18,2)), CAST(p.Pieces AS decimal(18,2)),
       N'จำนวนชิ้นในบิลไม่เท่ายอดที่ตัดโควต้า'
FROM (SELECT gw.SOID, SUM(gw.GiveawayPieces) AS Pieces FROM wf.SalesOrderLineExt gw
      WHERE gw.IsGiveaway = 1 AND ISNULL(gw.GiveawayPieces, 0) > 0 GROUP BY gw.SOID) p
JOIN dbo.SOHD h WITH (NOLOCK) ON CONVERT(varchar(50), h.SOID) = p.SOID AND h.DocuType = 103 AND ISNULL(h.DocuStatus, '') <> 'C'
JOIN (SELECT w.SoId, SUM(w.Qty) AS Qty FROM wf.GiveawayWithdrawal w WHERE w.SoId IS NOT NULL GROUP BY w.SoId) u ON u.SoId = h.SOID
WHERE h.DocuDate >= @windowStart AND u.Qty <> p.Pieces`;

const GIVEAWAY_TOTALS_SQL = `
DECLARE @zeroAt datetime2 = ISNULL((SELECT MAX(ZeroAt) FROM wf.GiveawayZeroLog), CONVERT(datetime2, '1900-01-01'));
SELECT (SELECT COUNT(*) FROM wf.GiveawayWithdrawal WHERE CreatedAt >= @zeroAt) AS UsageRows,
       (SELECT ISNULL(SUM(Qty),0) FROM wf.GiveawayWithdrawal WHERE CreatedAt >= @zeroAt) AS UsageQty,
       (SELECT ISNULL(SUM(WithdrawnQty),0) FROM wf.v_GiveawayBudgetStatus) AS CountedQty,
       CASE WHEN @zeroAt > '1900-01-02' THEN @zeroAt END AS ZeroAt`;

const REBATE_SQL = `
DECLARE @env varchar(16), @reset uniqueidentifier, @gen int;
SELECT TOP 1 @env = EnvironmentKind, @reset = ResetId, @gen = Generation FROM wf.RebateResetParticipant;
SELECT 'lotSourceChanged' AS Issue, CONVERT(varchar(20), a.Id) AS Ref, RTRIM(rh.DocuNo) AS DocuNo,
       CAST(a.QuantityTon AS decimal(18,3)) AS AppQty, CAST(rd.GoodQty AS decimal(18,3)) AS WinspeedQty,
       CASE WHEN rh.RedemtionID IS NULL OR rd.RedemtionID IS NULL THEN N'ไม่พบใบตัดตั๋ว (116) ใน WinSpeed'
            WHEN rh.DocuStatus = 'C' THEN N'ใบตัดตั๋ว (116) ถูกยกเลิก' ELSE N'จำนวนตันใน 116 เปลี่ยน' END AS Detail
FROM wf.RebateShipmentAccrual a
JOIN wf.RebateShipmentEvidence e ON e.Id = a.EvidenceId
LEFT JOIN dbo.WFRedemtionHD rh WITH (NOLOCK) ON rh.RedemtionID = e.RedemptionId
LEFT JOIN dbo.WFRedemtionDT rd WITH (NOLOCK) ON rd.RedemtionID = e.RedemptionId AND rd.Listno = e.RedemptionListNo
WHERE a.EnvironmentKind = @env AND a.ResetId = @reset AND a.Generation = @gen
  AND (rh.RedemtionID IS NULL OR rd.RedemtionID IS NULL OR rh.DocuStatus = 'C'
       OR CAST(rd.GoodQty AS decimal(18,3)) <> CAST(a.QuantityTon AS decimal(18,3)))
UNION ALL
SELECT 'lotOrderCancelled', CONVERT(varchar(20), a.Id), RTRIM(h.DocuNo), CAST(a.QuantityTon AS decimal(18,3)), CAST(NULL AS decimal(18,3)),
       CASE WHEN h.SOID IS NULL THEN N'ไม่พบใบสั่งขาย (104)' ELSE N'ใบสั่งขาย (104) ถูกยกเลิก' END
FROM wf.RebateShipmentAccrual a
LEFT JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = a.SourceSOID AND h.DocuType = 104
WHERE a.EnvironmentKind = @env AND a.ResetId = @reset AND a.Generation = @gen AND (h.SOID IS NULL OR h.DocuStatus = 'C')
UNION ALL
SELECT 'useOnCancelledBooking', CONVERT(varchar(20), r.Id), RTRIM(h.DocuNo), CAST(r.QuantityTon AS decimal(18,3)), CAST(d.GoodQty2 AS decimal(18,3)),
       CASE WHEN h.SOID IS NULL OR d.SOID IS NULL THEN N'ไม่พบใบจอง (103) หรือบรรทัด'
            WHEN h.DocuStatus = 'C' THEN N'ใบจอง (103) ถูกยกเลิก' ELSE N'บรรทัดใบจองเหลือน้อยกว่าที่ใช้ตั๋ว' END
FROM wf.RebateTicketRedemptionReceipt r
LEFT JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = r.BookingSOID AND h.DocuType = 103
LEFT JOIN dbo.SODT d WITH (NOLOCK) ON d.SOID = r.BookingSOID AND d.ListNo = r.BookingLineNo
-- Owner, 22 Nov 2026 (migration 258): a ticket given back when its 103 was cancelled (RELEASED) is not a mismatch.
WHERE NOT EXISTS (SELECT 1 FROM wf.RebateTicketReceiptState st WITH (NOLOCK) WHERE st.ReceiptId = r.Id AND st.Status = 'RELEASED')
  AND (h.SOID IS NULL OR d.SOID IS NULL OR h.DocuStatus = 'C' OR d.GoodQty2 < r.QuantityTon)`;

const REBATE_TOTALS_SQL = `
DECLARE @env varchar(16), @reset uniqueidentifier, @gen int;
SELECT TOP 1 @env = EnvironmentKind, @reset = ResetId, @gen = Generation FROM wf.RebateResetParticipant;
SELECT @gen AS Generation,
       (SELECT COUNT(*) FROM wf.RebateShipmentAccrual WHERE EnvironmentKind = @env AND ResetId = @reset AND Generation = @gen) AS Lots,
       (SELECT ISNULL(SUM(QuantityTon),0) FROM wf.RebateShipmentAccrual WHERE EnvironmentKind = @env AND ResetId = @reset AND Generation = @gen) AS LotTon,
       (SELECT ISNULL(SUM(AmountBaht),0) FROM wf.RebateShipmentAccrual WHERE EnvironmentKind = @env AND ResetId = @reset AND Generation = @gen) AS LotBaht,
       (SELECT COUNT(*) FROM wf.RebateTicketRedemptionReceipt) AS TicketUses,
       (SELECT COUNT(*) FROM wf.RebatePlan) AS Plans`;

function group(rows) {
  const out = {};
  for (const r of rows) {
    const list = (out[r.Issue] ||= { count: 0, sample: [] });
    list.count += 1;
    if (list.sample.length < SAMPLE) list.sample.push({ ref: r.Ref, docuNo: r.DocuNo || null, appQty: r.AppQty == null ? null : Number(r.AppQty),
      winspeedQty: r.WinspeedQty == null ? null : Number(r.WinspeedQty), detail: r.Detail });
  }
  return out;
}

const GIVEAWAY_ISSUES = ['usageOnCancelledBill', 'billWithoutUsage', 'piecesMismatch'];
const REBATE_ISSUES = ['lotSourceChanged', 'lotOrderCancelled', 'useOnCancelledBooking'];

async function checkDatabase(db, windowStart) {
  const q = async (text, inputs) => (await db.wfQuery(text, inputs)).recordset || [];
  const dbName = (await q('SELECT DB_NAME() AS Db'))[0].Db;
  const win = { windowStart: { type: db.sql.Date, value: windowStart } };
  const giveawayIssues = group(await q(GIVEAWAY_SQL, win));
  const g = (await q(GIVEAWAY_TOTALS_SQL))[0] || {};
  const rebateIssues = group(await q(REBATE_SQL));
  const r = (await q(REBATE_TOTALS_SQL))[0] || {};
  const fill = (issues, keys) => Object.fromEntries(keys.map(k => [k, issues[k] || { count: 0, sample: [] }]));
  const giveaway = { usageRows: Number(g.UsageRows || 0), usageQty: Number(g.UsageQty || 0), countedQty: Number(g.CountedQty || 0),
    zeroAt: g.ZeroAt || null, issues: fill(giveawayIssues, GIVEAWAY_ISSUES) };
  const rebate = { generation: r.Generation == null ? null : Number(r.Generation), lots: Number(r.Lots || 0), lotTon: Number(r.LotTon || 0),
    lotBaht: Number(r.LotBaht || 0), ticketUses: Number(r.TicketUses || 0), plans: Number(r.Plans || 0), issues: fill(rebateIssues, REBATE_ISSUES) };
  const issueCount = [...Object.values(giveaway.issues), ...Object.values(rebate.issues)].reduce((s, i) => s + i.count, 0);
  return { database: dbName, matches: issueCount === 0, issueCount, giveaway, rebate };
}

async function checkWinspeedSync({ env = process.env, db = require('../db'), resolveTargets, readWindow } = {}) {
  const windowStart = (await (readWindow || require('./global-data-window-store').readGlobalDataWindow)())?.businessDate;
  if (!require('./data-window').isValidStartDate(windowStart))
    throw Object.assign(new Error('อ่านวันเริ่มข้อมูลไม่ได้'), { code: 'SYNC_WINDOW_UNAVAILABLE', status: 503 });
  const out = [];
  for (const t of companyTargets(env, resolveTargets)) {
    out.push(await (t.local ? checkDatabase(db, windowStart) : db.runWithTarget('onprem', () => checkDatabase(db, windowStart), t.name)));
  }
  return { checkedAt: new Date().toISOString(), windowStart, matches: out.every(d => d.matches), databases: out };
}

module.exports = { checkWinspeedSync, GIVEAWAY_SQL, REBATE_SQL, GIVEAWAY_ISSUES, REBATE_ISSUES };
