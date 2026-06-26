/**
 * giveaway.js — ของแถม (qty model จาก xls)
 * งบ = จำนวนชิ้น ต่อ ภาค(พนักงาน) × ตรา × รายการ · คงเหลือ = งบ − เบิก
 * ⚠ เขียนเฉพาะ schema wf · อ่าน dbo.EMEmp (read-only)
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

const YEAR = (q) => Number(q) || 2569;

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

module.exports = router;
