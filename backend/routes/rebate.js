/**
 * rebate.js — Rebate Pool + FIFO Ledger + Claims
 * ⚠ Writes ไปที่ wf schema เท่านั้น
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/rebate/pools — pool รายเดือนของ sales user
router.get('/pools', async (req, res) => {
  try {
    const { userId, year, month } = req.query;
    const conditions = [];
    const inputs = {};
    if (userId) { conditions.push(`p.SalesUserId = @uid`); inputs.uid = { type: sql.Int, value: Number(userId) }; }
    if (year)   { conditions.push(`p.PeriodYear = @y`);   inputs.y  = { type: sql.Int, value: Number(year) }; }
    if (month)  { conditions.push(`p.PeriodMonth = @m`);  inputs.m  = { type: sql.Int, value: Number(month) }; }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await wfQuery(`
      SELECT p.*, u.DisplayName AS SalesName
      FROM wf.RebatePool p
      JOIN wf.AppUser u ON u.Id = p.SalesUserId
      ${where}
      ORDER BY p.PeriodYear DESC, p.PeriodMonth DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/ledger?poolId=&soId= — รายการ accrual
router.get('/ledger', async (req, res) => {
  try {
    const { poolId, soId, custId } = req.query;
    const conditions = ['l.ReversedFlag = 0'];
    const inputs = {};
    if (poolId) { conditions.push(`l.PoolId = @pid`);  inputs.pid  = { type: sql.Int,          value: Number(poolId) }; }
    if (soId)   { conditions.push(`l.SoId = @soId`);   inputs.soId = { type: sql.VarChar(50),  value: String(soId) }; }
    if (custId) { conditions.push(`l.CustId = @cid`);  inputs.cid  = { type: sql.NVarChar(20), value: custId }; }
    const r = await wfQuery(
      `SELECT * FROM wf.RebateLedger l WHERE ${conditions.join(' AND ')} ORDER BY l.CreatedAt DESC`,
      inputs
    );
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/claims — เคลมที่เปิดอยู่
router.get('/claims', async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? `WHERE c.Status = @status` : '';
    const inputs = status ? { status: { type: sql.NVarChar(20), value: status } } : {};
    const r = await wfQuery(`
      SELECT c.*, u.DisplayName AS SalesName
      FROM wf.RebateClaim c
      JOIN wf.AppUser u ON u.Id = c.SalesUserId
      ${where}
      ORDER BY c.CreatedAt DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/rebate/claims — ยื่นเคลม (FIFO cut)
router.post('/claims', requireRole('SALES', 'ACCOUNTING', 'ADMIN'), async (req, res) => {
  try {
    const { poolId, claimAmt, custId, note } = req.body;
    if (!poolId || !claimAmt) return res.status(400).json({ message: 'poolId และ claimAmt จำเป็น' });

    const pool = (await wfQuery(`SELECT * FROM wf.RebatePool WHERE Id=@id`, { id: { type: sql.Int, value: poolId } })).recordset?.[0];
    if (!pool) return res.status(404).json({ message: 'ไม่พบ pool' });

    const available = Number(pool.AccruedAmt) - Number(pool.ClaimedAmt);
    if (Number(claimAmt) > available)
      return res.status(400).json({ message: `ยอดเกิน: ขอ ฿${claimAmt} ใช้ได้ ฿${available.toFixed(2)}` });

    // สร้าง Claim
    const claimR = await wfQuery(
      `INSERT INTO wf.RebateClaim (PoolId, SalesUserId, CustId, ClaimAmt, RemainingAmt, Status, Note)
       OUTPUT inserted.*
       VALUES (@pid, @uid, @cid, @amt, @amt, 'PENDING', @note)`,
      {
        pid:  { type: sql.Int,          value: poolId },
        uid:  { type: sql.Int,          value: req.user.sub },
        cid:  { type: sql.NVarChar(20), value: custId || null },
        amt:  { type: sql.Decimal(12,2),value: Number(claimAmt) },
        note: { type: sql.NVarChar(500),value: note || null },
      }
    );
    const claim = claimR.recordset[0];

    // FIFO cut: ตัด RemainingAmt จาก ledger เรียงตาม CreatedAt
    let remaining = Number(claimAmt);
    const ledger = (await wfQuery(
      `SELECT * FROM wf.RebateLedger WHERE PoolId=@pid AND RemainingAmt>0 AND ReversedFlag=0 ORDER BY CreatedAt ASC`,
      { pid: { type: sql.Int, value: poolId } }
    )).recordset || [];

    for (const row of ledger) {
      if (remaining <= 0) break;
      const cut = Math.min(remaining, Number(row.RemainingAmt));
      await wfQuery(
        `UPDATE wf.RebateLedger SET RemainingAmt = RemainingAmt - @cut, Status = CASE WHEN RemainingAmt - @cut <= 0 THEN 'CLAIMED' ELSE Status END WHERE Id=@id`,
        { cut: { type: sql.Decimal(12,2), value: cut }, id: { type: sql.Int, value: row.Id } }
      );
      remaining -= cut;
    }

    // อัปเดต pool ClaimedAmt
    await wfQuery(
      `UPDATE wf.RebatePool SET ClaimedAmt=ClaimedAmt+@amt, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
      { amt: { type: sql.Decimal(12,2), value: Number(claimAmt) }, id: { type: sql.Int, value: poolId } }
    );

    res.json(claim);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/rebate/claims/:id/approve — ACCOUNTING/ADMIN อนุมัติ
router.patch('/claims/:id/approve', requireRole('ACCOUNTING', 'ADMIN'), async (req, res) => {
  try {
    const { docuNo } = req.body; // CN DocuNo จาก WINSpeed หลัง import
    await wfQuery(
      `UPDATE wf.RebateClaim SET Status='APPROVED', ApprovedAt=GETUTCDATE(), ApprovedBy=@uid, CnDocuNo=@cn WHERE Id=@id`,
      {
        id:  { type: sql.Int,          value: Number(req.params.id) },
        uid: { type: sql.Int,          value: req.user.sub },
        cn:  { type: sql.NVarChar(20), value: docuNo || null },
      }
    );
    res.json({ id: Number(req.params.id), status: 'APPROVED' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/summary — KPI ภาพรวมต่อพนักงานขาย (wf.RebatePool)
router.get('/summary', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT u.DisplayName AS SalesName,
             SUM(p.AccruedAmt) AS TotalAccrued,
             SUM(p.ClaimedAmt) AS TotalClaimed,
             SUM(p.AccruedAmt - p.ClaimedAmt) AS TotalAvailable,
             SUM(p.AllocatedAmt) AS TotalAllocated
      FROM wf.RebatePool p
      JOIN wf.AppUser u ON u.Id = p.SalesUserId
      GROUP BY u.DisplayName
      ORDER BY TotalAccrued DESC
    `);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ⚠ ทุก endpoint อ่าน dbo ใช้ wfQuery (ownerPool ของ target ปัจจุบัน) เพื่อให้ตามปุ่มสลับ LOCAL/REMOTE

// GET /api/rebate/voucher-summary — WFCoupon summary by salesperson (for VoucherPage)
router.get('/voucher-summary', async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT hd.EmpID,
             ISNULL(emp.EmpName, CAST(hd.EmpID AS NVARCHAR(20))) AS EmpName,
             COUNT(DISTINCT hd.CustID)  AS CustCount,
             COUNT(c.CouponID)          AS CouponCount,
             SUM(c.RemaQty)             AS OutstandingTon
      FROM dbo.WFCoupon c
      JOIN dbo.SOHD hd  ON hd.SOID = c.DocuID
      LEFT JOIN dbo.EMEmp emp ON emp.EmpID = hd.EmpID
      WHERE c.RemaQty > 0
      GROUP BY hd.EmpID, emp.EmpName
      ORDER BY OutstandingTon DESC
    `);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── dbo CN Rebate endpoints (read-only, single source of truth) ──────────

// GET /api/rebate/cn-summary — สรุป CN rebate จาก dbo แยกตาม Sales/ลูกค้า
router.get('/cn-summary', async (req, res) => {
  try {
    const { year, empId } = req.query;
    let where = `WHERE cn.Docutype = 109 AND cn.CNRemarkTypeID IN (6001, 1001)`;
    const inputs = {};
    if (year)  { where += ` AND YEAR(cn.DocuDate) = @year`;  inputs.year  = { type: sql.Int, value: Number(year) }; }
    if (empId) { where += ` AND cn.EmpID = @empId`;          inputs.empId = { type: sql.Int, value: Number(empId) }; }

    const r = await wfQuery(`
      SELECT
        e.EmpName                          AS SalesName,
        cn.EmpID,
        COUNT(DISTINCT cn.SOInvID)         AS CNCount,
        COUNT(DISTINCT cn.CustID)          AS CustCount,
        SUM(d.GoodAmnt)                    AS TotalRebate,
        MIN(cn.DocuDate)                   AS FirstCN,
        MAX(cn.DocuDate)                   AS LastCN
      FROM dbo.SOInvHD cn
      JOIN dbo.SOInvDT d  ON d.SOInvID = cn.SOInvID
      LEFT JOIN dbo.EMEmp e ON e.EmpID = cn.EmpID
      ${where}
      GROUP BY cn.EmpID, e.EmpName
      ORDER BY TotalRebate DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/cn-list?year=&empId=&custId= — รายการ CN ทั้งหมด (header level)
router.get('/cn-list', async (req, res) => {
  try {
    const { year, empId, custId } = req.query;
    let where = `WHERE cn.Docutype = 109 AND cn.CNRemarkTypeID IN (6001, 1001)`;
    const inputs = {};
    if (year)   { where += ` AND YEAR(cn.DocuDate) = @year`; inputs.year   = { type: sql.Int,          value: Number(year) }; }
    if (empId)  { where += ` AND cn.EmpID = @empId`;         inputs.empId  = { type: sql.Int,          value: Number(empId) }; }
    if (custId) { where += ` AND cn.CustID = @custId`;       inputs.custId = { type: sql.NVarChar(20), value: custId }; }

    const r = await wfQuery(`
      SELECT
        cn.SOInvID,
        cn.DocuNo                                        AS CNDocuNo,
        CONVERT(VARCHAR(10), cn.DocuDate, 120)           AS CNDate,
        cn.CustID,
        cn.CustName,
        cn.EmpID,
        ISNULL(e.EmpName, CAST(cn.EmpID AS NVARCHAR(20))) AS SalesName,
        cn.SONo                                          AS OrigInvNo,
        CONVERT(VARCHAR(10), inv.DocuDate, 120)          AS OrigInvDate,
        cn.NetAmnt                                       AS CNAmt,
        cn.RemaAmnt,
        cn.DocuStatus,
        t.CNRemarkTypeName                               AS Reason
      FROM dbo.SOInvHD cn
      LEFT JOIN dbo.SOInvHD inv ON inv.SOInvID = cn.RefSOID
      LEFT JOIN dbo.EMEmp    e  ON e.EmpID = cn.EmpID
      LEFT JOIN dbo.EMcnremarkType t ON t.CNRemarkTypeID = cn.CNRemarkTypeID
      ${where}
      ORDER BY cn.DocuDate DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/cn-detail/:soInvId — รายการสินค้าใน CN
router.get('/cn-detail/:soInvId', async (req, res) => {
  try {
    const r = await wfQuery(`
        SELECT
          d.ListNo,
          d.GoodName,
          d.GoodQty2     AS QtyTon,
          d.GoodPrice2   AS RebatePerTon,
          d.GoodAmnt     AS RebateAmt,
          -- original invoice line
          inv_d.GoodPrice2 AS OrigPrice
        FROM dbo.SOInvDT d
        LEFT JOIN dbo.SOInvHD cn    ON cn.SOInvID = d.SOInvID
        LEFT JOIN dbo.SOInvDT inv_d ON inv_d.SOInvID = cn.RefSOID AND inv_d.GoodID = d.GoodID
        WHERE d.SOInvID = @id
        ORDER BY d.ListNo
      `, { id: { type: sql.Int, value: Number(req.params.soInvId) } });
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/coupons — รายลูกค้า สรุปยอดคูปองคงค้าง
router.get('/coupons', async (req, res) => {
  try {
    const { custId, empId } = req.query;
    let where = 'WHERE c.RemaQty > 0';
    const inputs = {};
    if (custId) { where += ` AND hd.CustID = @custId`; inputs.custId = { type: sql.NVarChar(20), value: custId }; }
    if (empId)  { where += ` AND hd.EmpID  = @empId`;  inputs.empId  = { type: sql.Int,          value: Number(empId) }; }

    const r = await wfQuery(`
      SELECT hd.CustID, hd.CustName,
             hd.EmpID,
             ISNULL(emp.EmpName, CAST(hd.EmpID AS NVARCHAR(20))) AS EmpName,
             COUNT(c.CouponID)   AS CouponCount,
             SUM(c.RemaQty)      AS OutstandingTon,
             MIN(hd.DocuDate)    AS OldestDate
      FROM dbo.WFCoupon c
      JOIN dbo.SOHD hd ON hd.SOID = c.DocuID
      LEFT JOIN dbo.EMEmp emp ON emp.EmpID = hd.EmpID
      ${where}
      GROUP BY hd.CustID, hd.CustName, hd.EmpID, emp.EmpName
      ORDER BY OutstandingTon DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/coupons/:custId — รายการคูปองของลูกค้า
router.get('/coupons/:custId', async (req, res) => {
  try {
    const r = await wfQuery(`
        SELECT c.CouponID, c.CouponNo, c.SONo,
               CONVERT(VARCHAR(10), hd.DocuDate, 120) AS DocuDate,
               hd.CustID, hd.CustName,
               hd.EmpID,
               ISNULL(emp.EmpName, CAST(hd.EmpID AS NVARCHAR(20))) AS EmpName,
               c.GoodID, c.GoodName,
               c.GoodQty,
               c.RemaQty,
               c.GoodQty - c.RemaQty AS RedeemedQty
        FROM dbo.WFCoupon c
        JOIN dbo.SOHD hd ON hd.SOID = c.DocuID
        LEFT JOIN dbo.EMEmp emp ON emp.EmpID = hd.EmpID
        WHERE hd.CustID = @cid AND c.RemaQty > 0
        ORDER BY hd.DocuDate ASC
      `, { cid: { type: sql.NVarChar(20), value: req.params.custId } });
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = router;
