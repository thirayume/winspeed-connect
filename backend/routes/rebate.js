/**
 * rebate.js — Rebate Pool + FIFO Ledger + Claims
 * ⚠ Writes ไปที่ wf schema เท่านั้น
 */
const router = require('express').Router();
const { sql, wfQuery, ownerPool } = require('../db');
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

// GET /api/rebate/summary — KPI ต่อพนักงานขาย (จาก dbo.WFCoupon)
router.get('/summary', async (req, res) => {
  try {
    const r = await ownerPool.request().query(`
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

// GET /api/rebate/coupons — รายลูกค้า สรุปยอดคูปองคงค้าง
router.get('/coupons', async (req, res) => {
  try {
    const { custId, empId } = req.query;
    let where = 'WHERE c.RemaQty > 0';
    const inputs = [];
    if (custId) { where += ` AND hd.CustID = @custId`; inputs.push({ name: 'custId', type: sql.NVarChar(20), value: custId }); }
    if (empId)  { where += ` AND hd.EmpID  = @empId`;  inputs.push({ name: 'empId',  type: sql.Int,          value: Number(empId) }); }

    const req2 = ownerPool.request();
    inputs.forEach(i => req2.input(i.name, i.type, i.value));
    const r = await req2.query(`
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
    `);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/coupons/:custId — รายการคูปองของลูกค้า
router.get('/coupons/:custId', async (req, res) => {
  try {
    const r = await ownerPool.request()
      .input('cid', sql.NVarChar(20), req.params.custId)
      .query(`
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
      `);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = router;
