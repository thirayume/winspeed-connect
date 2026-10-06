/**
 * giveaway.js — ของแถม (qty model จาก xls)
 * งบ = จำนวนชิ้น ต่อ ภาค(พนักงาน) × ตรา × รายการ · คงเหลือ = งบ − เบิก
 * ⚠ เขียนเฉพาะ schema wf · อ่าน dbo.EMEmp (read-only)
 */
const router = require('express').Router();
const { sql, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireRole, requireCapability } = require('../middleware/auth');
const { logChangeEvent } = require('../services/policy-contract');

const budgetKey = (region, year, brand, item) => `${region}|${year}|${brand}|${item}`;
// R12 O-4: SALES/MANAGER see their own + team regions and records
const { getVisibleScope, scopeFilter, inScope, canViewSalesUser } = require('../services/visible-scope');

router.use(requireAuth);

// R12 item 8: ยืมได้สูงสุดกี่ % ของโควต้าคงเหลือของผู้ให้ยืม (wf.SystemSetting, ค่าเริ่มต้น 100)
async function borrowMaxPct(queryFn = wfQuery) {
  try {
    const r = await queryFn(`SELECT SettingValue FROM wf.SystemSetting WITH (NOLOCK) WHERE SettingKey = 'GIVEAWAY_BORROW_MAX_PCT'`);
    const n = parseInt(r?.recordset?.[0]?.SettingValue, 10);
    if (Number.isInteger(n) && n >= 0 && n <= 100) return n;
  } catch { /* setting table unavailable */ }
  return 100;
}

function borrowLimit(remaining, pct) {
  return Math.floor(Math.max(0, Number(remaining) || 0) * pct) / 100;
}

const APPROVER_ROLES = ['ADMIN', 'MANAGER', 'C_LEVEL'];

const YEAR = (q) => {
  let y = Number(q) || new Date().getFullYear();
  if (y < 2500) y += 543;
  return y;
};

