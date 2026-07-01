/**
 * giveaway.js — ของแถม (qty model จาก xls)
 * งบ = จำนวนชิ้น ต่อ ภาค(พนักงาน) × ตรา × รายการ · คงเหลือ = งบ − เบิก
 * ⚠ เขียนเฉพาะ schema wf · อ่าน dbo.EMEmp (read-only)
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

const YEAR = (q) => Number(q) || new Date().getFullYear();

// GET /api/giveaway/regions?year= — สรุปต่อภาค (พนักงาน)
router.get('/regions', async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT v.Region, v.EmpCode, v.EmpId, e.EmpName,
             SUM(v.BudgetQty)    AS TotalBudget,
             SUM(v.WithdrawnQty) AS TotalWithdrawn,
             SUM(v.RemainingQty) AS TotalRemaining,
             COUNT(*)            AS ItemCount,
             SUM(CASE WHEN v.RemainingQty < 0 THEN 1 ELSE 0 END) AS OverCount,
             SUM(CASE WHEN v.RemainingQty < 0 THEN ABS(v.RemainingQty) ELSE 0 END) AS OverQty
      FROM wf.v_GiveawayBudgetStatus v
      LEFT JOIN dbo.EMEmp e WITH (NOLOCK) ON e.EmpCode = v.EmpCode
      WHERE v.PeriodYear = @y
      GROUP BY v.Region, v.EmpCode, v.EmpId, e.EmpName
      ORDER BY v.Region
    `, { y: { type: sql.Int, value: YEAR(req.query.year) } });
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/budget-lines?region=&year= — งบรายรายการของภาค
router.get('/budget-lines', async (req, res) => {
  try {
    const { region } = req.query;
    if (!region) return res.status(400).json({ message: 'region จำเป็น' });
    const r = await wfQuery(`
      SELECT * FROM wf.v_GiveawayBudgetStatus
      WHERE Region = @rg AND PeriodYear = @y
      ORDER BY Brand, ItemName
    `, { rg: { type: sql.NVarChar(60), value: region }, y: { type: sql.Int, value: YEAR(req.query.year) } });
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/withdrawals?region=&year= — log การเบิก
router.get('/withdrawals', async (req, res) => {
  try {
    const { region } = req.query;
    const conds = ['PeriodYear = @y'];
    const inputs = { y: { type: sql.Int, value: YEAR(req.query.year) } };
    if (region) { conds.push('Region = @rg'); inputs.rg = { type: sql.NVarChar(60), value: region }; }
    const r = await wfQuery(`
      SELECT TOP 300 * FROM wf.GiveawayWithdrawal
      WHERE ${conds.join(' AND ')}
      ORDER BY IssueMonth DESC, Id DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/items?brand= — แคตตาล็อกของแถม
router.get('/items', async (req, res) => {
  try {
    const { brand } = req.query;
    const where = brand ? 'WHERE Brand = @b' : '';
    const inputs = brand ? { b: { type: sql.NVarChar(50), value: brand } } : {};
    const r = await wfQuery(`SELECT Id, Brand, ItemName, ItemType FROM wf.GiveawayItem ${where} ORDER BY Brand, ItemName`, inputs);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/giveaway/withdrawals — บันทึกการเบิกใหม่ (Source='APP')
router.post('/withdrawals', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
    const { region, brand, itemName, qty, issueMonth, custId, note } = req.body;
    if (!region || !brand || !itemName || !qty)
      return res.status(400).json({ message: 'region, brand, itemName, qty จำเป็น' });
    const year = YEAR(req.body.periodYear);

    // หา emp ของภาค (จาก budget เดิม) เพื่อ link
    const b = (await wfQuery(
      `SELECT TOP 1 SalesUserId, EmpId, EmpCode FROM wf.GiveawayBudget WHERE Region=@rg AND PeriodYear=@y`,
      { rg: { type: sql.NVarChar(60), value: region }, y: { type: sql.Int, value: year } }
    )).recordset?.[0] || {};

    await wfQuery(`
      INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, IssueMonth, Brand, ItemName, Qty, CustId, Note, Source)
      VALUES (@su, @ei, @ec, @rg, @y, @mo, @br, @it, @qy, @cu, @nt, 'APP')`, {
        su: { type: sql.Int, value: b.SalesUserId ?? null },
        ei: { type: sql.NVarChar(20), value: b.EmpId ?? null },
        ec: { type: sql.NVarChar(20), value: b.EmpCode ?? null },
        rg: { type: sql.NVarChar(60), value: region },
        y:  { type: sql.Int, value: year },
        mo: { type: sql.Int, value: issueMonth || (new Date().getMonth() + 1) },
        br: { type: sql.NVarChar(50), value: brand },
        it: { type: sql.NVarChar(100), value: itemName },
        qy: { type: sql.Decimal(12,2), value: Number(qty) },
        cu: { type: sql.NVarChar(20), value: custId || null },
        nt: { type: sql.NVarChar(300), value: note || null },
      });

    // คำนวณคงเหลือหลังเบิก (เตือนเกินงบ)
    const st = (await wfQuery(
      `SELECT BudgetQty, WithdrawnQty, RemainingQty FROM wf.v_GiveawayBudgetStatus
       WHERE Region=@rg AND PeriodYear=@y AND Brand=@br AND ItemName=@it`,
      { rg: { type: sql.NVarChar(60), value: region }, y: { type: sql.Int, value: year },
        br: { type: sql.NVarChar(50), value: brand }, it: { type: sql.NVarChar(100), value: itemName } }
    )).recordset?.[0];
    res.json({ ok: true, status: st, isOverBudget: st ? Number(st.RemainingQty) < 0 : false });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/giveaway/budgets — ตั้ง/แก้งบ (upsert) ADMIN/MANAGER
router.post('/budgets', requireRole('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { region, brand, itemName, budgetQty, empCode } = req.body;
    if (!region || !brand || !itemName) return res.status(400).json({ message: 'region, brand, itemName จำเป็น' });
    const year = YEAR(req.body.periodYear);
    await wfQuery(`
      MERGE wf.GiveawayBudget AS t
      USING (SELECT @rg AS Region, @y AS PeriodYear, @br AS Brand, @it AS ItemName) AS s
        ON t.Region=s.Region AND t.PeriodYear=s.PeriodYear AND t.Brand=s.Brand AND t.ItemName=s.ItemName
      WHEN MATCHED THEN UPDATE SET BudgetQty=@bq, UpdatedAt=GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (Region, PeriodYear, Brand, ItemName, BudgetQty, EmpCode)
        VALUES (@rg, @y, @br, @it, @bq, @ec);
    `, {
      rg: { type: sql.NVarChar(60), value: region }, y: { type: sql.Int, value: year },
      br: { type: sql.NVarChar(50), value: brand }, it: { type: sql.NVarChar(100), value: itemName },
      bq: { type: sql.Decimal(12,2), value: Number(budgetQty) || 0 },
      ec: { type: sql.NVarChar(20), value: empCode || null },
    });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/my-quota — Get current user's quota
router.get('/my-quota', async (req, res) => {
  try {
    const year = YEAR(req.query.year);
    const r = await wfQuery(`
      SELECT * FROM wf.v_GiveawayBudgetStatus
      WHERE SalesUserId = @u AND PeriodYear = @y
    `, { u: { type: sql.Int, value: req.user.id }, y: { type: sql.Int, value: year } });
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/available-lenders — Get users who have quota for an item
router.get('/available-lenders', async (req, res) => {
  try {
    const { brand, itemName } = req.query;
    const year = YEAR(req.query.year);
    if (!brand || !itemName) return res.status(400).json({ message: 'brand and itemName are required' });
    const r = await wfQuery(`
      SELECT v.SalesUserId, v.EmpId, v.EmpCode, v.Region, v.RemainingQty, u.DisplayName
      FROM wf.v_GiveawayBudgetStatus v
      JOIN wf.AppUser u ON u.Id = v.SalesUserId
      WHERE v.Brand = @b AND v.ItemName = @i AND v.PeriodYear = @y AND v.RemainingQty > 0 AND v.SalesUserId != @u
      ORDER BY v.RemainingQty DESC
    `, {
      b: { type: sql.NVarChar(50), value: brand },
      i: { type: sql.NVarChar(100), value: itemName },
      y: { type: sql.Int, value: year },
      u: { type: sql.Int, value: req.user.id }
    });
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/giveaway/borrow-requests — Request to borrow quota
router.post('/borrow-requests', async (req, res) => {
  try {
    const { lenderId, region, brand, itemName, qty, reason } = req.body;
    if (!lenderId || !region || !brand || !itemName || !qty) return res.status(400).json({ message: 'Missing required fields' });
    const year = YEAR(req.body.periodYear);
    const r = await wfQuery(`
      INSERT INTO wf.GiveawayBorrowRequest (RequesterId, LenderId, Region, PeriodYear, Brand, ItemName, Qty, Reason, Status)
      OUTPUT INSERTED.Id
      VALUES (@req, @len, @rg, @y, @br, @it, @qty, @rs, 'PENDING')
    `, {
      req: { type: sql.Int, value: req.user.id },
      len: { type: sql.Int, value: Number(lenderId) },
      rg: { type: sql.NVarChar(60), value: region },
      y: { type: sql.Int, value: year },
      br: { type: sql.NVarChar(50), value: brand },
      it: { type: sql.NVarChar(100), value: itemName },
      qty: { type: sql.Decimal(12,2), value: Number(qty) },
      rs: { type: sql.NVarChar(200), value: reason || '' }
    });
    res.json({ ok: true, id: r.recordset[0].Id });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/borrow-requests — Get pending borrow requests for the current user (either requester, lender, or approver)
router.get('/borrow-requests', async (req, res) => {
  try {
    const cond = req.user.role === 'ADMIN' || req.user.role === 'MANAGER' 
      ? '1=1' // Admin/Manager sees all
      : 'b.RequesterId = @u OR b.LenderId = @u';
    const r = await wfQuery(`
      SELECT b.*, req.DisplayName as RequesterName, len.DisplayName as LenderName
      FROM wf.GiveawayBorrowRequest b
      JOIN wf.AppUser req ON req.Id = b.RequesterId
      JOIN wf.AppUser len ON len.Id = b.LenderId
      WHERE ${cond}
      ORDER BY b.RequestedAt DESC
    `, { u: { type: sql.Int, value: req.user.id } });
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/giveaway/borrow-requests/:id/resolve — Approve or Reject
router.patch('/borrow-requests/:id/resolve', async (req, res) => {
  try {
    const { approve, note } = req.body;
    const reqId = Number(req.params.id);
    const bReq = (await wfQuery(`SELECT * FROM wf.GiveawayBorrowRequest WHERE Id=@id`, { id: { type: sql.Int, value: reqId } })).recordset?.[0];
    if (!bReq) return res.status(404).json({ message: 'Request not found' });
    if (bReq.Status !== 'PENDING') return res.status(400).json({ message: 'Request is already resolved' });
    
    // Only Lender or Manager/Admin can approve
    if (req.user.id !== bReq.LenderId && !['MANAGER', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to resolve this request' });
    }

    if (!approve) {
      await wfQuery(`UPDATE wf.GiveawayBorrowRequest SET Status='REJECTED', ApproverId=@u, Note=@n, ResolvedAt=GETUTCDATE() WHERE Id=@id`,
        { id: { type: sql.Int, value: reqId }, u: { type: sql.Int, value: req.user.id }, n: { type: sql.NVarChar(500), value: note || null } });
      return res.json({ ok: true, status: 'REJECTED' });
    }

    // Approve logic: We need to transfer budget.
    // Easiest way is to increase the requester's budget, and increase the lender's withdrawal.
    // Wait, or we just decrease the lender's budget and increase the requester's budget?
    // Let's modify GiveawayBudget for both!
    // 1. Get Lender's Region
    const lenderBudget = (await wfQuery(`SELECT EmpCode FROM wf.GiveawayBudget WHERE SalesUserId=@len AND Region=@rg AND PeriodYear=@y AND Brand=@br AND ItemName=@it`,
      { len: { type: sql.Int, value: bReq.LenderId }, rg: { type: sql.NVarChar(60), value: bReq.Region }, y: { type: sql.Int, value: bReq.PeriodYear }, br: { type: sql.NVarChar(50), value: bReq.Brand }, it: { type: sql.NVarChar(100), value: bReq.ItemName } })).recordset?.[0];
    
    // Decrease lender's budget
    await wfQuery(`
      UPDATE wf.GiveawayBudget SET BudgetQty = BudgetQty - @qty
      WHERE SalesUserId=@len AND Region=@rg AND PeriodYear=@y AND Brand=@br AND ItemName=@it
    `, { qty: { type: sql.Decimal(12,2), value: bReq.Qty }, len: { type: sql.Int, value: bReq.LenderId }, rg: { type: sql.NVarChar(60), value: bReq.Region }, y: { type: sql.Int, value: bReq.PeriodYear }, br: { type: sql.NVarChar(50), value: bReq.Brand }, it: { type: sql.NVarChar(100), value: bReq.ItemName } });
    
    // Increase requester's budget
    const reqBudget = (await wfQuery(`SELECT Id FROM wf.GiveawayBudget WHERE SalesUserId=@req AND Region=@rg AND PeriodYear=@y AND Brand=@br AND ItemName=@it`,
      { req: { type: sql.Int, value: bReq.RequesterId }, rg: { type: sql.NVarChar(60), value: bReq.Region }, y: { type: sql.Int, value: bReq.PeriodYear }, br: { type: sql.NVarChar(50), value: bReq.Brand }, it: { type: sql.NVarChar(100), value: bReq.ItemName } })).recordset?.[0];
    
    if (reqBudget) {
      await wfQuery(`UPDATE wf.GiveawayBudget SET BudgetQty = BudgetQty + @qty WHERE Id=@id`, { qty: { type: sql.Decimal(12,2), value: bReq.Qty }, id: { type: sql.Int, value: reqBudget.Id } });
    } else {
      // Create budget for requester
      // Assume Requester Region is same as Lender Region (since they borrow within region, or we use Lender's region as the context)
      await wfQuery(`
        INSERT INTO wf.GiveawayBudget (SalesUserId, Region, PeriodYear, Brand, ItemName, BudgetQty)
        VALUES (@req, @rg, @y, @br, @it, @qty)
      `, { req: { type: sql.Int, value: bReq.RequesterId }, rg: { type: sql.NVarChar(60), value: bReq.Region }, y: { type: sql.Int, value: bReq.PeriodYear }, br: { type: sql.NVarChar(50), value: bReq.Brand }, it: { type: sql.NVarChar(100), value: bReq.ItemName }, qty: { type: sql.Decimal(12,2), value: bReq.Qty } });
    }

    // Mark as approved
    await wfQuery(`UPDATE wf.GiveawayBorrowRequest SET Status='APPROVED', ApproverId=@u, Note=@n, ResolvedAt=GETUTCDATE() WHERE Id=@id`,
      { id: { type: sql.Int, value: reqId }, u: { type: sql.Int, value: req.user.id }, n: { type: sql.NVarChar(500), value: note || null } });
    
    res.json({ ok: true, status: 'APPROVED' });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
