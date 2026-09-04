/**
 * recon.js — Reconciliation Workbench (FR-027)
 * กระทบยอด shipped SO ↔ WINSpeed invoice (dbo.SOInvHD) ↔ TruckScale weigh (MySQL)
 *   - case คำนวณสด · degrade ได้ถ้า TruckScale ล่ม
 *   - คนตัดสิน exception ผ่าน wf.ReconResolution (resolve/ignore + owner)
 * เขียนเฉพาะ wf (ReconResolution) · อ่าน dbo/MySQL
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
// เดิมเทียบยอดกับตาราง tblscale ใน MySQL ของ TruckScale
// MySQL ถูกลบออกถาวรเมื่อ 04/09/2569 — ย้ายมาอ่าน dbo.WGHD ซึ่งเป็นแหล่งเดียวแล้ว
// dbo.WGHD มีครบทั้ง MoveBill · CarNo · WeightNet · DateOut จึงเทียบได้เหมือนเดิม
// และดีกว่าเดิมตรงที่อยู่ฐานเดียวกัน ไม่ต้องข้ามเครื่อง
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

const WEIGH_TOL_KG = 50; // ผลต่างน้ำหนักที่ยอมรับ

const isNum = (s) => /^\d+$/.test(String(s));
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * หาใบกำกับของ SO แบบ batched
 * เดิมใช้ OUTER APPLY ต่อแถว (correlated) -> 34 วินาที / timeout
 * ตอนนี้ยิง set-based 2 ครั้ง -> ~40ms โดยยังจับคู่ได้ครบ 3 ทางเหมือนเดิม
 */
async function lookupInvoices(rows) {
  const map = {};
  const ids = [...new Set(rows.map(r => String(r.SoId)).filter(isNum))];
  if (!ids.length) return map;

  // 2a) ทางหลัก: SOInvDT.RefID -> SOHD.SOID (ครอบคลุมเกือบทั้งหมด)
  const primary = (await wfQuery(`
    ;WITH m AS (
      SELECT d.RefID AS SoId, h.SOInvID, h.DocuNo, h.DocuDate, h.DocuType, h.PostID,
             ROW_NUMBER() OVER (PARTITION BY d.RefID ORDER BY h.DocuDate DESC, h.SOInvID DESC) rn
      FROM dbo.SOInvDT d WITH (NOLOCK)
      JOIN dbo.SOInvHD h WITH (NOLOCK) ON h.SOInvID = d.SOInvID AND h.DocuType IN (107, 202)
      WHERE d.RefID IN (${ids.map(quote).join(',')}))
    SELECT SoId, SOInvID, DocuNo, DocuDate, DocuType, PostID FROM m WHERE rn = 1`)).recordset || [];
  for (const x of primary) map[String(x.SoId)] = x;

  // 2b) fallback เฉพาะที่ยังไม่เจอ: RefSOID / SONo (สแกน SOInvHD ครั้งเดียว)
  const left = rows.filter(r => !map[String(r.SoId)]);
  if (left.length) {
    const lIds = left.map(r => String(r.SoId)).filter(isNum);
    const lNos = [...new Set(left.map(r => r.WsDocuNo).filter(Boolean))];
    const idL = lIds.length ? lIds.map(quote).join(',') : `''`;
    const noL = lNos.length ? lNos.map(quote).join(',') : `''`;
    const alt = (await wfQuery(`
      SELECT CAST(h.RefSOID AS VARCHAR(50)) AS BySoId, h.SONo, h.SOInvID, h.DocuNo, h.DocuDate, h.DocuType, h.PostID
      FROM dbo.SOInvHD h WITH (NOLOCK)
      WHERE h.DocuType IN (107, 202)
        AND (CAST(h.RefSOID AS VARCHAR(50)) IN (${idL}) OR h.SONo IN (${noL}))`)).recordset || [];
    for (const r of left) {
      const hit = alt.find(x => String(x.BySoId) === String(r.SoId) || (r.WsDocuNo && x.SONo === r.WsDocuNo));
      if (hit) map[String(r.SoId)] = hit;
    }
  }
  return map;
}