// GET /api/giveaway/regions?year= — สรุปต่อภาค (พนักงาน)
router.get('/regions', async (req, res) => {
  try {
    const sf = scopeFilter(await getVisibleScope(req.user), { userCol: 'v.SalesUserId', prefix: 'gr' });
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
      WHERE v.PeriodYear = @y AND ${sf.sql}
      GROUP BY v.Region, v.EmpCode, v.EmpId, e.EmpName
      ORDER BY v.Region
    `, { y: { type: sql.Int, value: YEAR(req.query.year) }, ...sf.inputs });
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/budget-lines?region=&year= — งบรายรายการของภาค
router.get('/budget-lines', async (req, res) => {
  try {
    const { region } = req.query;
    if (!region) return res.status(400).json({ message: 'region จำเป็น' });
    const sf = scopeFilter(await getVisibleScope(req.user), { userCol: 'b.SalesUserId', prefix: 'gb' });
    const r = await wfQuery(`
      SELECT * FROM wf.v_GiveawayBudgetStatus
      WHERE Region = @rg AND PeriodYear = @y
        AND EXISTS (SELECT 1 FROM wf.GiveawayBudget b WHERE b.Region = @rg AND b.PeriodYear = @y AND ${sf.sql})
      ORDER BY Brand, ItemName
    `, { rg: { type: sql.NVarChar(60), value: region }, y: { type: sql.Int, value: YEAR(req.query.year) }, ...sf.inputs });
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
    const sf = scopeFilter(await getVisibleScope(req.user), { userCol: 'SalesUserId', prefix: 'gw' });
    conds.push(sf.sql); Object.assign(inputs, sf.inputs);
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
router.post('/withdrawals', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'MANAGER', 'APPROVER', 'C_LEVEL'), async (req, res) => {
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

// POST /api/giveaway/budgets — ตั้ง/แก้งบ (upsert) ADMIN/MANAGER · R12 item 8: validated + audited
router.post('/budgets', requireCapability('giveaway.budget'), async (req, res) => {
  try {
    const { region, brand, itemName, budgetQty, empCode, reason } = req.body;
    if (!region || !brand || !itemName) return res.status(400).json({ message: 'region, brand, itemName จำเป็น' });
    const qtyNum = Number(budgetQty);
    if (!Number.isFinite(qtyNum) || qtyNum < 0) return res.status(400).json({ message: 'จำนวนงบต้องเป็นตัวเลขไม่ติดลบ' });
    const year = YEAR(req.body.periodYear);
    const before = (await wfQuery(
      `SELECT BudgetQty, WithdrawnQty, RemainingQty FROM wf.v_GiveawayBudgetStatus WHERE Region=@rg AND PeriodYear=@y AND Brand=@br AND ItemName=@it`,
      { rg: { type: sql.NVarChar(60), value: region }, y: { type: sql.Int, value: year }, br: { type: sql.NVarChar(50), value: brand }, it: { type: sql.NVarChar(100), value: itemName } }
    )).recordset?.[0] || null;
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
    await logChangeEvent(null, {
      entityType: 'GIVEAWAY_BUDGET',
      entityId: budgetKey(region, year, brand, itemName),
      action: before ? 'UPDATE' : 'CREATE',
      beforeJson: before ? { budgetQty: Number(before.BudgetQty), withdrawnQty: Number(before.WithdrawnQty) } : null,
      afterJson: { budgetQty: qtyNum },
      reasonCode: 'GIVEAWAY_QUOTA_SETTING',
      reasonText: reason ? String(reason).slice(0, 500) : null,
      userId: String(req.user.sub),
      ipAddress: req.ip,
    });
    const warning = before && qtyNum < Number(before.WithdrawnQty || 0)
      ? `งบใหม่ (${qtyNum}) น้อยกว่ายอดเบิกแล้ว (${Number(before.WithdrawnQty)}) — โควต้าคงเหลือจะติดลบ` : null;
    res.json({ ok: true, warning });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/budget-history?region=&year= — audit trail of quota settings and borrow moves (R12 item 8)
router.get('/budget-history', requireCapability('giveaway.budget'), async (req, res) => {
  try {
    const { region } = req.query;
    if (!region) return res.status(400).json({ message: 'region จำเป็น' });
    const year = YEAR(req.query.year);
    const changes = (await wfQuery(`
      SELECT TOP 300 e.EventId AS Id, e.EntityId, e.Action, e.BeforeJson, e.AfterJson, e.ReasonText, e.UserId, e.CreatedAt, u.DisplayName AS UserName
      FROM wf.ChangeEvent e
      LEFT JOIN wf.AppUser u ON CAST(u.Id AS VARCHAR(50)) = e.UserId
      WHERE e.EntityType = 'GIVEAWAY_BUDGET' AND e.EntityId LIKE @prefix
      ORDER BY e.EventId DESC
    `, { prefix: { type: sql.NVarChar(120), value: `${region}|${year}|%` } })).recordset || [];
    const borrows = (await wfQuery(`
      SELECT TOP 300 b.*, rq.DisplayName AS RequesterName, ln.DisplayName AS LenderName
      FROM wf.GiveawayBorrowRequest b
      JOIN wf.AppUser rq ON rq.Id = b.RequesterId
      JOIN wf.AppUser ln ON ln.Id = b.LenderId
      WHERE b.PeriodYear = @y AND (b.Region = @rg OR b.Reason LIKE @tag1 OR b.Reason LIKE @tag2
        OR EXISTS (SELECT 1 FROM wf.GiveawayBudget g WHERE g.Region = @rg AND g.PeriodYear = @y AND g.SalesUserId IN (b.RequesterId, b.LenderId)))
      ORDER BY b.RequestedAt DESC
    `, {
      y: { type: sql.Int, value: year }, rg: { type: sql.NVarChar(60), value: region },
      tag1: { type: sql.NVarChar(80), value: `%[REQ_RG:${region}]%` }, tag2: { type: sql.NVarChar(80), value: `%[LEN_RG:${region}]%` },
    })).recordset || [];
    res.json({ changes, borrows });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/my-quota — Get user's quota (current user or target sales user)
router.get('/my-quota', async (req, res) => {
  try {
    const year = YEAR(req.query.year);
    const targetUserId = req.query.salesUserId ? Number(req.query.salesUserId) : req.user.id;
    if (!(await canViewSalesUser(req.user, targetUserId))) {
      return res.status(403).json({ message: 'ดูโควต้าของพนักงานขายคนอื่นได้เฉพาะคนในทีม' });
    }
    const r = await wfQuery(`
      SELECT * FROM wf.v_GiveawayBudgetStatus
      WHERE SalesUserId = @u AND PeriodYear = @y
    `, { u: { type: sql.Int, value: targetUserId }, y: { type: sql.Int, value: year } });
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
    const { lenderId, region, requesterRegion, lenderRegion, brand, itemName, qty, reason } = req.body;
    if (!lenderId || !brand || !itemName || !qty) {
      return res.status(400).json({ message: 'ข้อมูลจำเป็นไม่ครบถ้วน (lenderId, brand, itemName, qty)' });
    }

    // U-6: Block borrowing from yourself
    if (Number(req.user.id) === Number(lenderId)) {
      return res.status(400).json({ message: 'ไม่สามารถขอยืมโควตาจากตนเองได้' });
    }

    const year = YEAR(req.body.periodYear);
    const borrowQty = Number(qty);
    if (isNaN(borrowQty) || borrowQty <= 0) {
      return res.status(400).json({ message: 'จำนวนที่ขอยืมต้องมากกว่า 0' });
    }

    // U-6: ภาคของผู้ขอและผู้ให้ยืมมาจากงบในระบบ ไม่เชื่อค่าที่หน้าจอส่งมา (ใช้ค่าที่ส่งมาเฉพาะเมื่อไม่มีงบ)
    const lenderLine = (await wfQuery(
      `SELECT TOP 1 Region, RemainingQty FROM wf.v_GiveawayBudgetStatus WHERE SalesUserId=@u AND PeriodYear=@y AND Brand=@br AND ItemName=@it`,
      { u: { type: sql.Int, value: Number(lenderId) }, y: { type: sql.Int, value: year }, br: { type: sql.NVarChar(50), value: brand }, it: { type: sql.NVarChar(100), value: itemName } }
    )).recordset?.[0];
    if (!lenderLine) {
      return res.status(400).json({ message: `ผู้ให้ยืมไม่มีงบของแถม ${brand} ${itemName} ในปี ${year}` });
    }
    const requesterLine = (await wfQuery(
      `SELECT TOP 1 Region FROM wf.GiveawayBudget WHERE SalesUserId=@u AND PeriodYear=@y ORDER BY CASE WHEN Brand=@br AND ItemName=@it THEN 0 ELSE 1 END`,
      { u: { type: sql.Int, value: Number(req.user.id) }, y: { type: sql.Int, value: year }, br: { type: sql.NVarChar(50), value: brand }, it: { type: sql.NVarChar(100), value: itemName } }
    )).recordset?.[0];
    const lenRegion = String(lenderLine.Region || '').trim();
    const reqRegion = String(requesterLine?.Region || requesterRegion || region || '').trim();
    if (!reqRegion) {
      return res.status(400).json({ message: 'ไม่พบภาคของผู้ขอยืม (ยังไม่มีงบของแถมในปีนี้) กรุณาระบุภาค' });
    }
    if (reqRegion === lenRegion) {
      return res.status(400).json({ message: 'ผู้ขอและผู้ให้ยืมอยู่ภาคเดียวกัน ไม่ต้องยืมโควต้า' });
    }

    // R12 item 8: เพดานการยืม
    const pct = await borrowMaxPct();
    const limit = borrowLimit(lenderLine.RemainingQty, pct);
    if (borrowQty > limit) {
      return res.status(400).json({ message: `ขอยืมได้ไม่เกิน ${limit} ชิ้น (${pct}% ของโควต้าคงเหลือ ${Number(lenderLine.RemainingQty)} ชิ้น)` });
    }

    // Check if columns RequesterRegion and LenderRegion exist in schema
    let hasRegionCols = false;
    try {
      const colCheck = await wfQuery(`SELECT COL_LENGTH('wf.GiveawayBorrowRequest', 'RequesterRegion') AS HasCol`);
      hasRegionCols = !!colCheck.recordset?.[0]?.HasCol;
    } catch (_) {}

    let r;
    if (hasRegionCols) {
      r = await wfQuery(`
        INSERT INTO wf.GiveawayBorrowRequest (RequesterId, LenderId, Region, RequesterRegion, LenderRegion, PeriodYear, Brand, ItemName, Qty, Reason, Status)
        OUTPUT INSERTED.Id
        VALUES (@req, @len, @rg, @reqRg, @lenRg, @y, @br, @it, @qty, @rs, 'PENDING')
      `, {
        req: { type: sql.Int, value: req.user.id },
        len: { type: sql.Int, value: Number(lenderId) },
        rg: { type: sql.NVarChar(60), value: reqRegion || lenRegion },
        reqRg: { type: sql.NVarChar(60), value: reqRegion || lenRegion },
        lenRg: { type: sql.NVarChar(60), value: lenRegion || reqRegion },
        y: { type: sql.Int, value: year },
        br: { type: sql.NVarChar(50), value: brand },
        it: { type: sql.NVarChar(100), value: itemName },
        qty: { type: sql.Decimal(12,2), value: borrowQty },
        rs: { type: sql.NVarChar(200), value: reason || '' }
      });
    } else {
      // Store region metadata in Reason tag for backwards compatibility when columns aren't in live DB
      const reasonMeta = `[REQ_RG:${reqRegion || lenRegion}][LEN_RG:${lenRegion || reqRegion}] ${reason || ''}`.trim();
      r = await wfQuery(`
        INSERT INTO wf.GiveawayBorrowRequest (RequesterId, LenderId, Region, PeriodYear, Brand, ItemName, Qty, Reason, Status)
        OUTPUT INSERTED.Id
        VALUES (@req, @len, @rg, @y, @br, @it, @qty, @rs, 'PENDING')
      `, {
        req: { type: sql.Int, value: req.user.id },
        len: { type: sql.Int, value: Number(lenderId) },
        rg: { type: sql.NVarChar(60), value: reqRegion || lenRegion },
        y: { type: sql.Int, value: year },
        br: { type: sql.NVarChar(50), value: brand },
        it: { type: sql.NVarChar(100), value: itemName },
        qty: { type: sql.Decimal(12,2), value: borrowQty },
        rs: { type: sql.NVarChar(200), value: reasonMeta }
      });
    }

    res.json({ ok: true, id: r.recordset[0].Id });
  } catch (e) {
    console.error('[giveaway-borrow-requests] error:', e);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการบันทึกคำขอยืมโควตา: ' + e.message });
  }
});

// GET /api/giveaway/borrow-requests — Get pending borrow requests for the current user (either requester, lender, or approver)
router.get('/borrow-requests', async (req, res) => {
  try {
    // R12 O-4: requests where the requester or the lender is in the user's own + team scope
    const scope = await getVisibleScope(req.user);
    const byReq = scopeFilter(scope, { userCol: 'b.RequesterId', prefix: 'bq' });
    const byLen = scopeFilter(scope, { userCol: 'b.LenderId', prefix: 'bl' });
    const r = await wfQuery(`
      SELECT b.*, req.DisplayName as RequesterName, len.DisplayName as LenderName
      FROM wf.GiveawayBorrowRequest b
      JOIN wf.AppUser req ON req.Id = b.RequesterId
      JOIN wf.AppUser len ON len.Id = b.LenderId
      WHERE ${scope.all ? '1=1' : `(${byReq.sql} OR ${byLen.sql})`}
      ORDER BY b.RequestedAt DESC
    `, { ...byReq.inputs, ...byLen.inputs });
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/giveaway/borrow-requests/:id/resolve — Approve or Reject in one atomic transaction (U-6)
// R12 O-4: a team-scoped manager resolves only requests whose requester or lender is in the team
async function requireBorrowRequestInScope(req, res, next) {
  try {
    const scope = await getVisibleScope(req.user);
    if (scope.all) return next();
    const cur = (await wfQuery(`SELECT RequesterId, LenderId FROM wf.GiveawayBorrowRequest WHERE Id=@id`,
      { id: { type: sql.Int, value: Number(req.params.id) || 0 } })).recordset?.[0];
    if (cur && !inScope(scope, { userId: cur.RequesterId, extraUserIds: [cur.LenderId] })) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลคำขอยืมโควตา' });
    }
    next();
  } catch (e) { res.status(500).json({ message: e.message }); }
}

router.patch('/borrow-requests/:id/resolve', requireBorrowRequestInScope, async (req, res) => {
  try {
    const { approve, note } = req.body;
    const reqId = Number(req.params.id);
    if (!reqId) return res.status(400).json({ message: 'รหัสคำขอไม่ถูกต้อง' });

    // Reject flow — ผู้ให้ยืม ผู้ขอ (ยกเลิกคำขอตัวเอง) หรือ ADMIN/MANAGER/C_LEVEL เท่านั้น
    if (!approve) {
      const cur = (await wfQuery(`SELECT RequesterId, LenderId, Status FROM wf.GiveawayBorrowRequest WHERE Id=@id`, { id: { type: sql.Int, value: reqId } })).recordset?.[0];
      if (!cur) return res.status(404).json({ message: 'ไม่พบข้อมูลคำขอยืมโควตา' });
      const uid = Number(req.user.id);
      if (uid !== Number(cur.LenderId) && uid !== Number(cur.RequesterId) && !APPROVER_ROLES.includes(req.user.role)) {
        return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ปฏิเสธคำขอนี้' });
      }
      const rejectRes = await wfQuery(`
        UPDATE wf.GiveawayBorrowRequest 
        SET Status = 'REJECTED', ApproverId = @u, Note = @n, ResolvedAt = GETUTCDATE()
        WHERE Id = @id AND Status = 'PENDING'
      `, {
        id: { type: sql.Int, value: reqId },
        u: { type: sql.Int, value: req.user.id },
        n: { type: sql.NVarChar(500), value: note || null },
      });
      if (!rejectRes.rowsAffected?.[0]) {
        return res.status(409).json({ message: 'คำขอนี้ถูกดำเนินการไปแล้วหรือไม่พบข้อมูล' });
      }
      return res.json({ ok: true, status: 'REJECTED' });
    }

    // Approve flow: Atomic transaction with UPDLOCK/ROWLOCK
    await wfTransaction(async (tx) => {
      // 1. Lock and fetch the borrow request
      const bReq = (await tx.request()
        .input('id', sql.Int, reqId)
        .query(`SELECT * FROM wf.GiveawayBorrowRequest WITH (UPDLOCK, ROWLOCK) WHERE Id = @id`)).recordset?.[0];

      if (!bReq) {
        throw Object.assign(new Error('ไม่พบข้อมูลคำขอยืมโควตา'), { status: 404 });
      }
      if (bReq.Status !== 'PENDING') {
        throw Object.assign(new Error('คำขอนี้ได้รับการดำเนินการไปแล้ว'), { status: 409 });
      }

      // Check permission: only Lender or ADMIN/MANAGER/C_LEVEL can resolve
      if (Number(req.user.id) !== Number(bReq.LenderId) && !APPROVER_ROLES.includes(req.user.role)) {
        throw Object.assign(new Error('คุณไม่มีสิทธิ์อนุมัติคำขอนี้'), { status: 403 });
      }

      // 2. Resolve lender region and requester region
      let lenderRegion = bReq.LenderRegion || null;
      let requesterRegion = bReq.RequesterRegion || null;

      // Extract from reason tag if not in columns
      if (!lenderRegion || !requesterRegion) {
        const reasonStr = String(bReq.Reason || '');
        const reqMatch = reasonStr.match(/\[REQ_RG:([^\]]+)\]/);
        const lenMatch = reasonStr.match(/\[LEN_RG:([^\]]+)\]/);
        if (reqMatch) requesterRegion = reqMatch[1];
        if (lenMatch) lenderRegion = lenMatch[1];
      }

      // Fallback: look up regions from GiveawayBudget
      if (!lenderRegion) {
        const lBudgetRow = (await tx.request()
          .input('len', sql.Int, bReq.LenderId)
          .input('y', sql.Int, bReq.PeriodYear)
          .input('br', sql.NVarChar(50), bReq.Brand)
          .input('it', sql.NVarChar(100), bReq.ItemName)
          .query(`
            SELECT TOP 1 Region FROM wf.GiveawayBudget
            WHERE SalesUserId = @len AND PeriodYear = @y AND Brand = @br AND ItemName = @it
          `)).recordset?.[0];
        lenderRegion = lBudgetRow?.Region || bReq.Region;
      }

      if (!requesterRegion) {
        const rBudgetRow = (await tx.request()
          .input('req', sql.Int, bReq.RequesterId)
          .input('y', sql.Int, bReq.PeriodYear)
          .query(`
            SELECT TOP 1 Region FROM wf.GiveawayBudget
            WHERE SalesUserId = @req AND PeriodYear = @y
          `)).recordset?.[0];
        requesterRegion = rBudgetRow?.Region || bReq.Region;
      }

      // 3. Lock lender budget row and verify quota
      const lenderBudget = (await tx.request()
        .input('rg', sql.NVarChar(60), lenderRegion)
        .input('y', sql.Int, bReq.PeriodYear)
        .input('br', sql.NVarChar(50), bReq.Brand)
        .input('it', sql.NVarChar(100), bReq.ItemName)
        .query(`
          SELECT Id, BudgetQty, SalesUserId, EmpCode, EmpId
          FROM wf.GiveawayBudget WITH (UPDLOCK, ROWLOCK)
          WHERE Region = @rg AND PeriodYear = @y AND Brand = @br AND ItemName = @it
        `)).recordset?.[0];

      if (!lenderBudget) {
        throw Object.assign(new Error(`ไม่พบงบโควตาของผู้ให้ยืมในภาค "${lenderRegion}" สำหรับ ${bReq.Brand} ${bReq.ItemName}`), { status: 400 });
      }

      // Calculate lender's withdrawn quantity
      const lenderWithdrawal = (await tx.request()
        .input('rg', sql.NVarChar(60), lenderRegion)
        .input('y', sql.Int, bReq.PeriodYear)
        .input('br', sql.NVarChar(50), bReq.Brand)
        .input('it', sql.NVarChar(100), bReq.ItemName)
        .query(`
          SELECT ISNULL(SUM(Qty), 0) AS Withdrawn
          FROM wf.GiveawayWithdrawal WITH (UPDLOCK)
          WHERE Region = @rg AND PeriodYear = @y AND Brand = @br AND ItemName = @it
        `)).recordset?.[0];

      const currentLenderRemaining = Number(lenderBudget.BudgetQty) - Number(lenderWithdrawal?.Withdrawn || 0);
      const borrowQty = Number(bReq.Qty);

      if (currentLenderRemaining < borrowQty) {
        throw Object.assign(new Error(`โควตาคงเหลือของผู้ให้ยืมไม่เพียงพอ (คงเหลือ ${currentLenderRemaining} ชิ้น, ขอยืม ${borrowQty} ชิ้น)`), { status: 400 });
      }
      // R12 item 8: ตรวจเพดานการยืมซ้ำตอนอนุมัติ (โควต้าอาจลดลงหลังยื่นคำขอ)
      const pct = await borrowMaxPct((text) => tx.request().query(text));
      const limit = borrowLimit(currentLenderRemaining, pct);
      if (borrowQty > limit) {
        throw Object.assign(new Error(`ยืมได้ไม่เกิน ${limit} ชิ้น (${pct}% ของโควต้าคงเหลือ ${currentLenderRemaining} ชิ้น)`), { status: 400 });
      }

      // 4. Deduct from lender region row
      await tx.request()
        .input('id', sql.Int, lenderBudget.Id)
        .input('qty', sql.Decimal(12, 2), borrowQty)
        .query(`
          UPDATE wf.GiveawayBudget
          SET BudgetQty = BudgetQty - @qty, UpdatedAt = GETUTCDATE()
          WHERE Id = @id
        `);

      // 5. Add to requester region row (or create if missing)
      const requesterBudget = (await tx.request()
        .input('rg', sql.NVarChar(60), requesterRegion)
        .input('y', sql.Int, bReq.PeriodYear)
        .input('br', sql.NVarChar(50), bReq.Brand)
        .input('it', sql.NVarChar(100), bReq.ItemName)
        .query(`
          SELECT Id, BudgetQty
          FROM wf.GiveawayBudget WITH (UPDLOCK, ROWLOCK)
          WHERE Region = @rg AND PeriodYear = @y AND Brand = @br AND ItemName = @it
        `)).recordset?.[0];

      if (requesterBudget) {
        await tx.request()
          .input('id', sql.Int, requesterBudget.Id)
          .input('qty', sql.Decimal(12, 2), borrowQty)
          .query(`
            UPDATE wf.GiveawayBudget
            SET BudgetQty = BudgetQty + @qty, UpdatedAt = GETUTCDATE()
            WHERE Id = @id
          `);
      } else {
        // Fetch requester info from AppUser
        const reqUser = (await tx.request()
          .input('uid', sql.Int, bReq.RequesterId)
          .query(`SELECT Id, EmpId FROM wf.AppUser WHERE Id = @uid`)).recordset?.[0];

        await tx.request()
          .input('su', sql.Int, bReq.RequesterId)
          .input('ei', sql.NVarChar(20), reqUser?.EmpId || null)
          .input('ec', sql.NVarChar(20), reqUser?.EmpId || null)
          .input('rg', sql.NVarChar(60), requesterRegion)
          .input('y', sql.Int, bReq.PeriodYear)
          .input('br', sql.NVarChar(50), bReq.Brand)
          .input('it', sql.NVarChar(100), bReq.ItemName)
          .input('qty', sql.Decimal(12, 2), borrowQty)
          .query(`
            INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
            VALUES (@su, @ei, @ec, @rg, @y, @br, @it, @qty)
          `);
      }

      // 6. Mark borrow request as APPROVED
      const finalUpdate = await tx.request()
        .input('id', sql.Int, reqId)
        .input('u', sql.Int, req.user.id)
        .input('n', sql.NVarChar(500), note || null)
        .query(`
          UPDATE wf.GiveawayBorrowRequest
          SET Status = 'APPROVED', ApproverId = @u, Note = @n, ResolvedAt = GETUTCDATE()
          WHERE Id = @id AND Status = 'PENDING'
        `);

      if (!finalUpdate.rowsAffected?.[0]) {
        throw Object.assign(new Error('คำขอนี้ได้รับการดำเนินการไปแล้ว'), { status: 409 });
      }

      // R12 item 8: the quota move is part of the budget audit trail
      await logChangeEvent(tx, {
        entityType: 'GIVEAWAY_BUDGET',
        entityId: budgetKey(lenderRegion, bReq.PeriodYear, bReq.Brand, bReq.ItemName),
        action: 'BORROW_OUT',
        afterJson: { borrowRequestId: reqId, qty: borrowQty, toRegion: requesterRegion },
        reasonCode: 'GIVEAWAY_BORROW',
        reasonText: note || null,
        userId: String(req.user.sub),
        ipAddress: req.ip,
      });
      await logChangeEvent(tx, {
        entityType: 'GIVEAWAY_BUDGET',
        entityId: budgetKey(requesterRegion, bReq.PeriodYear, bReq.Brand, bReq.ItemName),
        action: 'BORROW_IN',
        afterJson: { borrowRequestId: reqId, qty: borrowQty, fromRegion: lenderRegion },
        reasonCode: 'GIVEAWAY_BORROW',
        reasonText: note || null,
        userId: String(req.user.sub),
        ipAddress: req.ip,
      });
    });

    res.json({ ok: true, status: 'APPROVED' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('[giveaway-borrow-resolve] error:', e);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการอนุมัติคำขอยืมโควตา: ' + e.message });
  }
});

module.exports = router;
