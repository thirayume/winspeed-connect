/**
 * recon.js — Reconciliation Workbench (FR-027)
 * กระทบยอด shipped SO ↔ WINSpeed invoice (dbo.SOInvHD) ↔ TruckScale weigh (MySQL)
 *   - case คำนวณสด · degrade ได้ถ้า TruckScale ล่ม
 *   - คนตัดสิน exception ผ่าน wf.ReconResolution (resolve/ignore + owner)
 * เขียนเฉพาะ wf (ReconResolution) · อ่าน dbo/MySQL
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { getPool, tsQuery } = require('../services/truckscale-db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

const WEIGH_TOL_KG = 50; // ผลต่างน้ำหนักที่ยอมรับ

async function buildCases(days) {
  const rows = (await wfQuery(`
    SELECT TOP 500 so.Id AS SoId, so.WfRef, so.CustName, so.TruckPlate,
           CONVERT(VARCHAR(10), so.CreatedAt, 120) AS ShipDate,
           so.ImportedDocuNo AS WsDocuNo,
           wt.NetKg, wt.Movebill, wt.ScaleNo,
           inv.SOInvID AS WsInvoiceId,
           inv.DocuNo AS WsInvoiceNo,
           inv.DocuDate AS WsInvoiceDate,
           inv.DocuType AS WsInvoiceType,
           inv.PostID AS WsPostId
    FROM wf.v_AllSalesOrders so
    LEFT JOIN wf.WeighTicket wt ON wt.SoId = so.Id
    OUTER APPLY (
      SELECT TOP 1 h.SOInvID, h.DocuNo, h.DocuDate, h.DocuType, h.PostID
      FROM dbo.SOInvHD h WITH (NOLOCK)
      WHERE h.DocuType IN (107, 202)
        AND (
          h.SOInvID IN (
            SELECT d.SOInvID
            FROM dbo.SOInvDT d WITH (NOLOCK)
            WHERE CONVERT(varchar(50), d.RefID) = CONVERT(varchar(50), so.Id)
          )
          OR CONVERT(varchar(50), h.RefSOID) = CONVERT(varchar(50), so.Id)
          OR h.SONo = so.ImportedDocuNo
        )
      ORDER BY h.DocuDate DESC, h.SOInvID DESC
    ) inv
    WHERE so.Status = 'SHIPPED' AND so.CreatedAt >= DATEADD(day, -@d, GETDATE())
    ORDER BY so.CreatedAt DESC
  `, { d: { type: sql.Int, value: Number(days) || 7 } })).recordset || [];

  // TruckScale net by movebill (batch, degrade ถ้าล่ม)
  let tsMap = {}, tsAvailable = true;
  const movebills = [...new Set(rows.map(r => r.Movebill).filter(Boolean))];
  if (movebills.length && getPool()) {
    try {
      const placeholders = movebills.map(() => '?').join(',');
      const ts = await tsQuery(`SELECT movebill, weight_net FROM tblscale WHERE movebill IN (${placeholders})`, movebills);
      for (const t of ts) tsMap[String(t.movebill)] = Number(t.weight_net);
    } catch { tsAvailable = false; }
  } else if (!getPool()) { tsAvailable = false; }

  // resolutions
  const resRows = (await wfQuery(`SELECT SoId, CheckType, Status, Note FROM wf.ReconResolution`)).recordset || [];
  const resMap = {};
  for (const r of resRows) resMap[`${r.SoId}|${r.CheckType}`] = { status: r.Status, note: r.Note };

  return rows.map(r => {
    const netApp = r.NetKg != null ? Number(r.NetKg) : null;
    // WEIGH check
    let weigh;
    if (netApp == null) weigh = 'NO_WEIGH';
    else if (!r.Movebill) weigh = 'UNLINKED';
    else if (!tsAvailable) weigh = 'TS_UNAVAILABLE';
    else if (tsMap[String(r.Movebill)] == null) weigh = 'TS_NOT_FOUND';
    else weigh = Math.abs(netApp - tsMap[String(r.Movebill)]) <= WEIGH_TOL_KG ? 'MATCHED' : 'VARIANCE';
    // INVOICE check
    const invoice = r.WsInvoiceNo ? 'MATCHED' : 'PENDING';
    const postInvoiceStatus = r.WsInvoiceNo ? 'POSTED' : 'READY';

    const wRes = resMap[`${r.SoId}|WEIGH`];
    const iRes = resMap[`${r.SoId}|INVOICE`];
    const isExc = (s) => ['VARIANCE', 'TS_NOT_FOUND', 'NO_WEIGH', 'PENDING'].includes(s);
    const weighOpen = isExc(weigh) && !wRes;
    const invoiceOpen = isExc(invoice) && !iRes;

    return {
      soId: r.SoId, wfRef: r.WfRef, custName: r.CustName, truckPlate: r.TruckPlate,
      shipDate: r.ShipDate, wsDocuNo: r.WsDocuNo, wsInvoiceNo: r.WsInvoiceNo,
      wsInvoiceId: r.WsInvoiceId || null,
      wsInvoiceDate: r.WsInvoiceDate || null,
      wsInvoiceType: r.WsInvoiceType || null,
      wsPostId: r.WsPostId || null,
      postInvoiceStatus,
      readyForPostInvoice: postInvoiceStatus === 'READY',
      netApp, netTs: r.Movebill ? (tsMap[String(r.Movebill)] ?? null) : null,
      variance: (netApp != null && r.Movebill && tsMap[String(r.Movebill)] != null) ? Math.round(netApp - tsMap[String(r.Movebill)]) : null,
      movebill: r.Movebill, scaleNo: r.ScaleNo,
      weigh, invoice,
      weighResolution: wRes || null, invoiceResolution: iRes || null,
      overall: (weighOpen || invoiceOpen) ? 'EXCEPTION' : ((wRes || iRes) ? 'RESOLVED' : 'OK'),
      tsAvailable,
    };
  });
}

// GET /api/recon/summary?days=
router.get('/summary', async (req, res) => {
  try {
    const cases = await buildCases(req.query.days);
    const summary = {
      total: cases.length,
      ok: cases.filter(c => c.overall === 'OK').length,
      exception: cases.filter(c => c.overall === 'EXCEPTION').length,
      resolved: cases.filter(c => c.overall === 'RESOLVED').length,
      readyForPostInvoice: cases.filter(c => c.postInvoiceStatus === 'READY').length,
      postedInvoice: cases.filter(c => c.postInvoiceStatus === 'POSTED').length,
      tsAvailable: cases[0]?.tsAvailable ?? true,
    };
    res.json(summary);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/recon/cases?days=&status=
router.get('/cases', async (req, res) => {
  try {
    let cases = await buildCases(req.query.days);
    if (req.query.status) cases = cases.filter(c => c.overall === req.query.status);
    res.json(cases);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/recon/:soId/resolve  { checkType, action, note }
router.post('/:soId/resolve', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { checkType, action, note, wfRef } = req.body || {};
    if (!['WEIGH', 'INVOICE'].includes(checkType)) return res.status(400).json({ message: 'checkType ไม่ถูกต้อง' });
    const status = action === 'IGNORE' ? 'IGNORED' : 'RESOLVED';
    await wfQuery(`
      MERGE wf.ReconResolution AS t
      USING (SELECT @so AS SoId, @ct AS CheckType) AS s ON t.SoId=s.SoId AND t.CheckType=s.CheckType
      WHEN MATCHED THEN UPDATE SET Status=@st, Note=@note, ResolvedBy=@uid, ResolvedAt=GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (SoId, WfRef, CheckType, Status, Note, ResolvedBy)
        VALUES (@so, @ref, @ct, @st, @note, @uid);`,
      {
        so:  { type: sql.NVarChar(50),  value: String(req.params.soId) },
        ref: { type: sql.NVarChar(30),  value: wfRef || null },
        ct:  { type: sql.NVarChar(20),  value: checkType },
        st:  { type: sql.NVarChar(20),  value: status },
        note:{ type: sql.NVarChar(500), value: note || null },
        uid: { type: sql.Int,           value: req.user.sub },
      });
    res.json({ soId: req.params.soId, checkType, status });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
