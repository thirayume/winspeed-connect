/**
 * rebate.js — Rebate Pool + FIFO Ledger + Claims
 * ⚠ Writes ไปที่ wf schema เท่านั้น
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole, requireRebateAmountAccess, canViewAllRebateAmounts } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/rebate/pools — pool รายเดือนของ sales user
router.get('/pools', requireRebateAmountAccess, async (req, res) => {
  try {
    const { userId, year, month } = req.query;
    const conditions = [];
    const inputs = {};
    if (canViewAllRebateAmounts(req.user)) {
      if (userId) { conditions.push(`p.SalesUserId = @uid`); inputs.uid = { type: sql.Int, value: Number(userId) }; }
    } else {
      conditions.push(`p.SalesUserId = @uid`);
      inputs.uid = { type: sql.Int, value: Number(req.user.sub) };
    }
    if (year)   { conditions.push(`p.PeriodYear = @y`);   inputs.y  = { type: sql.Int, value: Number(year) }; }
    if (month)  { conditions.push(`p.PeriodMonth = @m`);  inputs.m  = { type: sql.Int, value: Number(month) }; }
    
    // Ignore empty phantom pools
    conditions.push(`(p.AccruedAmt > 0 OR p.ClaimedAmt > 0)`);
    
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
router.get('/ledger', requireRebateAmountAccess, async (req, res) => {
  try {
    const { poolId, soId, custId } = req.query;
    const conditions = ['l.ReversedFlag = 0'];
    const inputs = {};
    if (!canViewAllRebateAmounts(req.user)) {
      conditions.push(`p.SalesUserId = @salesUserId`);
      inputs.salesUserId = { type: sql.Int, value: Number(req.user.sub) };
    }
    if (poolId) { conditions.push(`l.PoolId = @pid`);  inputs.pid  = { type: sql.Int,          value: Number(poolId) }; }
    if (soId)   { conditions.push(`l.SoId = @soId`);   inputs.soId = { type: sql.VarChar(50),  value: String(soId) }; }
    if (custId) { conditions.push(`l.CustId = @cid`);  inputs.cid  = { type: sql.NVarChar(20), value: custId }; }
    const r = await wfQuery(
      `SELECT l.*
       FROM wf.RebateLedger l
       JOIN wf.RebatePool p ON p.Id = l.PoolId
       WHERE ${conditions.join(' AND ')}
       ORDER BY l.CreatedAt DESC`,
      inputs
    );
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/claims — เคลมที่เปิดอยู่
router.get('/claims', requireRebateAmountAccess, async (req, res) => {
  try {
    const { status } = req.query;
    const conditions = [];
    const inputs = {};
    if (status) {
      conditions.push(`c.Status = @status`);
      inputs.status = { type: sql.NVarChar(20), value: status };
    }
    if (!canViewAllRebateAmounts(req.user)) {
      conditions.push(`c.SalesUserId = @salesUserId`);
      inputs.salesUserId = { type: sql.Int, value: Number(req.user.sub) };
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
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
    if (!canViewAllRebateAmounts(req.user) && Number(pool.SalesUserId) !== Number(req.user.sub)) {
      return res.status(403).json({ message: 'ไม่มีสิทธิ์เคลม pool ของพนักงานขายอื่น' });
    }

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
    const { docuNo } = req.body; // WINSpeed reference document number after official processing
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
      WHERE (p.AccruedAmt > 0 OR p.ClaimedAmt > 0)
      GROUP BY u.DisplayName
      ORDER BY TotalAccrued DESC
    `);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── Rebate Plan (FR-008) + Pool allocation (FR-009) ──────────────────────

let rebatePlanRefDocColumn = null;
async function hasRebatePlanRefDoc() {
  if (rebatePlanRefDocColumn !== null) return rebatePlanRefDocColumn;
  const r = await wfQuery(`SELECT CASE WHEN COL_LENGTH('wf.RebatePlan', 'RefDoc') IS NULL THEN 0 ELSE 1 END AS HasRefDoc`);
  rebatePlanRefDocColumn = Number(r.recordset?.[0]?.HasRefDoc || 0) === 1;
  return rebatePlanRefDocColumn;
}

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
    const { title, refDoc, goodCodePattern, region, returnType, netPrice, validFrom, validTo, allocatedAmount, priority, note } = req.body || {};
    const yy = (new Date().getFullYear() + 543) % 100;
    const cnt = (await wfQuery(`SELECT COUNT(*) c FROM wf.RebatePlan WHERE PlanNo LIKE @p`,
      { p: { type: sql.NVarChar(30), value: `RP${yy}-%` } })).recordset[0].c;
    const planNo = `RP${yy}-${String(cnt + 1).padStart(3, '0')}`;
    const hasRefDoc = await hasRebatePlanRefDoc();
    const refDocColumn = hasRefDoc ? ', RefDoc' : '';
    const refDocValue = hasRefDoc ? ', @refDoc' : '';
    const inputs = {
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
    };
    if (hasRefDoc) inputs.refDoc = { type: sql.NVarChar(100), value: refDoc || null };
    const r = await wfQuery(`
      INSERT INTO wf.RebatePlan (PlanNo, Title${refDocColumn}, GoodCodePattern, Region, ReturnType, NetPrice, ValidFrom, ValidTo, AllocatedAmount, Priority, Status, Note, CreatedBy)
      OUTPUT inserted.*
      VALUES (@no, @title${refDocValue}, @gcp, @region, @rt, @net, @vf, @vt, @alloc, @prio, 'DRAFT', @note, @uid)`,
      inputs);
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
    if (f.refDoc !== undefined && await hasRebatePlanRefDoc())
                                        add('RefDoc','refDoc',sql.NVarChar(100), f.refDoc || null);
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

// ── Legacy Data Migration (Tons to Baht) ───────────────────────────────────
router.post('/migrate-legacy', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { rate } = req.body;
    if (!rate || isNaN(Number(rate)) || Number(rate) <= 0) {
      return res.status(400).json({ message: 'กรุณาระบุอัตราการแปลง (rate) เช่น 100 บาท/ตัน' });
    }
    const conversionRate = Number(rate);

    // 1. Get legacy remaining tons per EmpID
    const legacyR = await wfQuery(`
      SELECT
        hd.EmpID,
        SUM(c.RemaQty) AS RemainingTon
      FROM dbo.WFCoupon c
      JOIN dbo.SOHD hd ON hd.SOID = c.DocuID
      WHERE hd.DocuType = 104 AND c.RemaQty > 0
      GROUP BY hd.EmpID
    `);
    const legacyBalances = legacyR.recordset || [];

    if (legacyBalances.length === 0) {
      return res.json({ message: 'ไม่พบยอดค้างในระบบเดิม', processed: 0 });
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    let processed = 0;
    let totalInjectedBaht = 0;
    const errors = [];

    for (const row of legacyBalances) {
      if (!row.EmpID) continue;
      
      // 2. Map WINSpeed EmpID to Web App User
      const userR = await wfQuery(`SELECT Id FROM wf.AppUser WHERE EmpId = @empId`, {
        empId: { type: sql.NVarChar(20), value: String(row.EmpID) }
      });
      const user = userR.recordset?.[0];
      if (!user) {
        errors.push(`ไม่พบบัญชี Web App สำหรับ EmpID: ${row.EmpID}`);
        continue;
      }

      const salesUserId = user.Id;
      const tons = Number(row.RemainingTon);
      const bahtAmount = Math.round(tons * conversionRate * 100) / 100;

      if (bahtAmount <= 0) continue;

      // 3. Pool Injection
      let pool = (await wfQuery(`SELECT * FROM wf.RebatePool WHERE SalesUserId=@u AND PeriodYear=@y AND PeriodMonth=@m`,
        { u: { type: sql.Int, value: salesUserId }, y: { type: sql.Int, value: currentYear }, m: { type: sql.Int, value: currentMonth } })).recordset?.[0];
      
      if (!pool) {
        pool = (await wfQuery(`INSERT INTO wf.RebatePool (SalesUserId, PeriodYear, PeriodMonth, AllocatedAmt) OUTPUT inserted.* VALUES (@u,@y,@m,0)`,
          { u: { type: sql.Int, value: salesUserId }, y: { type: sql.Int, value: currentYear }, m: { type: sql.Int, value: currentMonth } })).recordset[0];
      }

      // Add to pool
      await wfQuery(`UPDATE wf.RebatePool SET AllocatedAmt = AllocatedAmt + @amt, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
        { amt: { type: sql.Decimal(14,2), value: bahtAmount }, id: { type: sql.Int, value: pool.Id } });

      // Create Ledger Entry for traceability
      await wfQuery(`INSERT INTO wf.RebateLedger (PoolId, SoId, CustId, GoodId, GoodCode, QtyTon, PricePerTon, NetPricePerTon, RebatePerTon, RebateAmount, RemainingAmt, Status)
        VALUES (@pid, 0, 'LEGACY', '0', 'LEGACY_MIGRATION', @tons, 0, 0, @rate, @baht, @baht, 'ACCRUED')`,
        {
          pid: { type: sql.Int, value: pool.Id },
          tons: { type: sql.Decimal(12,3), value: tons },
          rate: { type: sql.Decimal(10,2), value: conversionRate },
          baht: { type: sql.Decimal(12,2), value: bahtAmount }
        });

      processed++;
      totalInjectedBaht += bahtAmount;
    }

    res.json({
      message: 'Migration completed',
      processedSalespersons: processed,
      totalInjectedBaht,
      conversionRate,
      errors
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
});

// ── dbo WF Rebate Trail endpoints (read-only, WINSpeed-owned flow) ───────
// Correct WF flow observed from production data:
// SOHD(103 booking) -> SOHD(104 order) -> WFCoupon -> WFRedemtionDT
// -> SOInvHD(107 invoice) / SOInvHD(202 cash flow) -> ARReceHD/DT -> GL/VAT.

router.get('/wf-trail-summary', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { year, empId } = req.query;
    const conditions = [`hd.DocuType = 104`];
    const inputs = {};
    if (year) {
      conditions.push(`YEAR(hd.DocuDate) = @year`);
      inputs.year = { type: sql.Int, value: Number(year) };
    }
    if (empId) {
      conditions.push(`hd.EmpID = @empId`);
      inputs.empId = { type: sql.Int, value: Number(empId) };
    }
    const r = await wfQuery(`
      SELECT
        hd.EmpID,
        ISNULL(emp.EmpName, CAST(hd.EmpID AS NVARCHAR(20))) AS SalesName,
        COUNT(DISTINCT hd.SOID) AS OrderCount,
        COUNT(c.CouponID) AS CouponCount,
        SUM(c.GoodQty) AS CouponTon,
        SUM(c.GoodQty - c.RemaQty) AS RedeemedTon,
        SUM(c.RemaQty) AS RemainingTon,
        COUNT(DISTINCT rd.RedemtionID) AS RedemptionCount,
        COUNT(DISTINCT inv107.SOInvID) AS InvoiceCount,
        MIN(hd.DocuDate) AS FirstDocuDate,
        MAX(hd.DocuDate) AS LastDocuDate
      FROM dbo.WFCoupon c
      JOIN dbo.SOHD hd ON hd.SOID = c.DocuID
      LEFT JOIN dbo.EMEmp emp ON emp.EmpID = hd.EmpID
      LEFT JOIN dbo.WFRedemtionDT rd ON rd.CouponID = c.CouponID
      LEFT JOIN dbo.SOInvHD inv107 ON inv107.SOInvID = rd.SOInvID
      WHERE ${conditions.join(' AND ')}
      GROUP BY hd.EmpID, emp.EmpName
      ORDER BY RedeemedTon DESC, CouponTon DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.get('/wf-trail-list', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { year, empId, custId, q } = req.query;
    const conditions = [`hd.DocuType = 104`];
    const inputs = {};
    if (year) {
      conditions.push(`YEAR(hd.DocuDate) = @year`);
      inputs.year = { type: sql.Int, value: Number(year) };
    }
    if (empId) {
      conditions.push(`hd.EmpID = @empId`);
      inputs.empId = { type: sql.Int, value: Number(empId) };
    }
    if (custId) {
      conditions.push(`hd.CustID = @custId`);
      inputs.custId = { type: sql.NVarChar(20), value: custId };
    }
    if (q) {
      conditions.push(`(
        hd.DocuNo LIKE @q OR hd.RefNo LIKE @q OR hd.AppvDocuNo LIKE @q OR
        c.CouponNo LIKE @q OR inv107.DocuNo LIKE @q OR hd.CustName LIKE @q
      )`);
      inputs.q = { type: sql.NVarChar(100), value: `%${q}%` };
    }
    const r = await wfQuery(`
      SELECT
        hd.SOID,
        hd.DocuNo AS SONo,
        hd.RefNo AS ControlNo,
        hd.DocuDate,
        hd.CustID,
        hd.CustName,
        hd.EmpID,
        ISNULL(emp.EmpName, CAST(hd.EmpID AS NVARCHAR(20))) AS SalesName,
        COUNT(c.CouponID) AS CouponCount,
        SUM(c.GoodQty) AS CouponTon,
        SUM(c.GoodQty - c.RemaQty) AS RedeemedTon,
        SUM(c.RemaQty) AS RemainingTon,
        COUNT(DISTINCT rd.RedemtionID) AS RedemptionCount,
        MAX(rh.DocuNo) AS RedemptionNo,
        MAX(inv107.SOInvID) AS InvoiceId,
        MAX(inv107.DocuNo) AS InvoiceNo,
        MAX(inv107.Docutype) AS InvoiceType,
        MAX(inv107.PostID) AS InvoicePostId
      FROM dbo.WFCoupon c
      JOIN dbo.SOHD hd ON hd.SOID = c.DocuID
      LEFT JOIN dbo.EMEmp emp ON emp.EmpID = hd.EmpID
      LEFT JOIN dbo.WFRedemtionDT rd ON rd.CouponID = c.CouponID
      LEFT JOIN dbo.WFRedemtionHD rh ON rh.RedemtionID = rd.RedemtionID
      LEFT JOIN dbo.SOInvHD inv107 ON inv107.SOInvID = rd.SOInvID
      WHERE ${conditions.join(' AND ')}
      GROUP BY hd.SOID, hd.DocuNo, hd.RefNo, hd.DocuDate, hd.CustID, hd.CustName, hd.EmpID, emp.EmpName
      ORDER BY hd.DocuDate DESC, hd.SOID DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.get('/wf-trail-detail/:soId', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const soId = Number(req.params.soId);
    if (!Number.isFinite(soId)) return res.status(400).json({ message: 'Invalid SOID' });

    const so = (await wfQuery(`
      SELECT h.*, emp.EmpName AS SalesName
      FROM dbo.SOHD h
      LEFT JOIN dbo.EMEmp emp ON emp.EmpID = h.EmpID
      WHERE h.SOID = @soId
    `, { soId: { type: sql.Int, value: soId } })).recordset?.[0] || null;

    const booking = (await wfQuery(`
      SELECT TOP 1 b.*
      FROM dbo.SOHD o
      JOIN dbo.SOHD b ON b.AppvDocuNo = o.RefNo AND b.DocuType = 103
      WHERE o.SOID = @soId
      ORDER BY b.SOID DESC
    `, { soId: { type: sql.Int, value: soId } })).recordset?.[0] || null;

    const soLines = (await wfQuery(`
      SELECT * FROM dbo.SODT WHERE SOID IN (@soId${booking ? ', @bookingSoId' : ''}) ORDER BY SOID, ListNo
    `, {
      soId: { type: sql.Int, value: soId },
      ...(booking ? { bookingSoId: { type: sql.Int, value: Number(booking.SOID) } } : {}),
    })).recordset || [];

    const coupons = (await wfQuery(`
      SELECT c.*, rd.RedemtionID, rd.Listno AS RedemptionListNo, rd.PostInv, rd.SOInvID, rd.SOListNo,
             rh.DocuNo AS RedemptionNo, rh.DocuDate AS RedemptionDate, rh.DocuType AS RedemptionType,
             inv.DocuNo AS InvoiceNo, inv.Docutype AS InvoiceType, inv.PostID AS InvoicePostID
      FROM dbo.WFCoupon c
      LEFT JOIN dbo.WFRedemtionDT rd ON rd.CouponID = c.CouponID
      LEFT JOIN dbo.WFRedemtionHD rh ON rh.RedemtionID = rd.RedemtionID
      LEFT JOIN dbo.SOInvHD inv ON inv.SOInvID = rd.SOInvID
      WHERE c.DocuID = @soId
      ORDER BY c.Listno, c.CouponID
    `, { soId: { type: sql.Int, value: soId } })).recordset || [];

    const invoiceIds = [...new Set(coupons.map(r => Number(r.SOInvID)).filter(Boolean))];
    const invoiceIdList = invoiceIds.length ? invoiceIds.join(',') : '0';
    const invoices = (await wfQuery(`
      SELECT * FROM dbo.SOInvHD
      WHERE SOInvID IN (${invoiceIdList})
         OR SONo = @soNo
      ORDER BY Docutype, SOInvID
    `, { soNo: { type: sql.NVarChar(25), value: so?.DocuNo || '' } })).recordset || [];

    const allInvoiceIds = [...new Set(invoices.map(r => Number(r.SOInvID)).filter(Boolean))];
    const allInvoiceIdList = allInvoiceIds.length ? allInvoiceIds.join(',') : '0';
    const invoiceLines = (await wfQuery(`
      SELECT * FROM dbo.SOInvDT WHERE SOInvID IN (${allInvoiceIdList}) ORDER BY SOInvID, ListNo
    `)).recordset || [];

    const receipts = (await wfQuery(`
      SELECT DISTINCT h.*
      FROM dbo.ARReceHD h
      LEFT JOIN dbo.ARReceDT d ON d.ARReceID = h.ARReceID
      WHERE h.SOInvID IN (${allInvoiceIdList})
         OR d.SOInvID IN (${allInvoiceIdList})
      ORDER BY h.DocuType, h.ARReceID
    `)).recordset || [];

    const postIds = [
      ...invoices.map(r => Number(r.PostID)).filter(Boolean),
      ...receipts.map(r => Number(r.PostID)).filter(Boolean),
    ];
    const postIdList = [...new Set(postIds)].length ? [...new Set(postIds)].join(',') : '0';
    const vat = (await wfQuery(`
      SELECT * FROM dbo.VTVAT WHERE FromID IN (${postIdList}) ORDER BY FromID, VATID, ListNo
    `)).recordset || [];
    const gl = (await wfQuery(`
      SELECT h.GLID, h.DocuNo, h.DocuDate, h.JourID, h.FromFlag, h.FromID, h.FormGLID, h.TotaAmnt,
             d.ListNo, d.AccID, d.DrAmnt, d.CrAmnt, d.GLDesc1
      FROM dbo.GLHD h
      LEFT JOIN dbo.GLDT d ON d.GLID = h.GLID
      WHERE h.FromID IN (${postIdList})
      ORDER BY h.GLID, d.ListNo
    `)).recordset || [];
    const bank = (await wfQuery(`
      SELECT 'cqbookmove' AS Source, bookmoveid AS Id, docuno AS DocuNo, docudate AS DocuDate, docutype AS DocuType, fromid AS FromID, bankbookid AS BankBookID, custid AS CustID
      FROM dbo.cqbookmove WHERE fromid IN (${postIdList})
      UNION ALL
      SELECT 'CQStatement' AS Source, StatementID AS Id, DocuNo, DocuDate, DocuType, FromID, BankBookID, CustID
      FROM dbo.CQStatement WHERE FromID IN (${postIdList})
      ORDER BY Source, Id
    `)).recordset || [];

    res.json({ so, booking, soLines, coupons, invoices, invoiceLines, receipts, vat, gl, bank });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── Legacy dbo CN Rebate endpoints (kept for compatibility; not WF main flow) ──

// GET /api/rebate/cn-summary — สรุป CN rebate จาก dbo แยกตาม Sales/ลูกค้า
router.get('/cn-summary', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER'), async (req, res) => {
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
router.get('/cn-list', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER'), async (req, res) => {
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
router.get('/cn-detail/:soInvId', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER'), async (req, res) => {
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