async function buildCases(days) {
  // 1) shipped SO — อ่าน dbo.SOHD ตรง ไม่ผ่าน wf.v_AllSalesOrders
  //    (view filter บน Status/CreatedAt ที่เป็น computed column -> full scan -> timeout)
  const rows = (await wfQuery(`
    SELECT TOP 500 CAST(hd.SOID AS VARCHAR(50)) AS SoId, ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
           hd.CustName, hd.TransRegistration AS TruckPlate,
           CONVERT(VARCHAR(10), hd.DocuDate, 120) AS ShipDate, hd.DocuNo AS WsDocuNo,
           wt.NetKg, wt.Movebill, wt.ScaleNo
    FROM dbo.SOHD hd WITH (NOLOCK)
    LEFT JOIN wf.SalesOrderExt ext ON ext.SOID = hd.SOID
    LEFT JOIN wf.WeighTicket wt ON wt.SoId = CAST(hd.SOID AS NVARCHAR(50))
    WHERE hd.DocuStatus = 'Y' AND hd.DocuDate >= DATEADD(day, -@d, GETDATE())
    ORDER BY hd.DocuDate DESC
  `, { d: { type: sql.Int, value: Number(days) || 7 } })).recordset || [];

  // 2) แนบข้อมูลใบกำกับ (batched)
  const invMap = await lookupInvoices(rows);
  for (const r of rows) {
    const i = invMap[String(r.SoId)];
    r.WsInvoiceId   = i?.SOInvID  ?? null;
    r.WsInvoiceNo   = i?.DocuNo   ?? null;
    r.WsInvoiceDate = i?.DocuDate ?? null;
    r.WsInvoiceType = i?.DocuType ?? null;
    r.WsPostId      = i?.PostID   ?? null;
  }

  // T6-03: จับคู่ด้วย MoveBill เป็นหลัก ถ้าไม่เจอค่อยถอยไปใช้ ทะเบียน + วันชั่งออก
  //
  // แหล่งข้อมูลคือ dbo.WGHD (อ่านอย่างเดียวในเส้นทางนี้)
  // ไม่ใช้ OLE date serial อีกแล้ว เพราะ WGHD.DateOut เป็น datetime ปกติ
  // จึงเทียบวันตรง ๆ ได้ ลดโอกาสพลาดจากการแปลงเลขวันที่
  let tsMap = {}, tsAvailable = true;
  const movebills = [...new Set(rows.map(r => r.Movebill).filter(Boolean))].map(String);

  try {
    if (movebills.length) {
      // สร้างตัวแปรทีละตัว ไม่ต่อสตริงค่าเข้า SQL
      const inputs = {};
      const names = movebills.map((mb, i) => {
        inputs[`mb${i}`] = { type: sql.VarChar(50), value: mb };
        return `@mb${i}`;
      });
      const ts = (await wfQuery(`
        SELECT RTRIM(w.MoveBill) AS MoveBill, w.WeightNet
        FROM dbo.WGHD w
        WHERE RTRIM(w.MoveBill) IN (${names.join(',')})`, inputs)).recordset || [];
      for (const t of ts) {
        tsMap[String(t.MoveBill)] = { net: Number(t.WeightNet), matchBy: 'movebill' };
      }
    }

    // ใบที่ยังจับคู่ไม่ได้ — ลองด้วยทะเบียนรถกับวันชั่งออก ยอมคลาดได้ 1 วัน
    const unmatched = rows.filter(r => !r.Movebill || tsMap[String(r.Movebill)] == null);
    const dates = unmatched.map(r => (r.ShipDate ? new Date(r.ShipDate) : null)).filter(Boolean);
    if (unmatched.length && dates.length) {
      const min = new Date(Math.min(...dates.map(d => d.getTime())) - 86400000);
      const max = new Date(Math.max(...dates.map(d => d.getTime())) + 86400000);
      const fallbackRows = (await wfQuery(`
        SELECT RTRIM(w.CarNo) AS CarNo, w.DateOut, w.WeightNet, RTRIM(w.MoveBill) AS MoveBill
        FROM dbo.WGHD w
        WHERE w.DateOut BETWEEN @min AND @max
        ORDER BY w.Id DESC`, {
          min: { type: sql.DateTime, value: min },
          max: { type: sql.DateTime, value: max },
        })).recordset || [];

      for (const r of unmatched) {
        if (!r.TruckPlate || !r.ShipDate) continue;
        const target = new Date(r.ShipDate).getTime();
        const hit = fallbackRows.find(t =>
          String(t.CarNo || '').trim() === String(r.TruckPlate || '').trim() &&
          t.DateOut && Math.abs(new Date(t.DateOut).getTime() - target) <= 86400000
        );
        if (hit) {
          tsMap[`plate:${r.SoId}`] = {
            net: Number(hit.WeightNet),
            matchBy: 'plate_date',
            fallbackMovebill: hit.MoveBill || null,
          };
        }
      }
    }
  } catch (e) {
    console.error('[recon] อ่าน dbo.WGHD ไม่สำเร็จ:', e.message);
    tsAvailable = false;
  }

  // resolutions
  const resRows = (await wfQuery(`SELECT SoId, CheckType, Status, Note FROM wf.ReconResolution`)).recordset || [];
  const resMap = {};
  for (const r of resRows) resMap[`${r.SoId}|${r.CheckType}`] = { status: r.Status, note: r.Note };

  return rows.map(r => {
    const netApp = r.NetKg != null ? Number(r.NetKg) : null;
    const tsHit = r.Movebill && tsMap[String(r.Movebill)] != null
      ? tsMap[String(r.Movebill)]
      : tsMap[`plate:${r.SoId}`];

    // WEIGH check
    let weigh;
    if (netApp == null) weigh = 'NO_WEIGH';
    else if (!tsAvailable) weigh = 'TS_UNAVAILABLE';
    else if (!tsHit) weigh = r.Movebill ? 'TS_NOT_FOUND' : 'UNLINKED';
    else weigh = Math.abs(netApp - tsHit.net) <= WEIGH_TOL_KG ? 'MATCHED' : 'VARIANCE';

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
      netApp,
      netTs: tsHit ? tsHit.net : null,
      tsMatchBy: tsHit ? tsHit.matchBy : null,
      tsFallbackMovebill: (tsHit && tsHit.fallbackMovebill) || null,
      variance: (netApp != null && tsHit) ? Math.round(netApp - tsHit.net) : null,
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
router.post('/:soId/resolve', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
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
