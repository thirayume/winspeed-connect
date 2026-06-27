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

// ── Rebate Plan (FR-008) + Pool allocation (FR-009) ──────────────────────

// GET /api/rebate/plans?status= — รายการ Plan
router.get('/plans', async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? 'WHERE p.Status = @st' : '';
    const inputs = status ? { st: { type: sql.NVarChar(20), value: status } } : {};
    const r = await wfQuery(`
      SELECT p.*, u.DisplayName AS CreatedByName,
             (SELECT COUNT(*) FROM wf.RebateLedger l WHERE l.PlanId = p.PlanId) AS LedgerCount,
             (SELECT ISNULL(SUM(l.RebateAmount),0) FROM wf.RebateLedger l WHERE l.PlanId = p.PlanId) AS AccruedAmt
      FROM wf.RebatePlan p
      LEFT JOIN wf.AppUser u ON u.Id = p.CreatedBy
      ${where}
      ORDER BY p.Status, p.Priority, p.PlanId DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/rebate/plans — สร้าง Plan (DRAFT)
router.post('/plans', requireRole('MANAGER', 'ADMIN', 'APPROVER'), async (req, res) => {
  try {
    const { title, goodCodePattern, region, returnType, netPrice, validFrom, validTo, allocatedAmount, priority, note } = req.body || {};
    const yy = (new Date().getFullYear() + 543) % 100;
    const cnt = (await wfQuery(`SELECT COUNT(*) c FROM wf.RebatePlan WHERE PlanNo LIKE @p`,
      { p: { type: sql.NVarChar(30), value: `RP${yy}-%` } })).recordset[0].c;
    const planNo = `RP${yy}-${String(cnt + 1).padStart(3, '0')}`;
    const r = await wfQuery(`
      INSERT INTO wf.RebatePlan (PlanNo, Title, GoodCodePattern, Region, ReturnType, NetPrice, ValidFrom, ValidTo, AllocatedAmount, Priority, Status, Note, CreatedBy)
      OUTPUT inserted.*
      VALUES (@no, @title, @gcp, @region, @rt, @net, @vf, @vt, @alloc, @prio, 'DRAFT', @note, @uid)`,
      {
        no:    { type: sql.NVarChar(30),  value: planNo },
        title: { type: sql.NVarChar(200), value: title || null },
        gcp:   { type: sql.NVarChar(50),  value: goodCodePattern || null },
        region:{ type: sql.NVarChar(20),  value: region || 'ALL' },
        rt:    { type: sql.NVarChar(20),  value: returnType === 'PRICEDIFF' ? 'PRICEDIFF' : 'REBATE' },
        net:   { type: sql.Decimal(12,2), value: netPrice != null ? Number(netPrice) : null },
        vf:    { type: sql.Date,          value: validFrom || null },
        vt:    { type: sql.Date,          value: validTo || null },
        alloc: { type: sql.Decimal(14,2), value: allocatedAmount != null ? Number(allocatedAmount) : 0 },
        prio:  { type: sql.Int,           value: priority != null ? Number(priority) : 100 },
        note:  { type: sql.NVarChar(300), value: note || null },
        uid:   { type: sql.Int,           value: req.user.sub },
      });
    res.json(r.recordset[0]);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/rebate/plans/:id — แก้ไข / เปลี่ยนสถานะ (DRAFT→ACTIVE→CLOSED)
router.patch('/plans/:id', requireRole('MANAGER', 'ADMIN', 'APPROVER'), async (req, res) => {
  try {
    const f = req.body || {};
    const sets = [], inputs = { id: { type: sql.Int, value: Number(req.params.id) } };
    const add = (col, key, type, val) => { sets.push(`${col}=@${key}`); inputs[key] = { type, value: val }; };
    if (f.title !== undefined)          add('Title','title',sql.NVarChar(200), f.title || null);
    if (f.goodCodePattern !== undefined)add('GoodCodePattern','gcp',sql.NVarChar(50), f.goodCodePattern || null);
    if (f.region !== undefined)         add('Region','region',sql.NVarChar(20), f.region || 'ALL');
    if (f.returnType !== undefined)     add('ReturnType','rt',sql.NVarChar(20), f.returnType === 'PRICEDIFF' ? 'PRICEDIFF':'REBATE');
    if (f.netPrice !== undefined)       add('NetPrice','net',sql.Decimal(12,2), f.netPrice != null ? Number(f.netPrice):null);
    if (f.validFrom !== undefined)      add('ValidFrom','vf',sql.Date, f.validFrom || null);
    if (f.validTo !== undefined)        add('ValidTo','vt',sql.Date, f.validTo || null);
    if (f.allocatedAmount !== undefined)add('AllocatedAmount','alloc',sql.Decimal(14,2), Number(f.allocatedAmount)||0);
    if (f.priority !== undefined)       add('Priority','prio',sql.Int, Number(f.priority)||100);
    if (f.note !== undefined)           add('Note','note',sql.NVarChar(300), f.note || null);
    if (f.status !== undefined && ['DRAFT','ACTIVE','CLOSED'].includes(f.status))
                                        add('Status','status',sql.NVarChar(20), f.status);
    if (!sets.length) return res.status(400).json({ message: 'ไม่มีข้อมูลแก้ไข' });
    sets.push('UpdatedAt=GETUTCDATE()');
    await wfQuery(`UPDATE wf.RebatePlan SET ${sets.join(', ')} WHERE PlanId=@id`, inputs);
    res.json({ id: Number(req.params.id), ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/rebate/plans/:id/allocate — จัดสรรงบ Plan → Pool ของ Sales
router.post('/plans/:id/allocate', requireRole('MANAGER', 'ADMIN', 'APPROVER'), async (req, res) => {
  try {
    const { salesUserId, periodYear, periodMonth, amount, note } = req.body || {};
    if (!salesUserId || !amount) return res.status(400).json({ message: 'salesUserId และ amount จำเป็น' });
    const now = new Date();
    const y = periodYear || now.getFullYear();
    const m = periodMonth || (now.getMonth() + 1);
    let pool = (await wfQuery(`SELECT * FROM wf.RebatePool WHERE SalesUserId=@u AND PeriodYear=@y AND PeriodMonth=@m`,
      { u: { type: sql.Int, value: Number(salesUserId) }, y: { type: sql.Int, value: y }, m: { type: sql.Int, value: m } })).recordset[0];
    if (!pool) {
      pool = (await wfQuery(`INSERT INTO wf.RebatePool (SalesUserId, PeriodYear, PeriodMonth, AllocatedAmt) OUTPUT inserted.* VALUES (@u,@y,@m,0)`,
        { u: { type: sql.Int, value: Number(salesUserId) }, y: { type: sql.Int, value: y }, m: { type: sql.Int, value: m } })).recordset[0];
    }
    await wfQuery(`UPDATE wf.RebatePool SET AllocatedAmt = AllocatedAmt + @amt, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
      { amt: { type: sql.Decimal(14,2), value: Number(amount) }, id: { type: sql.Int, value: pool.Id } });
    await wfQuery(`INSERT INTO wf.RebatePlanAllocation (PlanId, PoolId, SalesUserId, Amount, Note, CreatedBy)
      VALUES (@pid, @pool, @u, @amt, @note, @by)`,
      {
        pid: { type: sql.Int, value: Number(req.params.id) },
        pool:{ type: sql.Int, value: pool.Id },
        u:   { type: sql.Int, value: Number(salesUserId) },
        amt: { type: sql.Decimal(14,2), value: Number(amount) },
        note:{ type: sql.NVarChar(300), value: note || null },
        by:  { type: sql.Int, value: req.user.sub },
      });
    res.json({ ok: true, poolId: pool.Id, allocated: Number(amount) });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
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
