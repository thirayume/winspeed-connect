/**
 * papertrail.js — Paper Trail v2
 *  - Kanban board (SO 4 สถานะ) — อ่านจาก wf.v_AllSalesOrders
 *  - เอกสาร 4 สี + QR (FR-004): print สร้าง wf.PaperCopy ต่อสี + QR nonce
 *  - Scan tracking (FR-012/013): /scan เลื่อนสถานะกระดาษ + log wf.PaperScan + alert ใบหาย
 * ⚠ เขียนเฉพาะ wf — SO status เปลี่ยนผ่าน so.js เท่านั้น
 */
const router = require('express').Router();
const crypto = require('crypto');
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getVisibleScope, scopeFilter, inScope } = require('../services/visible-scope');
const { broadcast } = require('../services/socket');

router.use(requireAuth);

// Roles that handle the paper set (the Paper Trail menu). SALES prints its own bills from the trip window.
const PAPER_ROLES = ['COUNTER_SALES', 'WAREHOUSE', 'WEIGHBRIDGE', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN'];

// R12 O-4 (UAT batch 5, SHP-04): the paper set of a bill is visible only inside the user's own + team scope
async function paperInScope(user, soId) {
  const scope = await getVisibleScope(user);
  if (scope.all) return true;
  const row = (await wfQuery(`
    SELECT TOP 1 so.SalesUserId, CAST(h.EmpID AS VARCHAR(20)) AS EmpID
    FROM wf.v_AllSalesOrders so
    LEFT JOIN dbo.SOHD h WITH (NOLOCK) ON CAST(h.SOID AS VARCHAR(50)) = CAST(so.Id AS VARCHAR(50))
    WHERE so.Id = @id`, { id: { type: sql.VarChar(50), value: String(soId) } })).recordset[0];
  return Boolean(row) && (inScope(scope, { userId: row.SalesUserId }) || inScope(scope, { empId: row.EmpID }));
}
async function requirePaperInScope(req, res, next) {
  try {
    if (!(await paperInScope(req.user, req.params.soId))) return res.status(404).json({ message: 'ไม่พบ SO' });
    next();
  } catch (e) { res.status(500).json({ message: e.message }); }
}

const STAGES = ['DRAFT', 'CONFIRMED', 'PICKING', 'LOADED', 'SHIPPED', 'IMPORTED'];
// ใบจ่ายของ (ISSUE) 4 สี ตามเอกสารจริง
const ISSUE_COPIES = [
  { color: 'WHITE',  label: 'ต้นฉบับ (บัญชี)' },
  { color: 'BLUE',   label: 'สำเนา (เก็บ)' },
  { color: 'PINK',   label: 'ลูกค้า' },
  { color: 'GREEN',  label: 'รปภ. (ประตู)' },
];

// ── GET /api/papertrail/board ──────────────────────────────────
router.get('/board', async (req, res) => {
  try {
    // R12 O-4: SALES/MANAGER see their own + team bills; operational roles and ADMIN/C_LEVEL/ACCOUNTING see all
    const scope = await getVisibleScope(req.user);
    const sf = scopeFilter(scope, { userCol: 'SalesUserId', empCol: 'OwnerEmpId', prefix: 'pt' });
    const r = await wfQuery(`
      WITH Orders AS (
        SELECT
          CAST(so.Id AS VARCHAR(50)) AS Id,
          so.WfRef,
          so.CustName,
          so.Status,
          so.TruckPlate,
          so.ControlTicketNo,
          so.ImportedDocuNo,
          so.CreatedAt,
          so.DeliveryDate,
          so.SalesUserId,
          CAST('DRAFT' AS VARCHAR(20)) AS SourceType,
          CAST(NULL AS INT) AS DocuType,
          so.TripId,
          so.SoPrefix,
          so.NoTruckRequired,
          CAST(NULL AS VARCHAR(20)) AS OwnerEmpId
        FROM wf.SalesOrder so WITH (NOLOCK)
        WHERE so.Status IN ('DRAFT', 'CONFIRMED', 'PICKING', 'LOADED', 'SHIPPED', 'IMPORTED')

        UNION ALL

        SELECT
          CAST(w.SOID AS VARCHAR(50)) AS Id,
          ISNULL(w.WfRef, w.DocuNo) AS WfRef,
          w.CustName,
          w.Status,
          w.TruckPlate,
          w.ControlTicketNo,
          w.ImportedDocuNo,
          w.CreatedAt,
          w.DeliveryDate,
          w.SalesUserId,
          CAST('WINSPEED' AS VARCHAR(20)) AS SourceType,
          w.DocuType,
          w.TripId,
          w.SoPrefix,
          w.NoTruckRequired,
          w.OwnerEmpId
        FROM (
          SELECT
            hd.SOID,
            hd.DocuNo,
            ext.WfRef,
            hd.CustName,
            hd.TransRegistration AS TruckPlate,
            ext.ControlTicketNo,
            hd.DocuNo AS ImportedDocuNo,
            ISNULL(ext.CreatedAt, hd.DocuDate) AS CreatedAt,
            ext.DeliveryDate,
            ext.SalesUserId,
            ext.TripId,
            ext.SoPrefix,
            ext.NoTruckRequired,
            CAST(hd.EmpID AS VARCHAR(20)) AS OwnerEmpId,
            CASE
              WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
              WHEN ext.WeighOutWeight IS NOT NULL OR hd.clearflag = 'Y' THEN 'SHIPPED'
              WHEN hd.DocuType = 104 THEN 'IMPORTED'
              WHEN ext.IsLoaded = 1 THEN 'LOADED'
              WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
              WHEN ext.IsUnlocked = 1 THEN 'DRAFT'
              ELSE 'CONFIRMED'
            END AS Status,
            hd.DocuType,
            ROW_NUMBER() OVER(PARTITION BY hd.DocuNo ORDER BY hd.DocuType DESC, hd.SOID DESC) AS DedupRN
          FROM dbo.SOHD hd WITH (NOLOCK)
          LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
            ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
          WHERE hd.DocuType IN (103, 104)
        ) w
        WHERE w.DedupRN = 1
          AND (w.Status IN ('DRAFT', 'CONFIRMED', 'PICKING', 'LOADED')
               OR (w.Status IN ('SHIPPED', 'IMPORTED') AND w.CreatedAt >= DATEADD(day, -7, GETDATE())))
      ),
      RankedSO AS (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY Status ORDER BY CreatedAt DESC, Id DESC) as RN
        FROM Orders
        WHERE ${sf.sql}
      ),
      ActiveSO AS ( SELECT * FROM RankedSO WHERE RN <= 100 )
      SELECT so.Id, so.WfRef, so.CustName, so.Status, so.TruckPlate, so.ControlTicketNo,
             so.ImportedDocuNo, so.CreatedAt, so.DeliveryDate, u.DisplayName AS SalesName,
             so.DocuType, so.TripId, so.SoPrefix, so.NoTruckRequired,
             SUM(CASE
                   WHEN so.SourceType = 'DRAFT' AND ISNULL(sol.IsGiveaway, 0) = 0 THEN ISNULL(sol.QtyTon, 0)
                   WHEN so.SourceType = 'WINSPEED' AND ISNULL(sle.IsGiveaway, CASE WHEN dt.FreeFlag = 'Y' THEN 1 ELSE 0 END) = 0 THEN ISNULL(dt.GoodQty2, 0)
                   ELSE 0
                 END) AS TotalQtyTon,
             (
                SELECT SUM(d2.GoodQty2)
                FROM dbo.SOHD h2 WITH (NOLOCK)
                JOIN dbo.SODT d2 WITH (NOLOCK) ON h2.SOID = d2.SOID
                WHERE h2.DocuType IN (103, 104) AND h2.DocuStatus <> 'C'
                  AND (h2.RefNo = so.ImportedDocuNo OR h2.AppvDocuNo = so.ImportedDocuNo OR h2.Remark LIKE '%' + so.ImportedDocuNo + '%')
             ) AS DrawnQtyTon,
             COUNT(CASE WHEN so.SourceType = 'DRAFT' THEN sol.SoId ELSE dt.SOID END) AS LineCnt,
             (SELECT COUNT(*) FROM wf.PaperCopy pc WHERE pc.SoId = so.Id) AS CopyCnt,
             (SELECT COUNT(*) FROM wf.PaperCopy pc WHERE pc.SoId = so.Id AND pc.Status='LOST') AS LostCnt,
             (SELECT TOP 1 dso.VerifiedAt FROM wf.SalesOrder dso WHERE CAST(dso.Id AS NVARCHAR(50)) = so.Id) AS VerifiedAt,
             (
               SELECT TOP 1 cr.CouponNo
               FROM wf.CouponReservation cr WITH (NOLOCK)
               WHERE CAST(cr.CarrierSoId AS VARCHAR(50)) = so.Id OR cr.CarrierDocuNo = so.WfRef OR cr.CarrierDocuNo = so.ImportedDocuNo
             ) AS CouponNo,
             (
               SELECT TOP 1 b.BeneficiaryCustName
               FROM wf.CouponBeneficiary b WITH (NOLOCK)
               JOIN wf.CouponReservation cr2 WITH (NOLOCK) ON cr2.BeneficiaryCustId = b.BeneficiaryCustId
               WHERE CAST(cr2.CarrierSoId AS VARCHAR(50)) = so.Id OR cr2.CarrierDocuNo = so.WfRef OR cr2.CarrierDocuNo = so.ImportedDocuNo
             ) AS BeneficiaryCustName,
             (
               SELECT TOP 1 ISNULL(cu.CustCode, cr3.OwnerCustId)
               FROM wf.CouponReservation cr3 WITH (NOLOCK)
               LEFT JOIN dbo.EMCust cu WITH (NOLOCK) ON cu.CustID = CASE WHEN ISNUMERIC(cr3.OwnerCustId) = 1 THEN CAST(cr3.OwnerCustId AS INT) END
               WHERE CAST(cr3.CarrierSoId AS VARCHAR(50)) = so.Id OR cr3.CarrierDocuNo = so.WfRef OR cr3.CarrierDocuNo = so.ImportedDocuNo
             ) AS OwnerCustCode
      FROM ActiveSO so
      LEFT JOIN wf.AppUser u ON u.Id = so.SalesUserId
      LEFT JOIN wf.SalesOrderLine sol WITH (NOLOCK)
        ON so.SourceType = 'DRAFT' AND CONVERT(VARCHAR(50), sol.SoId) = so.Id
      LEFT JOIN dbo.SODT dt WITH (NOLOCK)
        ON so.SourceType = 'WINSPEED' AND CONVERT(VARCHAR(50), dt.SOID) = so.Id
      LEFT JOIN wf.SalesOrderLineExt sle WITH (NOLOCK)
        ON so.SourceType = 'WINSPEED' AND CONVERT(VARCHAR(50), sle.SOID) = so.Id AND sle.ListNo = dt.ListNo
      GROUP BY so.Id, so.WfRef, so.CustName, so.Status, so.TruckPlate, so.ControlTicketNo,
               so.ImportedDocuNo, so.CreatedAt, so.DeliveryDate, u.DisplayName, so.DocuType,
               so.TripId, so.SoPrefix, so.NoTruckRequired
      ORDER BY so.CreatedAt DESC
    `, sf.inputs);
    const board = {};
    for (const st of STAGES) board[st] = [];
    for (const row of r.recordset || []) {
      const card = {
        id: row.Id, wfRef: row.WfRef, custName: row.CustName, status: row.Status,
        truckPlate: row.TruckPlate, controlTicketNo: row.ControlTicketNo,
        importedDocuNo: row.ImportedDocuNo, createdAt: row.CreatedAt,
        deliveryDate: row.DeliveryDate, salesName: row.SalesName, docuType: row.DocuType,
        tripId: row.TripId, soPrefix: row.SoPrefix, noTruckRequired: row.NoTruckRequired,
        totalQtyTon: row.TotalQtyTon, drawnQtyTon: row.DrawnQtyTon,
        qtyTon: Math.max(0, (row.TotalQtyTon || 0) - (row.DrawnQtyTon || 0)),
        lineCnt: row.LineCnt, copyCnt: row.CopyCnt, lostCnt: row.LostCnt, verifiedAt: row.VerifiedAt,
        daysOpen: row.CreatedAt ? Math.floor((Date.now() - new Date(row.CreatedAt).getTime()) / 86400000) : 0,
        couponNo: row.CouponNo || null,
        beneficiaryCustName: row.BeneficiaryCustName || null,
        ownerCustCode: row.OwnerCustCode || null,
      };
      (board[row.Status] ||= []).push(card);
    }
    res.json({ stages: STAGES, board });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// ── GET /api/papertrail/document/:soId — ข้อมูลสำหรับพิมพ์เอกสาร ──
router.get('/document/:soId', requirePaperInScope, async (req, res) => {
  try {
    const soId = String(req.params.soId);
    const hd = (await wfQuery(`
      SELECT so.Id, so.WfRef, so.CustId, so.CustName, so.TruckPlate, so.ControlTicketNo,
             so.Status, so.DeliveryDate, so.CreatedAt, u.DisplayName AS SalesName
      FROM wf.v_AllSalesOrders so
      LEFT JOIN wf.AppUser u ON u.Id = so.SalesUserId
      WHERE so.Id = @id
    `, { id: { type: sql.VarChar(50), value: soId } })).recordset[0];
    if (!hd) return res.status(404).json({ message: 'ไม่พบ SO' });
    const lines = (await wfQuery(`
      SELECT LineNum, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon, NetPricePerTon, IsGiveaway, LoadSequence
      FROM wf.v_AllSalesOrderLines WHERE SoId = @id ORDER BY LineNum
    `, { id: { type: sql.VarChar(50), value: soId } })).recordset;

    if (lines && lines.length > 0 && !isNaN(Number(soId))) {
      const couponLines = (await wfQuery(`
        SELECT 
          cl.LineNum, cl.CouponReservationId, cl.RefCouponDocuNo, cl.IsCouponDrawn,
          ben.CustName AS BeneficiaryCustName,
          own.CustCode AS OwnerCustCode, own.CustName AS OwnerCustName
        FROM wf.SalesOrderLine cl WITH (NOLOCK)
        LEFT JOIN wf.CouponReservation cr WITH (NOLOCK) ON cr.Id = cl.CouponReservationId
        LEFT JOIN dbo.EMCust ben WITH (NOLOCK) ON ben.CustID = CASE WHEN ISNUMERIC(cr.BeneficiaryCustId) = 1 THEN CAST(cr.BeneficiaryCustId AS INT) END
        LEFT JOIN dbo.EMCust own WITH (NOLOCK) ON own.CustID = CASE WHEN ISNUMERIC(cr.OwnerCustId) = 1 THEN CAST(cr.OwnerCustId AS INT) END
        WHERE cl.SoId = @id
      `, { id: { type: sql.Int, value: Number(soId) } })).recordset || [];
      const cMap = new Map(couponLines.map(cl => [cl.LineNum, cl]));
      for (const line of lines) {
        const match = cMap.get(line.LineNum);
        if (match) {
          line.CouponReservationId = match.CouponReservationId;
          line.RefCouponDocuNo = match.RefCouponDocuNo;
          line.IsCouponDrawn = match.IsCouponDrawn;
          line.BeneficiaryCustName = match.BeneficiaryCustName;
          line.OwnerCustCode = match.OwnerCustCode;
          line.OwnerCustName = match.OwnerCustName;
        }
      }
    }

    res.json({ ...hd, lines });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// ── GET /api/papertrail/:soId/copies — สำเนากระดาษของ SO ──────
router.get('/:soId/copies', requirePaperInScope, async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT pc.*, u.DisplayName AS HolderName
      FROM wf.PaperCopy pc LEFT JOIN wf.AppUser u ON u.Id = pc.HolderUserId
      WHERE pc.SoId = @id ORDER BY pc.Id
    `, { id: { type: sql.VarChar(50), value: String(req.params.soId) } });
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// ── POST /api/papertrail/:soId/print — สร้างสำเนา 4 สี + QR ────
router.post('/:soId/print', requirePaperInScope, async (req, res) => {
  try {
    const soId = String(req.params.soId);
    const docType = (req.body && req.body.docType) === 'RECEIVE' ? 'RECEIVE' : 'ISSUE';
    const hd = (await wfQuery(`SELECT TOP 1 WfRef FROM wf.v_AllSalesOrders WHERE Id = @id`,
      { id: { type: sql.VarChar(50), value: soId } })).recordset[0];
    if (!hd) return res.status(404).json({ message: 'ไม่พบ SO' });

    // Printing again returns the SAME set: same QR codes, scan history kept. Opening the print preview used to
    // delete the copies and their scans and issue new QR codes, so paper already handed out stopped scanning and
    // the trail was lost (UAT batch 5, SHP-04). A new set is issued only on an explicit reissue by a paper role.
    const existing = (await wfQuery(`SELECT CopyColor, CopyLabel, QrNonce FROM wf.PaperCopy WHERE SoId=@id AND DocType=@dt ORDER BY Id`,
      { id: { type: sql.VarChar(50), value: soId }, dt: { type: sql.NVarChar(20), value: docType } })).recordset || [];
    const reissue = req.body?.reissue === true;
    if (existing.length && !reissue) {
      return res.json({ soId, docType, reused: true, copies: existing.map(c => ({ color: c.CopyColor, label: c.CopyLabel, qrNonce: c.QrNonce })) });
    }
    if (existing.length && !PAPER_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: 'ออกชุดเอกสารใหม่ได้เฉพาะฝ่ายที่ดูแลเอกสาร' });
    }
    await wfQuery(`DELETE FROM wf.PaperScan WHERE PaperCopyId IN (SELECT Id FROM wf.PaperCopy WHERE SoId=@id AND DocType=@dt)`,
      { id: { type: sql.VarChar(50), value: soId }, dt: { type: sql.NVarChar(20), value: docType } });
    await wfQuery(`DELETE FROM wf.PaperCopy WHERE SoId=@id AND DocType=@dt`,
      { id: { type: sql.VarChar(50), value: soId }, dt: { type: sql.NVarChar(20), value: docType } });

    const created = [];
    for (const c of ISSUE_COPIES) {
      const nonce = `${hd.WfRef || soId}-${c.color}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      await wfQuery(`
        INSERT INTO wf.PaperCopy (SoId, WfRef, DocType, CopyColor, CopyLabel, QrNonce, Status, HolderUserId)
        VALUES (@so, @ref, @dt, @col, @lbl, @nonce, 'PRINTED', @uid)`,
        {
          so: { type: sql.NVarChar(50), value: soId },
          ref:{ type: sql.NVarChar(30), value: hd.WfRef || null },
          dt: { type: sql.NVarChar(20), value: docType },
          col:{ type: sql.NVarChar(20), value: c.color },
          lbl:{ type: sql.NVarChar(80), value: c.label },
          nonce:{ type: sql.NVarChar(64), value: nonce },
          uid:{ type: sql.Int, value: req.user.sub },
        });
      created.push({ color: c.color, label: c.label, qrNonce: nonce });
    }
    broadcast('paper_updated', { soId });
    res.json({ soId, docType, copies: created });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// ── POST /api/papertrail/scan — สแกน QR เลื่อนสถานะกระดาษ ──────
// body: { qrNonce, action }  action: TRANSIT/SIGN/FILE/LOST/FOUND
router.post('/scan', requireRole(...PAPER_ROLES), async (req, res) => {
  try {
    const { qrNonce, action, note, location } = req.body || {};
    if (!qrNonce || !action) return res.status(400).json({ message: 'qrNonce และ action จำเป็น' });
    const map = { TRANSIT: 'IN_TRANSIT', SIGN: 'SIGNED', FILE: 'FILED', LOST: 'LOST', FOUND: 'SIGNED' };
    const toStatus = map[action];
    if (!toStatus) return res.status(400).json({ message: 'action ไม่ถูกต้อง' });

    const copy = (await wfQuery(`SELECT * FROM wf.PaperCopy WHERE QrNonce = @n`,
      { n: { type: sql.NVarChar(64), value: qrNonce } })).recordset[0];
    if (!copy) return res.status(404).json({ message: 'ไม่พบสำเนา (QR ไม่ถูกต้อง)' });
    if (!(await paperInScope(req.user, copy.SoId))) return res.status(404).json({ message: 'ไม่พบสำเนา (QR ไม่ถูกต้อง)' });

    await wfQuery(`UPDATE wf.PaperCopy SET Status=@st, HolderUserId=@uid, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
      { st: { type: sql.NVarChar(20), value: toStatus }, uid: { type: sql.Int, value: req.user.sub }, id: { type: sql.Int, value: copy.Id } });
    await wfQuery(`
      INSERT INTO wf.PaperScan (PaperCopyId, Action, FromStatus, ToStatus, ScannerUserId, Location, Note)
      VALUES (@cid, @act, @fr, @to, @uid, @loc, @note)`,
      {
        cid: { type: sql.Int, value: copy.Id },
        act: { type: sql.NVarChar(30), value: action },
        fr:  { type: sql.NVarChar(20), value: copy.Status },
        to:  { type: sql.NVarChar(20), value: toStatus },
        uid: { type: sql.Int, value: req.user.sub },
        loc: { type: sql.NVarChar(100), value: location || null },
        note:{ type: sql.NVarChar(300), value: note || null },
      });
    broadcast('paper_updated', { soId: copy.SoId, qrNonce, toStatus });
    res.json({ qrNonce, color: copy.CopyColor, soId: copy.SoId, status: toStatus });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// ── GET /api/papertrail/scan/:qrNonce — ดูประวัติสำเนา ────────
router.get('/scan/:qrNonce', async (req, res) => {
  try {
    const copy = (await wfQuery(`SELECT pc.*, u.DisplayName AS HolderName FROM wf.PaperCopy pc LEFT JOIN wf.AppUser u ON u.Id=pc.HolderUserId WHERE pc.QrNonce=@n`,
      { n: { type: sql.NVarChar(64), value: req.params.qrNonce } })).recordset[0];
    if (!copy || !(await paperInScope(req.user, copy.SoId))) return res.status(404).json({ message: 'ไม่พบสำเนา' });
    const hist = (await wfQuery(`
      SELECT s.*, u.DisplayName AS ScannerName FROM wf.PaperScan s
      LEFT JOIN wf.AppUser u ON u.Id = s.ScannerUserId
      WHERE s.PaperCopyId=@id ORDER BY s.ScannedAt DESC`,
      { id: { type: sql.Int, value: copy.Id } })).recordset;
    res.json({ copy, history: hist });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// ── GET /api/papertrail/lost — ใบที่หาย/ค้างนาน (alert >3 วัน) ──
router.get('/lost', requireRole(...PAPER_ROLES), async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT pc.*, u.DisplayName AS HolderName,
             DATEDIFF(day, pc.UpdatedAt, GETUTCDATE()) AS DaysStuck
      FROM wf.PaperCopy pc LEFT JOIN wf.AppUser u ON u.Id = pc.HolderUserId
      WHERE pc.Status = 'LOST'
         OR (pc.Status IN ('PRINTED','IN_TRANSIT') AND pc.UpdatedAt < DATEADD(day, -3, GETUTCDATE()))
      ORDER BY pc.UpdatedAt ASC`);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
// Trigger restart
