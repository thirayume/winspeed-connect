/**
 * rebate.js — Rebate Pool + FIFO Ledger + Claims (4-Tier Approval & Multi-Line Items)
 * ⚠ Writes ไปที่ wf schema เท่านั้น
 */
const router = require('express').Router();
const crypto = require('crypto');
const { sql, wfQuery, query, wfTransaction } = require('../db');
const { requireAuth, requireRole, requireRebateAmountAccess, canViewAllRebateAmounts } = require('../middleware/auth');
const { getVisibleScope, scopeFilter, inScope } = require('../services/visible-scope');
const { getPolicySettings, logChangeEvent, validateReasonCode } = require('../services/policy-contract');
const { mapDatabaseError } = require('../services/error-adapter');
const { applyClaimToDraft } = require('../services/rebate-claim-apply');

router.use(requireAuth);

/**
 * Normalizes claim record ensuring scalar types and monetary totals
 */
function normalizeClaim(c) {
  if (!c) return c;
  const rawCRatio = Array.isArray(c.CustomerRatio) ? c.CustomerRatio[0] : c.CustomerRatio;
  const rawWRatio = Array.isArray(c.CompanyRatio) ? c.CompanyRatio[0] : c.CompanyRatio;
  const rawCAmt   = Array.isArray(c.CustomerAmount) ? c.CustomerAmount[0] : c.CustomerAmount;
  const rawRAmt   = Array.isArray(c.RetainedAmount) ? c.RetainedAmount[0] : c.RetainedAmount;
  const rawSelf   = Array.isArray(c.IsSelfClaim) ? c.IsSelfClaim[0] : c.IsSelfClaim;

  return {
    ...c,
    ClaimNo: c.ClaimNo || c.CnDocuNo || `RC-${c.Id}`,
    ClaimDate: c.ClaimDate || c.CreatedAt,
    CustomerRatio: Number(rawCRatio !== null && rawCRatio !== undefined ? rawCRatio : 100.00),
    CompanyRatio: Number(rawWRatio !== null && rawWRatio !== undefined ? rawWRatio : 0.00),
    CustomerAmount: Number(rawCAmt !== null && rawCAmt !== undefined ? rawCAmt : (c.ClaimAmt || 0)),
    RetainedAmount: Number(rawRAmt !== null && rawRAmt !== undefined ? rawRAmt : 0.00),
    IsSelfClaim: Boolean(rawSelf),
  };
}

/**
 * Builds canonical SHA-256 hash covering all financial and transactional parameters (C5)
 */
function buildCanonicalPayloadHash(body) {
  const { custId, poolId, claimAmt, periodYear, periodMonth, reasonCode, reasonText, invoices, note, lines } = body || {};
  const payloadObj = {
    custId: custId ? String(custId).trim() : null,
    poolId: poolId ? Number(poolId) : null,
    claimAmt: claimAmt !== undefined && claimAmt !== null ? Number(claimAmt) : null,
    periodYear: periodYear ? Number(periodYear) : null,
    periodMonth: periodMonth ? Number(periodMonth) : null,
    reasonCode: reasonCode ? String(reasonCode).trim() : null,
    reasonText: reasonText ? String(reasonText).trim() : null,
    invoices: (Array.isArray(invoices) ? invoices : []).map(inv => String(inv).trim()).sort(),
    note: note ? String(note).trim() : null,
    lines: (lines || []).map(l => ({
      goodCode: l.goodCode ? String(l.goodCode).trim() : null,
      qtyTon: l.qtyTon !== undefined && l.qtyTon !== null ? Number(l.qtyTon) : null,
      lineType: l.lineType ? String(l.lineType).trim().toUpperCase() : 'REBATE',
      sourceSOID: l.sourceSOID ? Number(l.sourceSOID) : null,
      sourceListNo: l.sourceListNo ? Number(l.sourceListNo) : null,
      netPricePerTon: l.netPricePerTon !== undefined && l.netPricePerTon !== null ? Number(l.netPricePerTon) : null,
    })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payloadObj)).digest('hex');
}

/**
 * Owner 2026-10-09: claims are cut year by year on the accounting year — only invoice lots dated in the current
 * accounting year can be claimed. REBATE_CLAIM_FISCAL_START_MONTH (1 = January, 0 = no cut-off) sets the year.
 * Returns the first day of the current accounting year (YYYY-MM-DD, Bangkok) or null.
 */
async function claimCutoffDate(todayBkk) {
  const { getSettingValue } = require('../services/policy-contract');
  const month = Number(await getSettingValue('REBATE_CLAIM_FISCAL_START_MONTH'));
  if (!(month >= 1 && month <= 12)) return null;
  const { getBangkokDateString } = require('../services/so-pickup-policy');
  const today = todayBkk || getBangkokDateString();
  let year = Number(today.slice(0, 4));
  const startThisYear = `${year}-${String(month).padStart(2, '0')}-01`;
  if (today < startThisYear) year -= 1;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}
router.claimCutoffDate = claimCutoffDate;

// Helper: Infer Region (01-06 or 99) from customer's SaleAreaID in WINSpeed
/**
 * ชื่อผู้ตัดสินที่จะบันทึกลงร่องรอยการอนุมัติ
 *
 * DecidedByName เป็น snapshot ณ เวลาที่ตัดสิน (เจตนาให้เป็นอย่างนั้น เพราะชื่อผู้ใช้
 * อาจเปลี่ยนภายหลัง แต่หลักฐานการอนุมัติต้องคงเดิม) จึงต้องเก็บ "ชื่อ" ไม่ใช่รหัส
 *
 * เดิมใช้ req.user.name ซึ่ง token ไม่มีฟิลด์นี้ จึงตกไปใช้ req.user.sub แล้วได้ตัวเลข
 * ทำให้เอกสารที่พิมพ์จากระบบแสดงรหัสแทนชื่อผู้อนุมัติ ใช้เป็นหลักฐานไม่ได้
 */
async function approverName(user) {
  const fromToken = (user?.name || user?.displayName || '').trim();
  if (fromToken) return fromToken.slice(0, 150);
  const row = (await wfQuery(
    `SELECT DisplayName, Username FROM wf.AppUser WHERE Id = @id`,
    { id: { type: sql.Int, value: Number(user?.sub) } }
  )).recordset?.[0];
  return String(row?.DisplayName || row?.Username || `ผู้ใช้ #${user?.sub}`).slice(0, 150);
}

/**
 * Resolves a customer identifier (either CustID or CustCode) to the internal EMCust record.
 * @param {string|number} custKey - Customer code (e.g. '0330005') or CustID (e.g. 1079)
 * @param {Function} [queryFn] - Optional query function (defaults to wfQuery)
 * @returns {Promise<{ custId: number, custCode: string, custName: string, saleAreaId: number|null } | null>}
 */
async function resolveCustomer(custKey, queryFn = wfQuery) {
  const raw = String(custKey || '').trim();
  if (!raw) return null;

  const isNumeric = /^[0-9]+$/.test(raw) && raw.length <= 10;
  const numVal = isNumeric ? Number(raw) : null;

  const result = await queryFn(`
    SELECT TOP 1 CustID, CustCode, CustName, SaleAreaID
    FROM dbo.EMCust WITH (NOLOCK)
    WHERE CustCode = @raw
       OR (@numVal IS NOT NULL AND CustID = @numVal)
    ORDER BY CASE WHEN CustCode = @raw THEN 0 ELSE 1 END, CustID ASC
  `, {
    raw: { type: sql.NVarChar(50), value: raw },
    numVal: { type: sql.Int, value: numVal },
  });

  const row = result?.recordset?.[0];
  if (!row) return null;
  return {
    custId: Number(row.CustID),
    custCode: String(row.CustCode || '').trim(),
    custName: String(row.CustName || '').trim(),
    saleAreaId: row.SaleAreaID != null ? Number(row.SaleAreaID) : null,
  };
}

async function getCustomerRegion(custOrId, queryFn = wfQuery) {
  if (!custOrId) return '99';
  try {
    let saleAreaId = null;
    let custKey = null;
    if (typeof custOrId === 'object' && custOrId !== null) {
      saleAreaId = custOrId.saleAreaId;
      custKey = custOrId.custId;
    } else {
      custKey = custOrId;
    }

    if (saleAreaId != null) {
      const r = await queryFn(`
        SELECT TOP 1 SaleAreaCode
        FROM dbo.EMSaleArea WITH (NOLOCK)
        WHERE SaleAreaID = @aid
      `, { aid: { type: sql.Int, value: saleAreaId } });
      const code = r?.recordset?.[0]?.SaleAreaCode;
      if (code && code.length >= 2) {
        const reg = code.substring(0, 2);
        if (['01', '02', '03', '04', '05', '06'].includes(reg)) return reg;
      }
    }

    const r = await queryFn(`
      SELECT TOP 1 sa.SaleAreaCode
      FROM dbo.EMCust c WITH (NOLOCK)
      JOIN dbo.EMSaleArea sa WITH (NOLOCK) ON sa.SaleAreaID = c.SaleAreaID
      WHERE c.CustID = @cid OR c.CustCode = @code
    `, {
      cid: { type: sql.NVarChar(20), value: String(custKey) },
      code: { type: sql.NVarChar(50), value: String(custKey) }
    });
    const code = r?.recordset?.[0]?.SaleAreaCode;
    if (!code || code.length < 2) return '99';
    const reg = code.substring(0, 2);
    return ['01', '02', '03', '04', '05', '06'].includes(reg) ? reg : '99';
  } catch (e) {
    console.warn(`[rebate] Could not infer region for customer: ${e.message}`);
    return '99';
  }
}

// GET /api/rebate/regions — ดึงรายการภูมิภาคและสิทธิ์การดูแลตามภาคของผู้ใช้
router.get('/regions', async (req, res) => {
  try {
    const regions = (await wfQuery(`SELECT * FROM wf.SaleRegion ORDER BY RegionCode ASC`)).recordset || [];
    const userAreas = (await wfQuery(`
      SELECT ua.*, u.DisplayName, u.Username, u.Role, r.RegionName
      FROM wf.UserSaleArea ua
      JOIN wf.AppUser u ON u.Id = ua.UserId
      JOIN wf.SaleRegion r ON r.RegionCode = ua.RegionCode
      ORDER BY ua.RegionCode, u.DisplayName
    `)).recordset || [];
    res.json({ regions, userAreas });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/rebate/user-regions — จัดตั้ง/อัปเดตผู้ดูแลภาค
router.post('/user-regions', requireRole('ADMIN', 'C_LEVEL', 'MANAGER'), async (req, res) => {
  try {
    const { userId, regionCode, isPrimary } = req.body || {};
    if (!userId || !regionCode) return res.status(400).json({ message: 'userId และ regionCode จำเป็น' });

    const user = (await wfQuery(`SELECT Id FROM wf.AppUser WHERE Id = @uid`, { uid: { type: sql.Int, value: Number(userId) } })).recordset?.[0];
    if (!user) return res.status(404).json({ message: 'ไม่พบบัญชีผู้ใช้' });

    await wfQuery(`
      IF EXISTS (SELECT 1 FROM wf.UserSaleArea WHERE UserId = @uid AND RegionCode = @rcode)
      BEGIN
        UPDATE wf.UserSaleArea SET IsPrimary = @prim WHERE UserId = @uid AND RegionCode = @rcode;
      END
      ELSE
      BEGIN
        INSERT INTO wf.UserSaleArea (UserId, RegionCode, IsPrimary) VALUES (@uid, @rcode, @prim);
      END
    `, {
      uid:   { type: sql.Int,         value: Number(userId) },
      rcode: { type: sql.VarChar(10), value: String(regionCode) },
      prim:  { type: sql.Bit,         value: isPrimary ? 1 : 0 }
    });

    res.json({ success: true, message: 'บันทึกสิทธิ์ดูแลภาคสำเร็จ' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// DELETE /api/rebate/user-regions/:userId/:regionCode — ถอดผู้ดูแลภาค
//
// ต้องมีคู่กับ POST เพราะการแต่งตั้งผิดคนแก้ไม่ได้ถ้าถอดไม่ได้ — ที่ผ่านมา
// เคยมีผู้ดูแลภาคหนึ่งถูกผูกกับภาคใต้ทั้งที่ยอดขายอยู่ภาคอีสาน และไม่มีทางแก้จากหน้าจอเลย
router.delete('/user-regions/:userId/:regionCode', requireRole('ADMIN', 'C_LEVEL', 'MANAGER'), async (req, res) => {
  try {
    const r = await wfQuery(
      `DELETE FROM wf.UserSaleArea WHERE UserId = @uid AND RegionCode = @rc`,
      { uid: { type: sql.Int, value: Number(req.params.userId) },
        rc:  { type: sql.VarChar(10), value: String(req.params.regionCode) } });
    if (!r.rowsAffected?.[0]) return res.status(404).json({ message: 'ไม่พบการผูกภาคนี้กับผู้ใช้รายนี้' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/regions/coverage — ภาค · ผู้ดูแล · จำนวนลูกค้าที่ได้รับผลกระทบ
//
// จำนวนลูกค้าเป็นตัวเลขที่ทำให้เห็นน้ำหนักของช่องที่ยังว่าง — ภาคที่ไม่มีผู้ดูแล
// ไม่ได้แปลว่าใบค้าง แต่แปลว่าชั้นที่ 2 ตกไปให้ผู้จัดการคนใดก็ได้อนุมัติแทน
router.get('/regions/coverage', requireRole('ADMIN', 'C_LEVEL', 'MANAGER'), async (req, res) => {
  try {
    const regions = (await wfQuery(`
      SELECT r.RegionCode, r.RegionName,
             u.Id AS UserId, u.Username, u.DisplayName, u.Role, u.IsActive, ua.IsPrimary
      FROM wf.SaleRegion r
      LEFT JOIN wf.UserSaleArea ua ON ua.RegionCode = r.RegionCode
      LEFT JOIN wf.AppUser u ON u.Id = ua.UserId
      ORDER BY r.RegionCode, ua.IsPrimary DESC, u.DisplayName`)).recordset || [];

    // นับลูกค้าต่อภาคจาก WINSpeed — อ่านอย่างเดียว
    const counts = (await query(`
      SELECT ISNULL(LEFT(a.SaleAreaCode, 2), '99') AS RegionCode, COUNT(*) AS Customers
      FROM dbo.EMCust c
      LEFT JOIN dbo.EMSaleArea a ON a.SaleAreaID = c.SaleAreaID
      GROUP BY ISNULL(LEFT(a.SaleAreaCode, 2), '99')`)) || [];
    const byRegion = new Map(counts.map(c => [String(c.RegionCode), Number(c.Customers)]));

    res.json(regions.map(r => ({ ...r, Customers: byRegion.get(String(r.RegionCode)) || 0 })));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/pools — pool รายเดือนของ sales user
router.get('/pools', requireRebateAmountAccess, async (req, res) => {
  try {
    const { userId, year, month } = req.query;
    const conditions = [];
    const inputs = {};
    // R12 O-4: own + team (org chart); ADMIN/C_LEVEL/ACCOUNTING/APPROVER see all
    const scope = await getVisibleScope(req.user);
    if (!scope.all) {
      const f = scopeFilter(scope, { userCol: 'p.SalesUserId', prefix: 'rp' });
      conditions.push(f.sql); Object.assign(inputs, f.inputs);
    }
    if (userId && (scope.all || scope.userIds.includes(Number(userId)))) { conditions.push(`p.SalesUserId = @uid`); inputs.uid = { type: sql.Int, value: Number(userId) }; }
    if (year)   { conditions.push(`p.PeriodYear = @y`);   inputs.y  = { type: sql.Int, value: Number(year) }; }
    if (month)  { conditions.push(`p.PeriodMonth = @m`);  inputs.m  = { type: sql.Int, value: Number(month) }; }
    
    conditions.push(`(p.AccruedAmt > 0 OR p.ClaimedAmt > 0)`);
    
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await wfQuery(`
      SELECT p.*,
             u.DisplayName AS SalesName,
             ISNULL(u_usage.UsedAmt, 0) AS UsedAmt,
             ISNULL(l_remain.LedgerRemainingAmt, 0) AS LedgerRemainingAmt,
             CASE 
               WHEN (p.AccruedAmt - p.ClaimedAmt - ISNULL(u_usage.UsedAmt, 0)) < ISNULL(l_remain.LedgerRemainingAmt, 0)
               THEN CASE WHEN (p.AccruedAmt - p.ClaimedAmt - ISNULL(u_usage.UsedAmt, 0)) > 0 THEN (p.AccruedAmt - p.ClaimedAmt - ISNULL(u_usage.UsedAmt, 0)) ELSE 0 END
               ELSE CASE WHEN ISNULL(l_remain.LedgerRemainingAmt, 0) > 0 THEN ISNULL(l_remain.LedgerRemainingAmt, 0) ELSE 0 END
             END AS AvailableAmt
      FROM wf.RebatePool p
      JOIN wf.AppUser u ON u.Id = p.SalesUserId
      LEFT JOIN (
        SELECT l.PoolId, SUM(u.DeductedAmt) AS UsedAmt
        FROM wf.RebateUsage u
        JOIN wf.RebateLedger l ON l.Id = u.LedgerId
        WHERE l.ReversedFlag = 0
        GROUP BY l.PoolId
      ) u_usage ON u_usage.PoolId = p.Id
      LEFT JOIN (
        SELECT l.PoolId, SUM(l.RemainingAmt) AS LedgerRemainingAmt
        FROM wf.RebateLedger l
        WHERE l.ReversedFlag = 0
        GROUP BY l.PoolId
      ) l_remain ON l_remain.PoolId = p.Id
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
    const scope = await getVisibleScope(req.user);
    if (!scope.all) {
      const f = scopeFilter(scope, { userCol: 'p.SalesUserId', prefix: 'rl' });
      conditions.push(f.sql); Object.assign(inputs, f.inputs);
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

// GET /api/rebate/claims — รายการเคลม
router.get('/claims', requireRebateAmountAccess, async (req, res) => {
  try {
    const { status } = req.query;
    const conditions = [];
    const inputs = {};
    if (status) {
      conditions.push(`c.Status = @status`);
      inputs.status = { type: sql.NVarChar(20), value: status };
    }
    const scope = await getVisibleScope(req.user);
    if (!scope.all) {
      // own + team claims, plus claims in a region the user approves at tier 2 (wf.UserSaleArea)
      const f = scopeFilter(scope, { userCol: 'c.SalesUserId', prefix: 'rc' });
      conditions.push(`(${f.sql} OR c.RegionCode IN (SELECT RegionCode FROM wf.UserSaleArea WHERE UserId = @rcMe))`);
      Object.assign(inputs, f.inputs, { rcMe: { type: sql.Int, value: Number(req.user.sub) } });
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await wfQuery(`
      SELECT c.*,
             u.DisplayName AS SalesName, r.RegionName,
             (SELECT COUNT(*) FROM wf.RebateClaimLine l WHERE l.ClaimId = c.Id) AS LineCount,
             (SELECT COUNT(*) FROM wf.RebateClaimInvoice i WHERE i.ClaimId = c.Id) AS InvoiceCount
      FROM wf.RebateClaim c
      JOIN wf.AppUser u ON u.Id = c.SalesUserId
      LEFT JOIN wf.SaleRegion r ON r.RegionCode = c.RegionCode
      ${where}
      ORDER BY c.CreatedAt DESC
    `, inputs);
    res.json((r.recordset || []).map(normalizeClaim));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/claims/:id — ดึงใบขอเคลียร์ใบเดียวพร้อมรายการย่อย และประวัติการอนุมัติ
router.get('/claims/:id', requireRebateAmountAccess, async (req, res) => {
  try {
    const claimId = Number(req.params.id);
    if (!Number.isFinite(claimId)) return res.status(400).json({ message: 'Invalid claim ID' });

    const claimR = await wfQuery(`
      SELECT c.*,
             u.DisplayName AS SalesName, r.RegionName, appvUser.DisplayName AS ApprovedByName
      FROM wf.RebateClaim c
      JOIN wf.AppUser u ON u.Id = c.SalesUserId
      LEFT JOIN wf.SaleRegion r ON r.RegionCode = c.RegionCode
      LEFT JOIN wf.AppUser appvUser ON appvUser.Id = c.ApprovedBy
      WHERE c.Id = @id
    `, { id: { type: sql.Int, value: claimId } });

    const rawClaim = claimR.recordset?.[0];
    if (!rawClaim) return res.status(404).json({ message: `ไม่พบใบขอเคลียร์ ID ${claimId}` });
    // R12 O-4: own + team claims, plus claims in a region the user approves (wf.UserSaleArea)
    const claimScope = await getVisibleScope(req.user);
    if (!claimScope.all && !inScope(claimScope, { userId: rawClaim.SalesUserId })) {
      const regionApprover = rawClaim.RegionCode && (await wfQuery(
        `SELECT 1 AS ok FROM wf.UserSaleArea WHERE UserId = @uid AND RegionCode = @rc`,
        { uid: { type: sql.Int, value: Number(req.user.sub) }, rc: { type: sql.VarChar(10), value: String(rawClaim.RegionCode) } }
      )).recordset?.[0];
      if (!regionApprover) return res.status(404).json({ message: `ไม่พบใบขอเคลียร์ ID ${claimId}` });
    }
    const claim = normalizeClaim(rawClaim);

    // Customer Name lookup
    if (claim.CustId) {
      const custR = await wfQuery(`SELECT TOP 1 CustName FROM dbo.EMCust WHERE CustID = @cid`, { cid: { type: sql.NVarChar(20), value: claim.CustId } });
      claim.CustName = custR.recordset?.[0]?.CustName || claim.CustId;
    }

    const lines = (await wfQuery(`
      SELECT l.*, p.Title AS PlanTitle, p.PlanNo
      FROM wf.RebateClaimLine l
      LEFT JOIN wf.RebatePlan p ON p.PlanId = l.PlanId
      WHERE l.ClaimId = @id
      ORDER BY CASE l.LineType WHEN 'REBATE' THEN 0 ELSE 1 END, l.[LineNo] ASC
    `, { id: { type: sql.Int, value: claimId } })).recordset || [];

    const approvals = (await wfQuery(`
      -- a.* มีคอลัมน์ DecidedByName อยู่แล้ว การ JOIN มาตั้งชื่อซ้ำทำให้ได้สองค่า
      -- แล้ว driver รวมเป็น "ชื่อ,ชื่อ" — ใช้ค่าที่บันทึกไว้ตอนตัดสินเป็นหลัก
      -- เพราะเป็น snapshot ของหลักฐาน ชื่อผู้ใช้อาจเปลี่ยนภายหลังได้
      SELECT a.*, u.DisplayName AS CurrentDisplayName
      FROM wf.RebateClaimApproval a
      LEFT JOIN wf.AppUser u ON u.Id = a.DecidedBy
      WHERE a.ClaimId = @id
      ORDER BY a.Tier ASC, a.CreatedAt ASC
    `, { id: { type: sql.Int, value: claimId } })).recordset || [];

    const invoices = (await wfQuery(`
      SELECT * FROM wf.RebateClaimInvoice WHERE ClaimId = @id ORDER BY Id ASC
    `, { id: { type: sql.Int, value: claimId } })).recordset || [];

    // แยกยอดสองตารางให้หน้าจอและแบบพิมพ์ใช้ได้ทันที ไม่ต้องรวมเองแล้วเสี่ยงไม่ตรงกัน
    const totals = (await wfQuery(
      `SELECT * FROM wf.v_RebateClaimTotals WHERE ClaimId = @id`,
      { id: { type: sql.Int, value: claimId } })).recordset?.[0] || null;

    // เลขเอกสารสำหรับใบพิมพ์
    let suggestedRbNo = null;
    if (!claim.CnDocuNo) {
      const owner = (await wfQuery(
        `SELECT RebateDocCode FROM wf.AppUser WHERE Id = @uid`,
        { uid: { type: sql.Int, value: claim.SalesUserId } })).recordset?.[0];
      if (owner?.RebateDocCode) {
        const yy = String(beYY()).slice(-2);
        const prefix = `RB${owner.RebateDocCode}${yy}-`;
        const last = (await wfQuery(`
          WITH CandidateDocs AS (
            SELECT DocuNo,
                   CASE 
                     WHEN SUBSTRING(DocuNo, @plen + 1, 10) NOT LIKE '%[^0-9]%'
                      AND SUBSTRING(DocuNo, @plen + 1, 10) <> ''
                      AND (
                        LEN(SUBSTRING(DocuNo, @plen + 1, 10)) <= 9
                        OR (LEN(SUBSTRING(DocuNo, @plen + 1, 10)) = 10 AND CAST(SUBSTRING(DocuNo, @plen + 1, 10) AS BIGINT) <= 2147483647)
                      )
                     THEN CAST(SUBSTRING(DocuNo, @plen + 1, 10) AS INT)
                     ELSE NULL
                   END AS Seq
            FROM   dbo.SOInvHD WITH (NOLOCK)
            WHERE  Docutype = 106 AND DocuNo LIKE @p
          )
          SELECT TOP 1 DocuNo, Seq
          FROM   CandidateDocs
          WHERE  Seq IS NOT NULL
          ORDER  BY Seq DESC, DocuNo DESC`,
          {
            p:    { type: sql.NVarChar(25), value: `${prefix}%` },
            plen: { type: sql.Int, value: prefix.length },
          })).recordset?.[0];
        const next = (last ? Number(last.Seq) : 0) + 1;
        suggestedRbNo = `${prefix}${String(next).padStart(3, '0')}`;
      }
    }

    res.json({ claim, lines, approvals, invoices, totals, suggestedRbNo });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/rebate/claims — ยื่นเคลม (รองรับ Multi-line 6 บรรทัด & 4-Tier Approval parity)
router.post('/claims', requireRole('SALES', 'ACCOUNTING', 'ADMIN', 'C_LEVEL', 'MANAGER'), async (req, res) => {
  try {
    const { poolId, claimAmt, custId: rawCustId, note, lines, invoices, periodYear, periodMonth } = req.body || {};
    if (!claimAmt && (!lines || !lines.length)) {
      return res.status(400).json({ message: 'ต้องระบุ claimAmt หรือรายการย่อย lines' });
    }
    // a salesperson claims against their own pool, which caps the amount; without a pool there was no cap at all
    // (the form always sends one; the cap was checked only in the browser)
    if (!poolId && !canViewAllRebateAmounts(req.user)) {
      return res.status(400).json({ message: 'ต้องยื่นเคลมจาก pool ของตนเอง (ยอดที่ใช้ได้จำกัดตามยอดสะสม)' });
    }

    // Resolve customer code/ID to internal EMCust record
    let cust = null;
    let custId = null;
    if (rawCustId) {
      cust = await resolveCustomer(rawCustId);
      if (!cust) {
        return res.status(404).json({ message: `ไม่พบข้อมูลลูกค้า '${rawCustId}'` });
      }
      custId = cust.custId;
    }

    const isAmountOnly = !lines || !lines.length;
    let authorizedAdjustment = false;
    let adjReasonCode = 'CLAIM_SUBMITTED';
    let adjReasonText = note || 'ยื่นคำขออนุมัติเคลียร์รายการส่งเสริมการขาย';

    if (isAmountOnly) {
      // Amount-only requests bypass delivery lot matching.
      // MUST be an authorized adjustment requiring elevated roles, valid reasonCode, and explicit note.
      const hasElevatedRole = ['ADMIN', 'ACCOUNTING', 'C_LEVEL'].some(r => (req.user?.roles || []).includes(r) || req.user?.role === r);
      if (!hasElevatedRole) {
        return res.status(403).json({
          message: 'การยื่นคำขอแบบไม่ระบุรายการย่อย (Amount-only) สงวนไว้สำหรับการปรับปรุงยอดพิเศษโดย ADMIN, ACCOUNTING หรือ C_LEVEL เท่านั้น',
        });
      }
      if (!custId) {
        return res.status(400).json({ message: 'ต้องระบุรหัสลูกค้า (custId) สำหรับรายการปรับปรุงยอดพิเศษ' });
      }
      const numAmt = Number(claimAmt);
      if (!Number.isFinite(numAmt) || numAmt <= 0) {
        return res.status(400).json({ message: 'ยอดเงินเคลมต้องเป็นตัวเลขจำนวนบวก' });
      }
      adjReasonCode = req.body?.reasonCode || 'MANUAL_ADJUSTMENT';
      adjReasonText = req.body?.reasonText || note;
      if (!adjReasonText || String(adjReasonText).trim().length < 5) {
        return res.status(400).json({ message: 'ต้องระบุเหตุผลและคำอธิบายสำหรับการปรับปรุงยอดพิเศษอย่างน้อย 5 ตัวอักษร' });
      }
      authorizedAdjustment = true;
    }

    // Extract idempotency key from header or body (C5)
    const rawIdemKey = req.headers['idempotency-key'] || req.body?.idempotencyKey;
    let idempotencyKey = null;
    if (rawIdemKey !== undefined && rawIdemKey !== null) {
      const trimmedKey = String(rawIdemKey).trim();
      if (trimmedKey.length > 100) {
        return res.status(400).json({ message: 'Idempotency-Key มีความยาวเกินกำหนด (สูงสุด 100 ตัวอักษร ห้ามตัดทอนอัตโนมัติ)' });
      }
      if (trimmedKey.length > 0) {
        idempotencyKey = trimmedKey;
      }
    }
    let payloadHash = null;

    if (idempotencyKey) {
      // Canonical payload hash covering all financial and transactional parameters (C5)
      payloadHash = buildCanonicalPayloadHash(req.body);

      // Pre-check before transaction for quick idempotent replay
      const preCheck = await wfQuery(`SELECT * FROM wf.RebateClaim WHERE IdempotencyKey = @k`, {
        k: { type: sql.VarChar(100), value: idempotencyKey }
      });
      const existingPre = preCheck.recordset?.[0];
      if (existingPre) {
        // Enforce authorization scope before returning replay (C5)
        const creatorId = existingPre.SalesUserId || existingPre.CreatedBy;
        const isAuthorized = req.user.role === 'ADMIN' ||
                             req.user.role === 'ACCOUNTING' ||
                             req.user.role === 'C_LEVEL' ||
                             (String(creatorId) === String(req.user.sub));
        if (!isAuthorized) {
          return res.status(403).json({ message: 'ไม่มีสิทธิ์เข้าถึงหรือใช้ Idempotency-Key ของผู้ใช้อื่น' });
        }
        if (existingPre.RequestPayloadHash && existingPre.RequestPayloadHash !== payloadHash) {
          return res.status(409).json({ message: 'Idempotency key reused with different payload' });
        }
        const normalized = normalizeClaim(existingPre);
        return res.json({ claim: normalized, ...normalized, replayed: true });
      }
    }

    const regionCode = await getCustomerRegion(cust || custId);
    const parsedLines = [];
    let pYear = Number(periodYear) || null;
    let pMonth = Number(periodMonth) || null;

    // Wrap header, lines, invoice links, pool deduction, and audit inside single atomic wfTransaction (A2, R2, R6, C5)
    const newClaim = await wfTransaction(async (tx) => {
      // A2, C5. Acquire Application Lock on customer AND pool to prevent race conditions across shared budgets
      const lockKeys = [];
      if (custId) lockKeys.push(`RebateCust_${String(custId).trim()}`);
      if (poolId) lockKeys.push(`RebatePool_${poolId}`);
      if (lockKeys.length === 0) lockKeys.push(`RebateUser_${req.user.sub}`);

      for (const lKey of lockKeys) {
        const lockReq = tx.request();
        lockReq.input('rname', sql.NVarChar(255), lKey);
        await lockReq.query(`
          DECLARE @lockRes INT;
          EXEC @lockRes = sp_getapplock @Resource = @rname, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
          IF @lockRes < 0
          BEGIN
            DECLARE @msg NVARCHAR(200);
            SET @msg = CASE 
              WHEN @lockRes = -1 THEN '[ERR:50001] Lock request timed out for rebate allocation'
              WHEN @lockRes = -2 THEN '[ERR:50001] Lock request canceled'
              WHEN @lockRes = -3 THEN '[ERR:50001] Deadlock victim during rebate allocation'
              ELSE '[ERR:50001] Unable to acquire allocation lock for rebate claim'
            END;
            RAISERROR (@msg, 16, 1);
          END;
        `);
      }

      // If idempotencyKey, recheck under lock with authorization verification (C5)
      if (idempotencyKey) {
        const lockedCheckReq = tx.request();
        lockedCheckReq.input('k', sql.VarChar(100), idempotencyKey);
        const lockedCheckRes = await lockedCheckReq.query(`SELECT * FROM wf.RebateClaim WITH (UPDLOCK, HOLDLOCK) WHERE IdempotencyKey = @k`);
        const lockedExisting = lockedCheckRes.recordset?.[0];
        if (lockedExisting) {
          const creatorId = lockedExisting.SalesUserId || lockedExisting.CreatedBy;
          const isAuthorized = req.user.role === 'ADMIN' ||
                               req.user.role === 'ACCOUNTING' ||
                               req.user.role === 'C_LEVEL' ||
                               (String(creatorId) === String(req.user.sub));
          if (!isAuthorized) {
            throw { status: 403, message: 'ไม่มีสิทธิ์เข้าถึงหรือใช้ Idempotency-Key ของผู้ใช้อื่น' };
          }
          if (lockedExisting.RequestPayloadHash && lockedExisting.RequestPayloadHash !== payloadHash) {
            throw { status: 409, message: 'Idempotency key reused with different payload' };
          }
          return { ...lockedExisting, _replayed: true };
        }
      }

      // A3. Policy Snapshot MUST fail closed (no fallback to 100/0 and null snapshot id)
      const snapReq = tx.request();
      const snapRes = await snapReq.query(`
        SELECT TOP 1 SnapshotId, RevisionNumber, CustomerRatio, CompanyRatio
        FROM wf.PolicySnapshot WITH (UPDLOCK, HOLDLOCK)
        WHERE PolicyName = 'REBATE_POLICY'
          AND EffectiveFrom <= SYSUTCDATETIME()
          AND (EffectiveTo IS NULL OR EffectiveTo > SYSUTCDATETIME())
        ORDER BY EffectiveFrom DESC, RevisionNumber DESC
      `);
      const snap = snapRes.recordset?.[0];
      if (!snap) {
        throw {
          status: 500,
          message: 'ไม่พบนโยบายรีเบทที่มีผลบังคับใช้ (Active Policy Snapshot) ในระบบ ไม่สามารถสร้างใบขอเคลียร์ได้',
        };
      }
      const customerRatio = Number(snap.CustomerRatio);
      const companyRatio = Number(snap.CompanyRatio);
      const policySnapshotId = snap.SnapshotId;

      // Pool validation under lock
      let pool = null;
      if (poolId) {
        const poolReq = tx.request();
        poolReq.input('pid', sql.Int, poolId);
        const poolRes = await poolReq.query(`
          SELECT p.*,
                 ISNULL(u_usage.UsedAmt, 0) AS UsedAmt,
                 ISNULL(l_remain.LedgerRemainingAmt, 0) AS LedgerRemainingAmt
          FROM wf.RebatePool p WITH (UPDLOCK, HOLDLOCK)
          LEFT JOIN (
            SELECT l.PoolId, SUM(u.DeductedAmt) AS UsedAmt
            FROM wf.RebateUsage u
            JOIN wf.RebateLedger l ON l.Id = u.LedgerId
            WHERE l.PoolId = @pid AND l.ReversedFlag = 0
            GROUP BY l.PoolId
          ) u_usage ON u_usage.PoolId = p.Id
          LEFT JOIN (
            SELECT l.PoolId, SUM(l.RemainingAmt) AS LedgerRemainingAmt
            FROM wf.RebateLedger l WITH (UPDLOCK)
            WHERE l.PoolId = @pid AND l.ReversedFlag = 0
            GROUP BY l.PoolId
          ) l_remain ON l_remain.PoolId = p.Id
          WHERE p.Id = @pid
        `);
        pool = poolRes.recordset?.[0];
        if (!pool) throw { status: 404, message: 'ไม่พบ pool' };
        if (!canViewAllRebateAmounts(req.user) && Number(pool.SalesUserId) !== Number(req.user.sub)) {
          throw { status: 403, message: 'ไม่มีสิทธิ์เคลม pool ของพนักงานขายอื่น' };
        }
      }

      let totalAmt = Number(claimAmt || 0);

      // A2. Lots validation & FIFO calculation under lock
      if (!isAmountOnly) {
        if (lines.length > 12) throw { status: 400, message: 'ใบขอเคลียร์รองรับสูงสุด 12 รายการย่อย (6 บรรทัดต่อตาราง)' };
        const perTable = lines.reduce((m, l) => {
          const k = String(l.lineType || 'REBATE').toUpperCase() === 'DIFF' ? 'DIFF' : 'REBATE';
          m[k] = (m[k] || 0) + 1; return m;
        }, {});
        for (const [kind, n] of Object.entries(perTable)) {
          if (n > 6) throw { status: 400, message: `ตาราง${kind === 'DIFF' ? 'คืนส่วนต่าง' : 'คืนรีเบท'}รองรับสูงสุด 6 บรรทัด` };
        }
        if (!custId) {
          throw { status: 400, message: 'ต้องระบุลูกค้า (custId) เมื่อยื่นรายการย่อย — ยอดสะสมอ่านจากใบส่งของของลูกค้ารายนั้น' };
        }

        const lotReq = tx.request();
        lotReq.input('cid', sql.NVarChar(20), String(custId));
        const cutoff = await claimCutoffDate();
        lotReq.input('cut', sql.Date, cutoff);
        const lotRes = await lotReq.query(`
          SELECT SourceSOID, SourceListNo, SourceDocuNo, SourceDocuDate, CouponNo,
                 SourceRefSOID, SourceRefListNo, SourceBookingDocuNo,
                 GoodCode, GoodName, ListPricePerTon, NetPricePerTon, RebatePerTon, PlanId,
                 RemainingTonRebate, RemainingTonDiff
          FROM wf.v_RebateAccrualRemaining
          WHERE CustId = @cid AND (RemainingTonRebate > 0 OR RemainingTonDiff > 0)
            AND (@cut IS NULL OR SourceDocuDate >= @cut)
          ORDER BY SourceDocuDate ASC, SourceDocuNo ASC, SourceListNo ASC
        `);
        const lotRows = lotRes.recordset || [];

        const takenInRequest = new Map();
        const keyOf = (lot, kind) => `${lot.SourceSOID}|${lot.SourceListNo}|${kind}`;
        const lotRemaining = (lot, kind) =>
          Math.round((Number(kind === 'DIFF' ? lot.RemainingTonDiff : lot.RemainingTonRebate)
            - (takenInRequest.get(keyOf(lot, kind)) || 0)) * 1000) / 1000;

        const problems = [];
        const skippedNoPlan = [];
        const skippedNoRebate = [];
        let calculatedSum = 0;
        let seq = 0;

        for (const l of lines) {
          const lineType = String(l.lineType || 'REBATE').toUpperCase() === 'DIFF' ? 'DIFF' : 'REBATE';
          const goodCode = String(l.goodCode || '').trim();
          let want = Math.round(Number(l.qtyTon || 0) * 1000) / 1000;
          if (want <= 0) continue;

          const wantedFrom = (l.sourceSOID && l.sourceListNo)
            ? lotRows.filter(r => Number(r.SourceSOID) === Number(l.sourceSOID)
                               && Number(r.SourceListNo) === Number(l.sourceListNo))
            : lotRows.filter(r => String(r.GoodCode) === goodCode);

          if (!wantedFrom.length) {
            problems.push(`${goodCode || '(ไม่ระบุสูตร)'}: ไม่พบยอดขนจริงคงเหลือของสูตรนี้`);
            continue;
          }

          for (const lot of wantedFrom) {
            if (want <= 0) break;
            const avail = lotRemaining(lot, lineType);
            if (avail <= 0) continue;
            const take = Math.min(want, avail);

            const pricePerTon = Number(l.pricePerTon) > 0 ? Number(l.pricePerTon) : Number(lot.ListPricePerTon || 0);
            const userNet = Number(l.netPricePerTon);
            const lotNet  = (lot.NetPricePerTon === null || lot.NetPricePerTon === undefined)
              ? null : Number(lot.NetPricePerTon);
            const netPricePerTon = userNet > 0 ? userNet : lotNet;

            if (netPricePerTon === null) {
              skippedNoPlan.push(`${lot.SourceDocuNo}/${lot.SourceListNo} — ${lot.GoodCode} ${avail} ตัน`);
              continue;
            }

            const rebatePerTon = Math.round((pricePerTon - netPricePerTon) * 100) / 100;
            // UAT batch 6 (APV-04): a lot sold at or below the NET carries no rebate. FIFO reached 2019 invoices at
            // ฿9,800 against a NET of ฿15,000, the amount went negative and the database refused it (HTTP 500)
            if (rebatePerTon <= 0) {
              skippedNoRebate.push(`${lot.SourceDocuNo}/${lot.SourceListNo} ราคา ฿${pricePerTon.toLocaleString()} ≤ NET ฿${netPricePerTon.toLocaleString()}`);
              continue;
            }

            takenInRequest.set(keyOf(lot, lineType), (takenInRequest.get(keyOf(lot, lineType)) || 0) + take);

            const lineAmount = Math.round(take * rebatePerTon * 100) / 100;
            calculatedSum += lineAmount;

            parsedLines.push({
              lineNo: ++seq,
              lineType,
              invoiceNo: (l.invoiceNo ? String(l.invoiceNo).trim() : String(lot.SourceDocuNo || '')).slice(0, 50) || null,
              goodCode: String(lot.GoodCode || l.goodCode).slice(0, 50),
              goodName: String(lot.GoodName || l.goodName || '').slice(0, 200),
              qtyTon: take,
              pricePerTon,
              netPricePerTon,
              rebatePerTon,
              planId: lot.PlanId ?? l.planId ?? null,
              remark: (l.remark ? String(l.remark).trim() : '').slice(0, 500) || null,
              sourceSOID: lot.SourceSOID,
              sourceListNo: lot.SourceListNo,
              sourceDocuNo: lot.SourceDocuNo,
              sourceDocuDate: lot.SourceDocuDate,
              sourceCouponNo: lot.CouponNo,
              sourceRefSOID: lot.SourceRefSOID,
              sourceRefListNo: lot.SourceRefListNo,
              sourceBookingDocuNo: lot.SourceBookingDocuNo,
            });
            want = Math.round((want - take) * 1000) / 1000;
          }

          if (want > 0.001) {
            const kindLabel = lineType === 'DIFF' ? 'คืนส่วนต่าง' : 'คืนรีเบท';
            const hasUserNet = Number(l.netPricePerTon) > 0;
            const totalAvail = wantedFrom.reduce((a, r) =>
              (hasUserNet || r.NetPricePerTon !== null && r.NetPricePerTon !== undefined)
                ? a + Math.max(0, lotRemaining(r, lineType)) : a, 0);
            problems.push(`${goodCode} (${kindLabel}): ขอเคลียร์ ${Number(l.qtyTon)} ตัน แต่ยอดขนจริงที่มีแผนคุ้มครองคงเหลือ `
              + `${Math.round(totalAvail * 1000) / 1000} ตัน — ขาดอีก ${Math.round(want * 1000) / 1000} ตัน`);
          }
        }

        if (problems.length) {
          throw {
            status: 400,
            // the reasons go in the message too: the response carried only the message, so the form showed no detail
            message: `ยอดขอเคลียร์ไม่ตรงกับยอดขนจริง — ${problems.join(' · ')}`
              + (skippedNoRebate.length ? ` (ข้ามใบส่งของที่ราคาไม่สูงกว่า NET ${skippedNoRebate.length} บรรทัด)` : ''),
            source: 'WINSpeed — ใบส่งของ/ใบกำกับ (DocuType 104) ของลูกค้ารายนี้',
            reconciliation: problems,
            skippedNoPlan: skippedNoPlan.length ? skippedNoPlan : undefined,
            skippedNoRebate: skippedNoRebate.length ? [...skippedNoRebate.slice(0, 10), ...(skippedNoRebate.length > 10 ? [`และอีก ${skippedNoRebate.length - 10} บรรทัด`] : [])] : undefined,
          };
        }
        if (!parsedLines.length) {
          throw { status: 400, message: 'ไม่มีรายการที่ตัดสิทธิ์ได้' };
        }
        totalAmt = Math.round(calculatedSum * 100) / 100;
      }
      if (!(totalAmt > 0)) {
        throw { status: 400, message: 'ยอดขอเคลียร์ต้องมากกว่า 0 (ราคาขายต้องสูงกว่าราคาสุทธิ)' };
      }

      if (pool) {
        const usedAmt = Number(pool.UsedAmt || 0);
        const ledgerRemaining = pool.LedgerRemainingAmt != null ? Number(pool.LedgerRemainingAmt) : null;
        const poolUnclaimed = Number(pool.AccruedAmt) - Number(pool.ClaimedAmt) - usedAmt;
        const available = Math.max(0, ledgerRemaining != null ? Math.min(poolUnclaimed, ledgerRemaining) : poolUnclaimed);
        if (totalAmt > available) {
          throw { status: 400, message: `ยอดเกิน: ขอ ฿${totalAmt.toFixed(2)} ใช้ได้ ฿${available.toFixed(2)}` };
        }
      }

      if ((!pYear || !pMonth) && parsedLines.length) {
        const latest = parsedLines
          .map(l => l.sourceDocuDate).filter(Boolean)
          .sort().pop();
        if (latest) {
          const d = new Date(latest);
          pYear = pYear || d.getFullYear();
          pMonth = pMonth || (d.getMonth() + 1);
        }
      }

      // Self-claim and hostile client ratio injection overridden: system policy ratio is strictly enforced
      // Minor-unit financial rounding (R7): total must equal ClaimAmt down to the cent
      const totalCents = Math.round(Number(totalAmt) * 100);
      const customerCents = Math.round(totalCents * (customerRatio / 100));
      const retainedCents = totalCents - customerCents;
      const customerAmount = customerCents / 100;
      const retainedAmount = retainedCents / 100;

      // 1. Create RebateClaim Header
      const headerReq = tx.request();
      headerReq.input('pid', sql.Int, pool ? pool.Id : null);
      headerReq.input('uid', sql.Int, req.user.sub);
      headerReq.input('cid', sql.NVarChar(20), custId || null);
      headerReq.input('amt', sql.Decimal(12,2), totalAmt);
      headerReq.input('note', sql.NVarChar(500), note || null);
      headerReq.input('rcode', sql.VarChar(10), regionCode);
      headerReq.input('py', sql.Int, pYear);
      headerReq.input('pm', sql.Int, pMonth);
      headerReq.input('cRatio', sql.Decimal(5,2), customerRatio);
      headerReq.input('compRatio', sql.Decimal(5,2), companyRatio);
      headerReq.input('cAmt', sql.Decimal(18,2), customerAmount);
      headerReq.input('retAmt', sql.Decimal(18,2), retainedAmount);
      headerReq.input('psId', sql.Int, policySnapshotId);
      headerReq.input('idemKey', sql.VarChar(100), idempotencyKey);
      headerReq.input('payHash', sql.VarChar(64), payloadHash);

      const claimR = await headerReq.query(`
        INSERT INTO wf.RebateClaim (
          PoolId, SalesUserId, CustId, ClaimAmt, RemainingAmt, Status, Note, RegionCode, CurrentTier, PeriodYear, PeriodMonth,
          CustomerRatio, CompanyRatio, CustomerAmount, RetainedAmount, IsSelfClaim, PolicySnapshotId,
          IdempotencyKey, RequestPayloadHash
        )
        OUTPUT inserted.*
        VALUES (
          @pid, @uid, @cid, @amt, @amt, 'TIER2_PENDING', @note, @rcode, 2, @py, @pm,
          @cRatio, @compRatio, @cAmt, @retAmt, 0, @psId,
          @idemKey, @payHash
        )
      `);
      const claim = claimR.recordset[0];

      // 2. Create RebateClaimLine records
      for (const line of parsedLines) {
        const lineReq = tx.request();
        lineReq.input('ltype', sql.NVarChar(10), line.lineType);
        lineReq.input('inv', sql.NVarChar(50), line.invoiceNo);
        lineReq.input('cid', sql.Int, claim.Id);
        lineReq.input('lno', sql.Int, line.lineNo);
        lineReq.input('gcode', sql.NVarChar(50), line.goodCode);
        lineReq.input('gname', sql.NVarChar(200), line.goodName);
        lineReq.input('qty', sql.Decimal(18,3), line.qtyTon);
        lineReq.input('price', sql.Decimal(18,2), line.pricePerTon);
        lineReq.input('netPrice', sql.Decimal(18,2), line.netPricePerTon);
        lineReq.input('rebate', sql.Decimal(18,2), line.rebatePerTon);
        lineReq.input('planId', sql.Int, line.planId);
        lineReq.input('remark', sql.NVarChar(500), line.remark);
        lineReq.input('sSoid', sql.Int, line.sourceSOID ?? null);
        lineReq.input('sList', sql.Int, line.sourceListNo ?? null);
        lineReq.input('sDocu', sql.NVarChar(25), line.sourceDocuNo ?? null);
        lineReq.input('sDate', sql.Date, line.sourceDocuDate ?? null);
        lineReq.input('sCoup', sql.NVarChar(25), line.sourceCouponNo ?? null);
        lineReq.input('sRefSoid', sql.Int, line.sourceRefSOID ?? null);
        lineReq.input('sRefList', sql.Int, line.sourceRefListNo ?? null);
        lineReq.input('sBook', sql.NVarChar(25), line.sourceBookingDocuNo ?? null);

        await lineReq.query(`
          INSERT INTO wf.RebateClaimLine (ClaimId, [LineNo], LineType, InvoiceNo, GoodCode, GoodName, QtyTon, PricePerTon, NetPricePerTon, RebatePerTon, PlanId, Remark,
                                          SourceSOID, SourceListNo, SourceDocuNo, SourceDocuDate, SourceCouponNo,
                                          SourceRefSOID, SourceRefListNo, SourceBookingDocuNo)
          VALUES (@cid, @lno, @ltype, @inv, @gcode, @gname, @qty, @price, @netPrice, @rebate, @planId, @remark,
                  @sSoid, @sList, @sDocu, @sDate, @sCoup, @sRefSoid, @sRefList, @sBook)
        `);
      }

      // 3. Create RebateClaimInvoice records if provided
      if (Array.isArray(invoices) && invoices.length > 0) {
        for (const invNo of invoices) {
          if (!invNo) continue;
          const invReq = tx.request();
          invReq.input('cid', sql.Int, claim.Id);
          invReq.input('dno', sql.NVarChar(50), String(invNo).trim());
          await invReq.query(`INSERT INTO wf.RebateClaimInvoice (ClaimId, DocuNo) VALUES (@cid, @dno)`);
        }
      }

      // 4. Log Tier 1 Submission Approval Record
      const appReq = tx.request();
      appReq.input('cid', sql.Int, claim.Id);
      appReq.input('uid', sql.Int, req.user.sub);
      appReq.input('uname', sql.NVarChar(150), await approverName(req.user));
      await appReq.query(`
        INSERT INTO wf.RebateClaimApproval (ClaimId, Tier, RequiredRole, Decision, DecidedBy, DecidedByName, DecidedAt, Reason)
        VALUES (@cid, 1, 'SALES', 'APPROVED', @uid, @uname, GETUTCDATE(), 'ยื่นใบขออนุมัติเคลียร์รีเบท')
      `);

      // 5. ตัดงบที่จัดสรร (เฉพาะใบที่ผูกกับ pool)
      if (pool) {
        let remaining = totalAmt;
        const ledReq = tx.request();
        ledReq.input('pid', sql.Int, pool.Id);
        const ledger = (await ledReq.query(`
          SELECT * FROM wf.RebateLedger WITH (UPDLOCK)
          WHERE PoolId=@pid AND RemainingAmt>0 AND ReversedFlag=0
          ORDER BY CreatedAt ASC
        `)).recordset || [];

        for (const row of ledger) {
          if (remaining <= 0) break;
          const cut = Math.min(remaining, Number(row.RemainingAmt));
          const cutReq = tx.request();
          cutReq.input('cut', sql.Decimal(12,2), cut);
          cutReq.input('id', sql.Int, row.Id);
          await cutReq.query(`
            UPDATE wf.RebateLedger 
            SET RemainingAmt = RemainingAmt - @cut, 
                Status = CASE WHEN RemainingAmt - @cut <= 0 THEN 'CLAIMED' ELSE Status END 
            WHERE Id=@id
          `);
          remaining -= cut;
        }

        const poolUpdReq = tx.request();
        poolUpdReq.input('amt', sql.Decimal(12,2), totalAmt);
        poolUpdReq.input('id', sql.Int, pool.Id);
        await poolUpdReq.query(`
          UPDATE wf.RebatePool 
          SET ClaimedAmt = ClaimedAmt + @amt, UpdatedAt = GETUTCDATE() 
          WHERE Id=@id
        `);
      }

      // 6. Audit log inside transaction
      await logChangeEvent(tx, {
        entityType: 'REBATE_CLAIM',
        entityId: String(claim.Id),
        action: 'CREATE_CLAIM',
        beforeJson: null,
        afterJson: JSON.stringify({ id: claim.Id, claimAmt: totalAmt, custId }),
        reason: adjReasonText,
        userId: Number(req.user.sub),
      });

      return claim;
    });

    // เอกสารที่รองรับการขอใช้รีเบท — ผู้อนุมัติต้องเห็นว่าอ้างแผนฉบับใด
    const planIds = [...new Set(parsedLines.map(l => l.planId).filter(Boolean))];
    const plans = planIds.length
      ? (await wfQuery(
          `SELECT PlanId, PlanNo, Title, NetPrice, ValidFrom, ValidTo FROM wf.RebatePlan
           WHERE PlanId IN (${planIds.map(Number).join(',')})`)).recordset || []
      : [];
    const linesWithoutPlan = parsedLines.filter(l => !l.planId).length;

    const normalized = normalizeClaim(newClaim);
    res.json({
      ...normalized,
      claim: normalized,
      periodYear: pYear,
      periodMonth: pMonth,
      plans,
      linesWithoutPlan,
      warnings: linesWithoutPlan
        ? [`${linesWithoutPlan} บรรทัดยังไม่มีแบบขออนุมัติรายการส่งเสริมการขายรองรับ — ผู้อนุมัติควรตรวจเอกสารกระดาษประกอบ`]
        : [],
    });
  } catch (e) {
    console.error(e);
    const { status, message } = mapDatabaseError(e, 'เกิดข้อผิดพลาดในการยื่นเคลม');
    res.status(status).json({ message, reconciliation: e.reconciliation, skippedNoPlan: e.skippedNoPlan, skippedNoRebate: e.skippedNoRebate });
  }
});

// POST /api/rebate/claims/:id/approve — 4-Tier Progression Approval
router.post('/claims/:id/approve', async (req, res) => {
  try {
    const claimId = Number(req.params.id);
    const { docuNo, note, expectedTier } = req.body || {};
    const operationKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body?.idempotencyKey || req.body?.operationKey;
    if (!Number.isFinite(claimId)) return res.status(400).json({ message: 'Invalid claim ID' });

    const userRole = String(req.user.role || '').toUpperCase();
    const userId = Number(req.user.sub);
    const userName = await approverName(req.user);

    const result = await wfTransaction(async (tx) => {
      // 1. Transaction-scoped Application Lock on Claim ID
      const claimLockKey = `RebateClaim_${claimId}`;
      const lockReq = tx.request();
      lockReq.input('rname', sql.NVarChar(255), claimLockKey);
      await lockReq.query(`
        DECLARE @lockRes INT;
        EXEC @lockRes = sp_getapplock @Resource = @rname, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 5000;
        IF @lockRes < 0
        BEGIN
          RAISERROR ('[ERR:50001] Unable to acquire lock on rebate claim for decision (timeout/conflict)', 16, 1);
        END;
      `);

      // 2. Fetch locked claim row
      const claimR = await tx.request()
        .input('id', sql.Int, claimId)
        .query(`SELECT * FROM wf.RebateClaim WITH (UPDLOCK, ROWLOCK) WHERE Id = @id`);
      const claim = claimR.recordset?.[0];
      if (!claim) {
        throw Object.assign(new Error(`ไม่พบใบขอเคลียร์ ID ${claimId}`), { status: 404 });
      }

      // 3. Decision Replay Check BEFORE terminal guard
      if (expectedTier) {
        const targetTier = Number(expectedTier);
        const existingDec = (await tx.request()
          .input('cid', sql.Int, claimId)
          .input('tier', sql.Int, targetTier)
          .query(`SELECT TOP 1 * FROM wf.RebateClaimApproval WITH (UPDLOCK, ROWLOCK) WHERE ClaimId = @cid AND Tier = @tier ORDER BY ApprovalId DESC`)
        ).recordset?.[0];

        if (existingDec) {
          if (existingDec.Decision === 'APPROVED') {
            const isActor = Number(existingDec.DecidedBy) === userId || ['ADMIN', 'C_LEVEL'].includes(userRole);
            if (!isActor) {
              throw Object.assign(new Error(`ไม่มีสิทธิ์เข้าถึงหรือเรียกซ้ำการตัดสินของผู้อนุมัติท่านอื่น (DecidedBy: #${existingDec.DecidedBy})`), { status: 403 });
            }
            return {
              id: claimId,
              status: claim.Status,
              currentTier: claim.CurrentTier,
              message: `รายการนี้ได้รับการอนุมัติชั้นที่ ${targetTier} เรียบร้อยแล้ว (Idempotent)`,
              idempotent: true,
              decision: 'APPROVED',
              decidedBy: existingDec.DecidedBy,
              decidedAt: existingDec.DecidedAt
            };
          } else {
            throw Object.assign(new Error(`รายการนี้ได้รับการตัดสินในชั้นที่ ${targetTier} ไปแล้ว (${existingDec.Decision} โดย #${existingDec.DecidedBy})`), { status: 409 });
          }
        }
      } else if (claim.Status === 'APPROVED' || claim.Status === 'CN_ISSUED') {
        const lastApp = (await tx.request()
          .input('cid', sql.Int, claimId)
          .query(`SELECT TOP 1 * FROM wf.RebateClaimApproval WITH (UPDLOCK, ROWLOCK) WHERE ClaimId = @cid AND Tier = 4 AND Decision = 'APPROVED' ORDER BY ApprovalId DESC`)
        ).recordset?.[0];
        if (lastApp && (Number(lastApp.DecidedBy) === userId || ['ADMIN', 'C_LEVEL'].includes(userRole))) {
          return {
            id: claimId,
            status: claim.Status,
            currentTier: claim.CurrentTier,
            message: 'รายการนี้ได้รับการอนุมัติสมบูรณ์แล้ว (Idempotent)',
            idempotent: true,
            decision: 'APPROVED',
            decidedBy: lastApp.DecidedBy,
            decidedAt: lastApp.DecidedAt
          };
        }
      }

      // 4. Terminal states check
      if (claim.Status === 'APPROVED' || claim.Status === 'CN_ISSUED') {
        throw Object.assign(new Error('ใบขอเคลียร์นี้ได้รับการอนุมัติสมบูรณ์แล้ว ไม่สามารถอนุมัติซ้ำได้'), { status: 400 });
      }
      if (claim.Status === 'REJECTED') {
        throw Object.assign(new Error('ใบขอเคลียร์นี้ถูกไม่อนุมัติ (REJECTED) กรุณายื่นใหม่'), { status: 400 });
      }
      if (claim.Status === 'CANCELLED') {
        throw Object.assign(new Error('ใบขอเคลียร์นี้ถูกยกเลิกแล้ว'), { status: 400 });
      }

      const currentTier = Number(claim.CurrentTier || 2);
      if (expectedTier && Number(expectedTier) !== currentTier) {
        throw Object.assign(new Error(`คำขอนี้ไม่อยู่ในชั้นที่ ${expectedTier} (ปัจจุบันอยู่ในชั้นที่ ${currentTier})`), { status: 409 });
      }

      const expectedStatus = currentTier === 2 ? 'TIER2_PENDING'
                           : currentTier === 3 ? 'TIER3_PENDING'
                           : currentTier === 4 ? 'TIER4_PENDING'
                           : null;
      if (!expectedStatus || claim.Status !== expectedStatus) {
        throw Object.assign(new Error(`สถานะของคำขอ (${claim.Status}) ไม่ตรงกับขั้นตอนอนุมัติชั้นที่ ${currentTier}`), { status: 400 });
      }

      // 5. Check Segregation of Duties: Creator cannot approve their own claim unless elevated
      if (Number(claim.SalesUserId) === userId && !['ADMIN', 'C_LEVEL'].includes(userRole)) {
        throw Object.assign(new Error('ไม่อนุญาตให้ผู้ยื่นคำขออนุมัติคำขอของตนเอง (Segregation of Duties)'), { status: 403 });
      }

      // Check consecutive tiers SoD
      const prevApproval = (await tx.request()
        .input('cid', sql.Int, claimId)
        .query(`SELECT TOP 1 DecidedBy, Tier FROM wf.RebateClaimApproval WHERE ClaimId = @cid AND Decision = 'APPROVED' ORDER BY Tier DESC`)
      ).recordset?.[0];

      const allowSameUserOverride = process.env.ALLOW_SINGLE_USER_MULTI_TIER_APPROVAL === 'true';
      if (prevApproval && Number(prevApproval.DecidedBy) === userId && !allowSameUserOverride) {
        throw Object.assign(new Error('ไม่อนุญาตให้บุคคลเดิมอนุมัติซ้ำสองชั้นติดต่อกัน (Segregation of Duties)'), { status: 403 });
      }

      // 6. Tier & Region Authorization
      let requiredRole = '';
      let nextStatus = '';
      let nextTier = currentTier;

      if (currentTier === 2) {
        const regionCode = claim.RegionCode || '99';
        const isRegionalMgr = (await tx.request()
          .input('uid', sql.Int, userId)
          .input('rcode', sql.VarChar(10), regionCode)
          .query(`SELECT 1 FROM wf.UserSaleArea WHERE UserId = @uid AND RegionCode = @rcode`)
        ).recordset?.length > 0;

        const canApproveTier2 = isRegionalMgr || ['ADMIN', 'C_LEVEL'].includes(userRole);
        if (!canApproveTier2) {
          throw Object.assign(new Error(`ไม่มีสิทธิ์อนุมัติชั้นที่ 2 (ผู้จัดการภาค ${regionCode})`), { status: 403 });
        }
        requiredRole = 'REGIONAL_MGR';
        nextStatus = 'TIER3_PENDING';
        nextTier = 3;
      } else if (currentTier === 3) {
        const canApproveTier3 = ['ADMIN', 'C_LEVEL'].includes(userRole);
        if (!canApproveTier3) {
          throw Object.assign(new Error('ไม่มีสิทธิ์อนุมัติชั้นที่ 3 (กรรมการบริหาร)'), { status: 403 });
        }
        requiredRole = 'MARKETING_MGR';
        nextStatus = 'TIER4_PENDING';
        nextTier = 4;
      } else if (currentTier === 4) {
        const canApproveTier4 = ['C_LEVEL', 'ADMIN', 'ACCOUNTING'].includes(userRole);
        if (!canApproveTier4) {
          throw Object.assign(new Error('ไม่มีสิทธิ์อนุมัติชั้นที่ 4 (กรรมการบริหาร / C_LEVEL)'), { status: 403 });
        }
        requiredRole = 'EXECUTIVE';
        nextStatus = 'APPROVED';
        nextTier = 4;
      } else {
        throw Object.assign(new Error('ขั้นตอนอนุมัติไม่ถูกต้อง'), { status: 400 });
      }

      // 7. Tier 4 optional WINSpeed RB check
      let rb = null;
      if (currentTier === 4 && docuNo) {
        rb = (await tx.request()
          .input('dn', sql.NVarChar(25), String(docuNo).trim())
          .query(`SELECT TOP 1 SOInvID, DocuDate, NetAmnt FROM dbo.SOInvHD WHERE DocuNo = @dn AND Docutype = 106`)
        ).recordset?.[0];
      }

      // 8. Conditional State Update
      const updateReq = tx.request();
      updateReq.input('id', sql.Int, claimId);
      updateReq.input('expStatus', sql.VarChar(20), expectedStatus);
      updateReq.input('expTier', sql.Int, currentTier);
      updateReq.input('newStatus', sql.VarChar(20), nextStatus);
      updateReq.input('newTier', sql.Int, nextTier);
      updateReq.input('uid', sql.Int, userId);

      let sqlUpdate = '';
      if (currentTier === 4) {
        updateReq.input('cn', sql.NVarChar(20), docuNo || null);
        updateReq.input('rbid', sql.Int, rb ? rb.SOInvID : null);
        updateReq.input('rbdate', sql.Date, rb ? rb.DocuDate : null);
        sqlUpdate = `
          UPDATE wf.RebateClaim 
          SET Status = @newStatus, 
              CurrentTier = @newTier,
              ApprovedAt = GETUTCDATE(), 
              ApprovedBy = @uid, 
              CnDocuNo = @cn,
              RbSOInvID = @rbid,
              RbDocDate = @rbdate,
              RbMatchedAt = CASE WHEN @rbid IS NULL THEN NULL ELSE GETUTCDATE() END
          WHERE Id = @id AND Status = @expStatus AND CurrentTier = @expTier
        `;
      } else {
        sqlUpdate = `
          UPDATE wf.RebateClaim 
          SET Status = @newStatus, CurrentTier = @newTier 
          WHERE Id = @id AND Status = @expStatus AND CurrentTier = @expTier
        `;
      }

      const updateRes = await updateReq.query(sqlUpdate);
      if (updateRes.rowsAffected[0] !== 1) {
        throw Object.assign(new Error('สถานะของคำขอเปลี่ยนแปลงไปแล้ว กรุณารีเฟรชเพื่อดูสถานะล่าสุด'), { status: 409 });
      }

      // 9. Insert approval record
      const appReq = tx.request();
      appReq.input('cid', sql.Int, claimId);
      appReq.input('tier', sql.Int, currentTier);
      appReq.input('rrole', sql.VarChar(30), requiredRole);
      appReq.input('uid', sql.Int, userId);
      appReq.input('uname', sql.NVarChar(150), userName);
      appReq.input('note', sql.NVarChar(500), note || `อนุมัติชั้นที่ ${currentTier}`);
      await appReq.query(`
        INSERT INTO wf.RebateClaimApproval (ClaimId, Tier, RequiredRole, Decision, DecidedBy, DecidedByName, DecidedAt, Reason)
        VALUES (@cid, @tier, @rrole, 'APPROVED', @uid, @uname, GETUTCDATE(), @note)
      `);

      // 10. Audit log
      await logChangeEvent(tx, {
        entityType: 'REBATE_CLAIM',
        entityId: String(claimId),
        action: `APPROVE_TIER_${currentTier}`,
        beforeJson: JSON.stringify({ status: claim.Status, currentTier: claim.CurrentTier }),
        afterJson: JSON.stringify({ status: nextStatus, currentTier: nextTier }),
        reason: note || `อนุมัติชั้นที่ ${currentTier}`,
        userId,
      });

      const warnings = [];
      if (currentTier === 4) {
        if (!docuNo) warnings.push('ยังไม่ได้ระบุเลขที่ใบคืนรีเบท — ต้องกลับมาเติมเมื่อบัญชีออกใบแล้ว');
        else if (!rb) warnings.push(`ยังไม่พบใบ ${docuNo} ใน WINSpeed — จะขึ้นในรายงานกระทบยอดจนกว่าจะออกใบจริง`);
        else if (Math.abs(Number(rb.NetAmnt) - Number(claim.ClaimAmt)) > 0.01) {
          warnings.push(`ยอดไม่ตรง: ใบขอเคลียร์ ฿${Number(claim.ClaimAmt).toFixed(2)} · ใบ ${docuNo} ใน WINSpeed ฿${Number(rb.NetAmnt).toFixed(2)}`);
        }
      }

      return {
        id: claimId,
        status: nextStatus,
        currentTier: nextTier,
        message: currentTier === 4 ? 'อนุมัติชั้นที่ 4 (กรรมการบริหาร) เสร็จสมบูรณ์' : `อนุมัติชั้นที่ ${currentTier} เรียบร้อย`,
        rbDocuNo: docuNo || null,
        rbMatched: !!rb,
        warnings,
      };
    });

    res.json(result);
  } catch (e) {
    console.error('[POST /claims/:id/approve error]', e.message || e);
    const httpErr = mapDatabaseError(e, 'เกิดข้อผิดพลาดในการอนุมัติใบขอเคลียร์');
    res.status(httpErr.status).json({ message: httpErr.message });
  }
});

// POST /api/rebate/claims/:id/reject — ตีกลับ/ไม่อนุมัติใบขออนุมัติ
router.post('/claims/:id/reject', async (req, res) => {
  try {
    const claimId = Number(req.params.id);
    const { reason, expectedTier } = req.body || {};
    const operationKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body?.idempotencyKey || req.body?.operationKey;
    if (!Number.isFinite(claimId)) return res.status(400).json({ message: 'Invalid claim ID' });

    const trimmedReason = String(reason || '').trim();
    if (trimmedReason.length < 5) {
      return res.status(400).json({ message: 'กรุณาระบุเหตุผลการไม่อนุมัติ (อย่างน้อย 5 ตัวอักษร)' });
    }

    const userRole = String(req.user.role || '').toUpperCase();
    const userId = Number(req.user.sub);
    const userName = await approverName(req.user);

    const result = await wfTransaction(async (tx) => {
      // 1. Transaction-scoped Application Lock on Claim ID
      const claimLockKey = `RebateClaim_${claimId}`;
      const lockReq = tx.request();
      lockReq.input('rname', sql.NVarChar(255), claimLockKey);
      await lockReq.query(`
        DECLARE @lockRes INT;
        EXEC @lockRes = sp_getapplock @Resource = @rname, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 5000;
        IF @lockRes < 0
        BEGIN
          RAISERROR ('[ERR:50001] Unable to acquire lock on rebate claim for decision (timeout/conflict)', 16, 1);
        END;
      `);

      // 2. Fetch locked claim row
      const claimR = await tx.request()
        .input('id', sql.Int, claimId)
        .query(`SELECT * FROM wf.RebateClaim WITH (UPDLOCK, ROWLOCK) WHERE Id = @id`);
      const claim = claimR.recordset?.[0];
      if (!claim) {
        throw Object.assign(new Error(`ไม่พบใบขอเคลียร์ ID ${claimId}`), { status: 404 });
      }

      // 3. Replay check BEFORE terminal state check
      if (claim.Status === 'REJECTED') {
        const lastRejection = (await tx.request()
          .input('cid', sql.Int, claimId)
          .query(`SELECT TOP 1 * FROM wf.RebateClaimApproval WITH (UPDLOCK, ROWLOCK) WHERE ClaimId = @cid AND Decision = 'REJECTED' ORDER BY ApprovalId DESC`)
        ).recordset?.[0];
        if (lastRejection) {
          const isActor = Number(lastRejection.DecidedBy) === userId || ['ADMIN', 'C_LEVEL'].includes(userRole);
          if (!isActor) {
            throw Object.assign(new Error(`ไม่มีสิทธิ์เข้าถึงหรือเรียกซ้ำการตัดสินของผู้อนุมัติท่านอื่น (DecidedBy: #${lastRejection.DecidedBy})`), { status: 403 });
          }
          if (expectedTier && Number(lastRejection.Tier) !== Number(expectedTier)) {
            throw Object.assign(new Error(`รายการนี้ถูกปฏิเสธในชั้นที่ ${lastRejection.Tier} ไม่ตรงกับ expectedTier=${expectedTier}`), { status: 409 });
          }
          if (lastRejection.Reason && trimmedReason && lastRejection.Reason !== trimmedReason) {
            throw Object.assign(new Error('Payload conflict: เหตุผลการปฏิเสธไม่ตรงกับข้อมูลเดิมที่ได้รับการตัดสินไปแล้ว'), { status: 409 });
          }
          return {
            id: claimId,
            status: 'REJECTED',
            currentTier: lastRejection.Tier,
            message: 'รายการนี้ได้รับการปฏิเสธไปแล้ว (Idempotent)',
            idempotent: true,
            decision: 'REJECTED',
            decidedBy: lastRejection.DecidedBy,
            decidedAt: lastRejection.DecidedAt
          };
        }
        throw Object.assign(new Error('คำขอนี้ถูกไม่อนุมัติ (REJECTED) ไปแล้ว'), { status: 400 });
      }

      if (expectedTier) {
        const targetTier = Number(expectedTier);
        const existingDec = (await tx.request()
          .input('cid', sql.Int, claimId)
          .input('tier', sql.Int, targetTier)
          .query(`SELECT TOP 1 * FROM wf.RebateClaimApproval WITH (UPDLOCK, ROWLOCK) WHERE ClaimId = @cid AND Tier = @tier ORDER BY ApprovalId DESC`)
        ).recordset?.[0];

        if (existingDec) {
          if (existingDec.Decision === 'REJECTED') {
            const isActor = Number(existingDec.DecidedBy) === userId || ['ADMIN', 'C_LEVEL'].includes(userRole);
            if (!isActor) {
              throw Object.assign(new Error(`ไม่มีสิทธิ์เข้าถึงหรือเรียกซ้ำการตัดสินของผู้อนุมัติท่านอื่น (DecidedBy: #${existingDec.DecidedBy})`), { status: 403 });
            }
            if (existingDec.Reason && trimmedReason && existingDec.Reason !== trimmedReason) {
              throw Object.assign(new Error('Payload conflict: เหตุผลการปฏิเสธไม่ตรงกับข้อมูลเดิมที่ได้รับการตัดสินไปแล้ว'), { status: 409 });
            }
            return {
              id: claimId,
              status: claim.Status,
              currentTier: existingDec.Tier,
              message: 'รายการนี้ได้รับการปฏิเสธไปแล้ว (Idempotent)',
              idempotent: true,
              decision: 'REJECTED',
              decidedBy: existingDec.DecidedBy,
              decidedAt: existingDec.DecidedAt
            };
          } else {
            throw Object.assign(new Error(`รายการนี้ได้รับการตัดสินในชั้นที่ ${targetTier} ไปแล้ว (${existingDec.Decision} โดย #${existingDec.DecidedBy})`), { status: 409 });
          }
        }
      }

      // Terminal states check
      if (claim.Status === 'APPROVED' || claim.Status === 'CN_ISSUED') {
        throw Object.assign(new Error('ไม่สามารถตีกลับคำขอที่อนุมัติแล้วหรือออกใบลดหนี้แล้ว (Terminal State)'), { status: 400 });
      }
      if (claim.Status === 'CANCELLED') {
        throw Object.assign(new Error('คำขอนี้ถูกยกเลิกแล้ว'), { status: 400 });
      }

      const currentTier = Number(claim.CurrentTier || 2);
      if (expectedTier && Number(expectedTier) !== currentTier) {
        throw Object.assign(new Error(`สถานะคำขอไม่อยู่ในชั้นที่ระบุ (คำขออยู่ในชั้นที่ ${currentTier} แต่ส่ง expectedTier=${expectedTier})`), { status: 409 });
      }

      const validPendingStates = ['TIER2_PENDING', 'TIER3_PENDING', 'TIER4_PENDING', 'PENDING'];
      if (!validPendingStates.includes(claim.Status)) {
        throw Object.assign(new Error(`ไม่สามารถปฏิเสธคำขอในสถานะ ${claim.Status}`), { status: 400 });
      }

      // 4. Segregation of Duties: Submitter cannot reject their own claim as an approver
      if (Number(claim.SalesUserId) === userId && !['ADMIN', 'C_LEVEL'].includes(userRole)) {
        throw Object.assign(new Error('ไม่อนุญาตให้ผู้ยื่นคำขอปฏิเสธแทนผู้อนุมัติ (Segregation of Duties)'), { status: 403 });
      }

      // 5. Tier & Region Authorization for Rejection
      let requiredRole = '';
      if (currentTier === 2) {
        const regionCode = claim.RegionCode || '99';
        const isRegionalMgr = (await tx.request()
          .input('uid', sql.Int, userId)
          .input('rcode', sql.VarChar(10), regionCode)
          .query(`SELECT 1 FROM wf.UserSaleArea WHERE UserId = @uid AND RegionCode = @rcode`)
        ).recordset?.length > 0;

        const canRejectTier2 = isRegionalMgr || ['ADMIN', 'C_LEVEL'].includes(userRole);
        if (!canRejectTier2) {
          throw Object.assign(new Error(`ไม่มีสิทธิ์ปฏิเสธชั้นที่ 2 (ผู้จัดการภาค ${regionCode})`), { status: 403 });
        }
        requiredRole = 'REGIONAL_MGR';
      } else if (currentTier === 3) {
        const canRejectTier3 = ['ADMIN', 'C_LEVEL'].includes(userRole);
        if (!canRejectTier3) {
          throw Object.assign(new Error('ไม่มีสิทธิ์ปฏิเสธชั้นที่ 3 (กรรมการบริหาร)'), { status: 403 });
        }
        requiredRole = 'MARKETING_MGR';
      } else if (currentTier === 4) {
        const canRejectTier4 = ['C_LEVEL', 'ADMIN', 'ACCOUNTING'].includes(userRole);
        if (!canRejectTier4) {
          throw Object.assign(new Error('ไม่มีสิทธิ์ปฏิเสธชั้นที่ 4 (กรรมการบริหาร / บัญชี)'), { status: 403 });
        }
        requiredRole = 'EXECUTIVE';
      } else {
        throw Object.assign(new Error('ขั้นตอนอนุมัติไม่ถูกต้อง'), { status: 400 });
      }

      // 7. Conditional State Update to REJECTED
      const updateRes = await tx.request()
        .input('id', sql.Int, claimId)
        .input('expStatus', sql.VarChar(20), claim.Status)
        .input('expTier', sql.Int, currentTier)
        .query(`
          UPDATE wf.RebateClaim 
          SET Status = 'REJECTED', CurrentTier = 1 
          WHERE Id = @id AND Status = @expStatus AND CurrentTier = @expTier
        `);

      if (updateRes.rowsAffected[0] !== 1) {
        throw Object.assign(new Error('สถานะของคำขอเปลี่ยนแปลงไปแล้ว กรุณารีเฟรชเพื่อดูสถานะล่าสุด'), { status: 409 });
      }

      // 8. Reversal of Pool ClaimedAmt if attached to a pool
      if (claim.PoolId && Number(claim.ClaimAmt) > 0) {
        await tx.request()
          .input('pid', sql.Int, claim.PoolId)
          .input('amt', sql.Decimal(12, 2), Number(claim.ClaimAmt))
          .query(`
            UPDATE wf.RebatePool
            SET ClaimedAmt = CASE WHEN ClaimedAmt >= @amt THEN ClaimedAmt - @amt ELSE 0 END,
                UpdatedAt = GETUTCDATE()
            WHERE Id = @pid
          `);
        // ...and of the ledger amounts the claim cut when it was filed. The pool total came back but the ledger
        // did not, so the pool read "available ฿0" and the salesperson could not file again (UAT full loop
        // 2026-10-09, claim #4). Filing cuts oldest first and keeps no per-row link, so the amount goes back to
        // the most recently cut rows first, never above a row's own amount.
        let back = Number(claim.ClaimAmt);
        const cutRows = (await tx.request()
          .input('pid', sql.Int, claim.PoolId)
          .query(`
            SELECT Id, RebateAmount, RemainingAmt FROM wf.RebateLedger WITH (UPDLOCK)
            WHERE PoolId = @pid AND ReversedFlag = 0 AND RemainingAmt < RebateAmount
            ORDER BY CreatedAt DESC, Id DESC
          `)).recordset || [];
        for (const row of cutRows) {
          if (back <= 0) break;
          const put = Math.min(back, Number(row.RebateAmount) - Number(row.RemainingAmt));
          if (!(put > 0)) continue;
          await tx.request()
            .input('put', sql.Decimal(12, 2), put)
            .input('id', sql.Int, row.Id)
            .query(`
              UPDATE wf.RebateLedger
              SET RemainingAmt = RemainingAmt + @put,
                  Status = CASE WHEN Status = 'CLAIMED' THEN 'PENDING' ELSE Status END
              WHERE Id = @id
            `);
          back = Math.round((back - put) * 100) / 100;
        }
      }

      // 9. Insert rejection record into approval trail
      await tx.request()
        .input('cid', sql.Int, claimId)
        .input('tier', sql.Int, currentTier)
        .input('rrole', sql.VarChar(30), requiredRole)
        .input('uid', sql.Int, userId)
        .input('uname', sql.NVarChar(150), userName)
        .input('reason', sql.NVarChar(500), trimmedReason)
        .query(`
          INSERT INTO wf.RebateClaimApproval (ClaimId, Tier, RequiredRole, Decision, DecidedBy, DecidedByName, DecidedAt, Reason)
          VALUES (@cid, @tier, @rrole, 'REJECTED', @uid, @uname, GETUTCDATE(), @reason)
        `);

      // 10. Audit log
      await logChangeEvent(tx, {
        entityType: 'REBATE_CLAIM',
        entityId: String(claimId),
        action: `REJECT_TIER_${currentTier}`,
        beforeJson: JSON.stringify({ status: claim.Status, currentTier: claim.CurrentTier }),
        afterJson: JSON.stringify({ status: 'REJECTED', currentTier: 1 }),
        reason: trimmedReason,
        userId,
      });

      return {
        id: claimId,
        status: 'REJECTED',
        currentTier: 1,
        message: 'ไม่อนุมัติใบขอเคลียร์และบันทึกประวัติการปฏิเสธเรียบร้อย',
      };
    });

    res.json(result);
  } catch (e) {
    console.error('[POST /claims/:id/reject error]', e.message || e);
    const httpErr = mapDatabaseError(e, 'เกิดข้อผิดพลาดในการไม่อนุมัติใบขอเคลียร์');
    res.status(httpErr.status).json({ message: httpErr.message });
  }
});

// GET /api/rebate/summary — KPI ภาพรวมต่อพนักงานขาย (wf.RebatePool)
router.get('/summary', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT u.DisplayName AS SalesName,
             SUM(p.AccruedAmt) AS TotalAccrued,
             SUM(p.ClaimedAmt) AS TotalClaimed,
             SUM(ISNULL(u_usage.UsedAmt, 0)) AS TotalUsed,
             SUM(CASE 
               WHEN (p.AccruedAmt - p.ClaimedAmt - ISNULL(u_usage.UsedAmt, 0)) < ISNULL(l_remain.LedgerRemainingAmt, 0)
               THEN CASE WHEN (p.AccruedAmt - p.ClaimedAmt - ISNULL(u_usage.UsedAmt, 0)) > 0 THEN (p.AccruedAmt - p.ClaimedAmt - ISNULL(u_usage.UsedAmt, 0)) ELSE 0 END
               ELSE CASE WHEN ISNULL(l_remain.LedgerRemainingAmt, 0) > 0 THEN ISNULL(l_remain.LedgerRemainingAmt, 0) ELSE 0 END
             END) AS TotalAvailable,
             SUM(p.AllocatedAmt) AS TotalAllocated
      FROM wf.RebatePool p
      JOIN wf.AppUser u ON u.Id = p.SalesUserId
      LEFT JOIN (
        SELECT l.PoolId, SUM(u.DeductedAmt) AS UsedAmt
        FROM wf.RebateUsage u
        JOIN wf.RebateLedger l ON l.Id = u.LedgerId
        WHERE l.ReversedFlag = 0
        GROUP BY l.PoolId
      ) u_usage ON u_usage.PoolId = p.Id
      LEFT JOIN (
        SELECT l.PoolId, SUM(l.RemainingAmt) AS LedgerRemainingAmt
        FROM wf.RebateLedger l
        WHERE l.ReversedFlag = 0
        GROUP BY l.PoolId
      ) l_remain ON l_remain.PoolId = p.Id
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
/**
 * สายอนุมัติของแบบขออนุมัติรายการส่งเสริมการขาย
 *
 * ต่างจากใบขอเคลียร์ที่ชั้นที่ 3 — ฟอร์มจริงเขียน "ผู้จัดการฝ่ายขาย" ไม่ใช่ "ผู้จัดการฝ่ายตลาด"
 * จึงประกาศแยกไว้ ไม่ใช้ค่าเดียวกันทั้งสองเอกสาร
 */
const PLAN_TIERS = {
  2: { role: 'REGIONAL_MGR', label: 'ผู้จัดการภาค',      next: 'TIER3_PENDING' },
  3: { role: 'SALES_MGR',    label: 'ผู้จัดการฝ่ายขาย',   next: 'TIER4_PENDING' },
  4: { role: 'EXECUTIVE',    label: 'กรรมการบริหาร',      next: 'APPROVED' },
};
// บทบาทที่อนุมัติแต่ละชั้นได้ — ชั้น 2 เพิ่มผู้ดูแลภาคจาก wf.UserSaleArea อีกทาง
const PLAN_TIER_ROLES = {
  2: ['MANAGER', 'APPROVER', 'ADMIN', 'C_LEVEL'],
  3: ['MANAGER', 'APPROVER', 'ADMIN', 'C_LEVEL'],
  4: ['C_LEVEL', 'ADMIN'],
};

// GET /api/rebate/plans/:id/approvals — ร่องรอยการอนุมัติของโปรโมชั่น
router.get('/plans/:id/approvals', async (req, res) => {
  try {
    const rows = (await wfQuery(
      `SELECT * FROM wf.RebatePlanApproval WHERE PlanId = @id ORDER BY Tier ASC, CreatedAt ASC`,
      { id: { type: sql.Int, value: Number(req.params.id) } })).recordset || [];
    res.json(rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/rebate/plans/:id/submit — ยื่นขออนุมัติ (ชั้นที่ 1 = ผู้ยื่น)
router.post('/plans/:id/submit', requireRole('SALES', 'MANAGER', 'ADMIN', 'APPROVER', 'C_LEVEL'), async (req, res) => {
  try {
    const planId = Number(req.params.id);
    const plan = (await wfQuery(`SELECT * FROM wf.RebatePlan WHERE PlanId=@id`,
      { id: { type: sql.Int, value: planId } })).recordset?.[0];
    if (!plan) return res.status(404).json({ message: 'ไม่พบโปรโมชั่นที่ระบุ' });
    if (plan.Status && !['DRAFT', 'REJECTED'].includes(plan.Status)) {
      return res.status(400).json({ message: `ยื่นได้เฉพาะสถานะร่างหรือถูกตีกลับ (ปัจจุบัน ${plan.Status})` });
    }
    if (!plan.NetPrice) return res.status(400).json({ message: 'ต้องระบุราคาสุทธิก่อนยื่นขออนุมัติ' });

    const name = await approverName(req.user);
    // ยื่นใหม่หลังถูกตีกลับ ต้องล้างลายเซ็นเดิมทิ้ง ไม่งั้นเอกสารที่แก้แล้ว
    // จะยังถือลายเซ็นของฉบับก่อนแก้
    await wfQuery(`DELETE FROM wf.RebatePlanApproval WHERE PlanId=@id`, { id: { type: sql.Int, value: planId } });
    await wfQuery(`
      INSERT INTO wf.RebatePlanApproval (PlanId, Tier, RequiredRole, Decision, DecidedBy, DecidedByName, DecidedAt, Reason)
      VALUES (@id, 1, 'SALES', 'APPROVED', @uid, @uname, GETUTCDATE(), N'ยื่นแบบขออนุมัติรายการส่งเสริมการขาย')`,
      { id: { type: sql.Int, value: planId }, uid: { type: sql.Int, value: req.user.sub },
        uname: { type: sql.NVarChar(150), value: name } });
    await wfQuery(`UPDATE wf.RebatePlan SET Status='TIER2_PENDING', CurrentTier=2, UpdatedAt=GETUTCDATE() WHERE PlanId=@id`,
      { id: { type: sql.Int, value: planId } });

    res.json({ id: planId, status: 'TIER2_PENDING', currentTier: 2, message: 'ยื่นขออนุมัติเรียบร้อย รอผู้จัดการภาค' });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/rebate/plans/:id/approve — อนุมัติทีละชั้น
router.post('/plans/:id/approve', async (req, res) => {
  try {
    const planId = Number(req.params.id);
    const { note } = req.body || {};
    const plan = (await wfQuery(`SELECT * FROM wf.RebatePlan WHERE PlanId=@id`,
      { id: { type: sql.Int, value: planId } })).recordset?.[0];
    if (!plan) return res.status(404).json({ message: 'ไม่พบโปรโมชั่นที่ระบุ' });
    if (['APPROVED', 'ACTIVE'].includes(plan.Status)) return res.status(400).json({ message: 'โปรโมชั่นนี้อนุมัติแล้ว' });
    if (plan.Status === 'REJECTED') return res.status(400).json({ message: 'โปรโมชั่นนี้ถูกตีกลับ กรุณายื่นใหม่' });

    const tier = Number(plan.CurrentTier || 0);
    const spec = PLAN_TIERS[tier];
    if (!spec) return res.status(400).json({ message: 'โปรโมชั่นนี้ยังไม่ได้ยื่นขออนุมัติ' });

    const userId = Number(req.user.sub);
    const userRole = String(req.user.role || '');

    // กติกาเดียวกับใบขอเคลียร์ — คนเดิมอนุมัติสองชั้นติดกันไม่ได้
    const prev = (await wfQuery(
      `SELECT TOP 1 DecidedBy FROM wf.RebatePlanApproval WHERE PlanId=@id AND Decision='APPROVED' ORDER BY Tier DESC`,
      { id: { type: sql.Int, value: planId } })).recordset?.[0];
    const relaxed = process.env.ALLOW_SINGLE_USER_MULTI_TIER_APPROVAL === 'true';
    if (prev && Number(prev.DecidedBy) === userId && !relaxed) {
      return res.status(403).json({ message: 'ไม่อนุญาตให้บุคคลเดิมอนุมัติซ้ำสองชั้นติดต่อกัน (Segregation of Duties)' });
    }

    let allowed = PLAN_TIER_ROLES[tier].includes(userRole);
    if (!allowed && tier === 2) {
      // ผู้ดูแลภาคอนุมัติชั้น 2 ได้แม้บทบาทจะไม่ใช่ MANAGER (ดู wf.UserSaleArea)
      allowed = (await wfQuery(
        `SELECT 1 FROM wf.UserSaleArea WHERE UserId=@uid AND RegionCode=@r`,
        { uid: { type: sql.Int, value: userId }, r: { type: sql.VarChar(10), value: plan.Region || '99' } })).recordset?.length > 0;
    }
    if (!allowed) return res.status(403).json({ message: `ไม่มีสิทธิ์อนุมัติชั้นที่ ${tier} (${spec.label})` });

    const name = await approverName(req.user);
    await wfQuery(`
      INSERT INTO wf.RebatePlanApproval (PlanId, Tier, RequiredRole, Decision, DecidedBy, DecidedByName, DecidedAt, Reason)
      VALUES (@id, @tier, @role, 'APPROVED', @uid, @uname, GETUTCDATE(), @note)`,
      { id: { type: sql.Int, value: planId }, tier: { type: sql.Int, value: tier },
        role: { type: sql.VarChar(30), value: spec.role }, uid: { type: sql.Int, value: userId },
        uname: { type: sql.NVarChar(150), value: name },
        note: { type: sql.NVarChar(500), value: note || `อนุมัติชั้นที่ ${tier} (${spec.label})` } });

    const nextTier = spec.next === 'APPROVED' ? null : tier + 1;
    await wfQuery(`UPDATE wf.RebatePlan SET Status=@st, CurrentTier=@ct, UpdatedAt=GETUTCDATE() WHERE PlanId=@id`,
      { id: { type: sql.Int, value: planId }, st: { type: sql.NVarChar(20), value: spec.next },
        ct: { type: sql.Int, value: nextTier } });

    res.json({ id: planId, status: spec.next, currentTier: nextTier, message: `อนุมัติชั้นที่ ${tier} (${spec.label}) เรียบร้อย` });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/rebate/plans/:id/reject — ตีกลับ ต้องมีเหตุผลเสมอ
router.post('/plans/:id/reject', async (req, res) => {
  try {
    const planId = Number(req.params.id);
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ message: 'การตีกลับต้องระบุเหตุผล' });

    const plan = (await wfQuery(`SELECT * FROM wf.RebatePlan WHERE PlanId=@id`,
      { id: { type: sql.Int, value: planId } })).recordset?.[0];
    if (!plan) return res.status(404).json({ message: 'ไม่พบโปรโมชั่นที่ระบุ' });
    const tier = Number(plan.CurrentTier || 0);
    if (!PLAN_TIERS[tier]) return res.status(400).json({ message: 'โปรโมชั่นนี้ไม่ได้อยู่ระหว่างการอนุมัติ' });
    if (!PLAN_TIER_ROLES[tier].includes(String(req.user.role || ''))) {
      return res.status(403).json({ message: `ไม่มีสิทธิ์ตีกลับชั้นที่ ${tier}` });
    }

    await wfQuery(`
      INSERT INTO wf.RebatePlanApproval (PlanId, Tier, RequiredRole, Decision, DecidedBy, DecidedByName, DecidedAt, Reason)
      VALUES (@id, @tier, @role, 'REJECTED', @uid, @uname, GETUTCDATE(), @reason)`,
      { id: { type: sql.Int, value: planId }, tier: { type: sql.Int, value: tier },
        role: { type: sql.VarChar(30), value: PLAN_TIERS[tier].role },
        uid: { type: sql.Int, value: req.user.sub },
        uname: { type: sql.NVarChar(150), value: await approverName(req.user) },
        reason: { type: sql.NVarChar(500), value: reason } });
    await wfQuery(`UPDATE wf.RebatePlan SET Status='REJECTED', CurrentTier=NULL, UpdatedAt=GETUTCDATE() WHERE PlanId=@id`,
      { id: { type: sql.Int, value: planId } });

    res.json({ id: planId, status: 'REJECTED', message: 'ตีกลับเรียบร้อย' });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

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

const CANONICAL_SALE_REGIONS = [
  { RegionCode: '01', RegionName: 'กรุงเทพและปริมณฑล' },
  { RegionCode: '02', RegionName: 'ภาคกลาง-ตะวันตก' },
  { RegionCode: '03', RegionName: 'ภาคตะวันออกเฉียงเหนือ' },
  { RegionCode: '04', RegionName: 'ภาคเหนือ' },
  { RegionCode: '05', RegionName: 'ภาคใต้' },
  { RegionCode: '06', RegionName: 'ภาคตะวันออก' },
  { RegionCode: '10', RegionName: 'ภาคอีสานบน' },
  { RegionCode: '11', RegionName: 'ภาคอีสานกลาง' },
  { RegionCode: '12', RegionName: 'ภาคอีสานล่าง' },
  { RegionCode: '13', RegionName: 'ภาคปุ๋ยเทพ 1' },
  { RegionCode: '14', RegionName: 'ภาคปุ๋ยเทพ 2' },
  { RegionCode: '15', RegionName: 'โรงงานและหน่วยงานราชการ' },
  { RegionCode: '16', RegionName: 'เคาน์เตอร์เซลล์' },
  { RegionCode: '99', RegionName: 'ไม่ระบุ' },
];

function normalizePlanRegion(r, regionRows = CANONICAL_SALE_REGIONS) {
  if (!r) return 'ALL';
  const s = String(r).trim();
  if (s === 'ALL') return 'ALL';

  const rows = Array.isArray(regionRows) && regionRows.length > 0 ? regionRows : CANONICAL_SALE_REGIONS;

  // 1. Exact match on RegionCode
  const byCode = rows.find(row => String(row.RegionCode).trim() === s);
  if (byCode) return byCode.RegionCode;

  // 2. Exact match on RegionName
  const byName = rows.find(row => String(row.RegionName).trim() === s);
  if (byName) return byName.RegionCode;

  const err = new Error(`รหัสหรือชื่อภาคไม่ถูกต้อง (พบ: ${s})`);
  err.status = 400;
  err.code = 'INVALID_REGION';
  throw err;
}

function normalizeGoodPattern(p) {
  if (!p) return null;
  const s = String(p).trim();
  if (!s || s === 'ALL' || s === 'ทุกสูตร') return null;
  if (s.includes('%')) return s;

  // Formula patterns: e.g. 15-5-35, 16-8-8, 0-0-60, 15-15-15
  const formulaMatch = s.match(/^(\d{1,2})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{1,2})(?:\s*[-/]\s*(\d{1,2}))?$/);
  if (formulaMatch) {
    const parts = [formulaMatch[1], formulaMatch[2], formulaMatch[3]];
    if (formulaMatch[4]) parts.push(formulaMatch[4]);
    const padded = parts.map(part => part.padStart(2, '0')).join('');
    return `%${padded}%`;
  }
  return s;
}

// POST /api/rebate/plans — สร้าง Plan (DRAFT)
router.post('/plans', requireRole('MANAGER', 'ADMIN', 'APPROVER', 'C_LEVEL'), async (req, res) => {
  try {
    const { title, refDoc, goodCodePattern, region, returnType, netPrice, validFrom, validTo, allocatedAmount, priority, note } = req.body || {};
    const yy = (new Date().getFullYear() + 543) % 100;
    const cnt = (await wfQuery(`SELECT COUNT(*) c FROM wf.RebatePlan WHERE PlanNo LIKE @p`,
      { p: { type: sql.NVarChar(30), value: `RP${yy}-%` } })).recordset[0].c;
    const planNo = `RP${yy}-${String(cnt + 1).padStart(3, '0')}`;
    const hasRefDoc = await hasRebatePlanRefDoc();
    const refDocColumn = hasRefDoc ? ', RefDoc' : '';
    const refDocValue = hasRefDoc ? ', @refDoc' : '';
    const cleanPattern = normalizeGoodPattern(goodCodePattern);
    const cleanRegion = normalizePlanRegion(region);
    const inputs = {
      no:    { type: sql.NVarChar(30),  value: planNo },
      title: { type: sql.NVarChar(200), value: title || null },
      gcp:   { type: sql.NVarChar(50),  value: cleanPattern },
      region:{ type: sql.NVarChar(20),  value: cleanRegion },
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
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// PATCH /api/rebate/plans/:id — แก้ไข / เปลี่ยนสถานะ (DRAFT→ACTIVE→CLOSED)
router.patch('/plans/:id', requireRole('MANAGER', 'ADMIN', 'APPROVER', 'C_LEVEL'), async (req, res) => {
  try {
    const planId = Number(req.params.id);
    if (!Number.isFinite(planId)) return res.status(400).json({ message: 'Invalid Plan ID' });

    const existingPlan = (await wfQuery(`SELECT Status FROM wf.RebatePlan WHERE PlanId = @id`, { id: { type: sql.Int, value: planId } })).recordset?.[0];
    if (!existingPlan) return res.status(404).json({ message: `ไม่พบ Rebate Plan ID ${planId}` });

    const f = req.body || {};
    // UAT batch 5: the approval chain is the only way to an approved plan — what was signed cannot change after
    // it was submitted, and ACTIVE follows APPROVED (it was settable straight from a draft)
    const current = String(existingPlan.Status || 'DRAFT');
    const editable = ['DRAFT', 'REJECTED'].includes(current);
    const definition = ['goodCodePattern', 'region', 'returnType', 'netPrice', 'validFrom', 'validTo', 'allocatedAmount', 'priority'];
    if (!editable && definition.some(k => f[k] !== undefined)) {
      return res.status(409).json({ message: `แก้เนื้อหาโปรโมชั่นได้เฉพาะสถานะร่างหรือถูกตีกลับ (ปัจจุบัน ${current})` });
    }
    const allowedFrom = { ACTIVE: ['APPROVED', 'ACTIVE'], CLOSED: ['APPROVED', 'ACTIVE', 'CLOSED'], DRAFT: ['DRAFT', 'REJECTED'] };
    if (f.status !== undefined && allowedFrom[f.status] && !allowedFrom[f.status].includes(current)) {
      return res.status(409).json({ message: `เปลี่ยนสถานะจาก ${current} เป็น ${f.status} ไม่ได้` });
    }
    const sets = [], inputs = { id: { type: sql.Int, value: planId } };
    const add = (col, key, type, val) => { sets.push(`${col}=@${key}`); inputs[key] = { type, value: val }; };
    if (f.title !== undefined)          add('Title','title',sql.NVarChar(200), f.title || null);
    if (f.refDoc !== undefined && await hasRebatePlanRefDoc())
                                        add('RefDoc','refDoc',sql.NVarChar(100), f.refDoc || null);
    if (f.goodCodePattern !== undefined)add('GoodCodePattern','gcp',sql.NVarChar(50), normalizeGoodPattern(f.goodCodePattern));
    if (f.region !== undefined)         add('Region','region',sql.NVarChar(20), normalizePlanRegion(f.region));
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
    const __r = await wfQuery(`UPDATE wf.RebatePlan SET ${sets.join(', ')} WHERE PlanId=@id`, inputs);
    if (!__r.rowsAffected?.[0]) return res.status(404).json({ message: `ไม่พบ Rebate Plan ID ${planId}` });
    res.json({ id: planId, ok: true });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// POST /api/rebate/plans/:id/allocate — จัดสรรงบ Plan → Pool ของ Sales
router.post('/plans/:id/allocate', requireRole('MANAGER', 'ADMIN', 'APPROVER', 'C_LEVEL'), async (req, res) => {
  try {
    const planId = Number(req.params.id);
    if (!Number.isFinite(planId)) return res.status(400).json({ message: 'Invalid Plan ID' });

    const existingPlan = (await wfQuery(`SELECT Status FROM wf.RebatePlan WHERE PlanId = @id`, { id: { type: sql.Int, value: planId } })).recordset?.[0];
    if (!existingPlan) return res.status(404).json({ message: `ไม่พบ Rebate Plan ID ${planId}` });
    // a budget comes from an approved plan only
    if (!['APPROVED', 'ACTIVE'].includes(String(existingPlan.Status))) {
      return res.status(409).json({ message: `จัดสรรงบได้เมื่อโปรโมชั่นอนุมัติแล้ว (ปัจจุบัน ${existingPlan.Status})` });
    }

    const { salesUserId, periodYear, periodMonth, amount, note } = req.body || {};
    if (!salesUserId || !(Number(amount) > 0)) return res.status(400).json({ message: 'salesUserId และ amount จำเป็น' });
    const { getBangkokDateString } = require('../services/so-pickup-policy');
    const today = getBangkokDateString();
    const y = periodYear || Number(today.slice(0, 4));
    const m = periodMonth || Number(today.slice(5, 7));
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
        pid: { type: sql.Int, value: planId },
        pool:{ type: sql.Int, value: pool.Id },
        u:   { type: sql.Int, value: Number(salesUserId) },
        amt: { type: sql.Decimal(14,2), value: Number(amount) },
        note:{ type: sql.NVarChar(300), value: note || null },
        by:  { type: sql.Int, value: req.user.sub },
      });
    res.json({ ok: true, poolId: pool.Id, allocated: Number(amount) });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

async function resolveSalesEmpId(user) {
  if (!user || user.role !== 'SALES') return null;
  if (user.empId) return Number(user.empId);
  try {
    const u = (await wfQuery('SELECT EmpId FROM wf.AppUser WHERE Id = @id', { id: { type: sql.Int, value: Number(user.sub || user.id) } })).recordset?.[0];
    return u?.EmpId ? Number(u.EmpId) : null;
  } catch {
    return null;
  }
}

// R12 O-4: SALES/MANAGER see their own + team (org chart) coupons — same rule as bills.
// Returns null when everything is visible, otherwise the EmpIDs in scope ([] = nothing).
async function resolveScopeEmpIds(user) {
  const { getVisibleScope } = require('../services/visible-scope');
  const scope = await getVisibleScope(user);
  if (scope.all) return null;
  return scope.empIds.map(Number).filter(Number.isFinite);
}
function empInClause(col, empIds, inputs, prefix = 'se') {
  const names = empIds.map((id, i) => { inputs[`${prefix}${i}`] = { type: sql.Int, value: id }; return `@${prefix}${i}`; });
  return ` AND ${col} IN (${names.join(', ')})`;
}

// GET /api/rebate/voucher-summary — WFCoupon summary by salesperson (for VoucherPage)
// R9-6: Scoped to salesperson's own EmpID if role is SALES
router.get('/voucher-summary', async (req, res) => {
  try {
    const scopeEmpIds = await resolveScopeEmpIds(req.user);
    if (scopeEmpIds && !scopeEmpIds.length) return res.json([]);
    const inputs = {};
    let where = 'WHERE c.RemaQty > 0';
    if (scopeEmpIds) where += empInClause('hd.EmpID', scopeEmpIds, inputs);

    const r = await wfQuery(`
      SELECT hd.EmpID,
             ISNULL(emp.EmpName, CAST(hd.EmpID AS NVARCHAR(20))) AS EmpName,
             COUNT(DISTINCT hd.CustID)  AS CustCount,
             COUNT(c.CouponID)          AS CouponCount,
             SUM(c.RemaQty)             AS OutstandingTon
      FROM dbo.WFCoupon c
      JOIN dbo.SOHD hd  ON hd.SOID = c.DocuID
      LEFT JOIN dbo.EMEmp emp ON emp.EmpID = hd.EmpID
      ${where}
      GROUP BY hd.EmpID, emp.EmpName
      ORDER BY OutstandingTon DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── ยอดสะสมรีเบท — อ่านจาก WINSpeed โดยตรง (แหล่งข้อมูลเดียว) ─────────────────
//
// ไม่มีการคัดลอกยอดมาเก็บในแอป · WINSpeed ยังออกคูปองใหม่ทุกวัน สำเนาจึงแยกกัน
// ทันทีที่คัดลอกเสร็จ · view wf.v_RebateAccrualRemaining อ่านจาก dbo.SOHD/SODT
// (เอกสาร DocuType 104) แล้วหักตันที่ถูกขอเคลียร์ไปแล้วออก — ดูรายละเอียดใน
// migration 076

// GET /api/rebate/accrual — สรุปยอดคงเหลือรายลูกค้า (พร้อมกรองตามพนักงานขาย/ช่วงวันที่)
router.get('/accrual', async (req, res) => {
  try {
    const { custId, empId, from, to } = req.query;
    const inputs = {};
    let where = 'WHERE RemainingTonRebate > 0';
    const cutoff = await claimCutoffDate();
    if (cutoff) { where += ' AND SourceDocuDate >= @cut'; inputs.cut = { type: sql.Date, value: cutoff }; }
    if (custId) { where += ' AND CustId = @custId'; inputs.custId = { type: sql.NVarChar(20), value: String(custId) }; }
    if (empId)  { where += ' AND SalesEmpId = @empId'; inputs.empId = { type: sql.Int, value: Number(empId) }; }
    if (from)   { where += ' AND SourceDocuDate >= @from'; inputs.from = { type: sql.Date, value: from }; }
    if (to)     { where += ' AND SourceDocuDate <= @to'; inputs.to = { type: sql.Date, value: to }; }

    const r = await wfQuery(`
      SELECT CustId, MAX(CustName) AS CustName, MAX(CustCode) AS CustCode, MAX(RegionCode) AS RegionCode,
             MAX(SalesEmpId) AS SalesEmpId, MAX(SalesEmpName) AS SalesEmpName,
             COUNT(*)                       AS LotCount,
             SUM(RemainingTonRebate)        AS RemainingTon,
             SUM(CASE WHEN RebatePerTon IS NULL THEN 0
                      ELSE RemainingTonRebate * RebatePerTon END) AS RemainingAmt,
             SUM(CASE WHEN RebatePerTon IS NULL THEN RemainingTonRebate ELSE 0 END) AS TonWithoutPlan,
             MIN(SourceDocuDate)            AS OldestDate
      FROM wf.v_RebateAccrualRemaining
      ${where}
      GROUP BY CustId
      ORDER BY SUM(RemainingTonRebate) DESC`, inputs);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/accrual/:custId — ล็อตของลูกค้ารายนี้ เรียงแบบ FIFO (เก่าก่อน)
//
// หนึ่งแถว = หนึ่งบรรทัดของใบส่งของ · เป็นหน่วยที่ตัดสิทธิ์ ทำให้ตรวจย้อนกลับได้ว่า
// เงินที่คืนไปมาจากการขนเที่ยวใด ใบกำกับเลขใด
router.get('/accrual/:custId', async (req, res) => {
  try {
    const rawCust = String(req.params.custId || '').trim();
    if (!rawCust) return res.status(400).json({ message: 'ต้องระบุรหัสลูกค้า' });

    const cust = await resolveCustomer(rawCust);
    if (!cust) {
      return res.status(404).json({ message: `ไม่พบข้อมูลลูกค้า '${rawCust}'` });
    }

    const kind = String(req.query.lineType || 'REBATE').toUpperCase() === 'DIFF' ? 'DIFF' : 'REBATE';
    const inputs = { cid: { type: sql.NVarChar(20), value: String(cust.custId) } };
    let where = `WHERE CustId = @cid AND ${kind === 'DIFF' ? 'RemainingTonDiff' : 'RemainingTonRebate'} > 0`;
    const cutoff = await claimCutoffDate();
    if (cutoff) { where += ' AND SourceDocuDate >= @cut'; inputs.cut = { type: sql.Date, value: cutoff }; }
    if (req.query.goodCode) { where += ' AND GoodCode = @gc'; inputs.gc = { type: sql.NVarChar(50), value: String(req.query.goodCode) }; }
    if (req.query.from)     { where += ' AND SourceDocuDate >= @from'; inputs.from = { type: sql.Date, value: req.query.from }; }
    if (req.query.to)       { where += ' AND SourceDocuDate <= @to'; inputs.to = { type: sql.Date, value: req.query.to }; }

    const r = await wfQuery(`
      SELECT SourceSOID, SourceListNo, SourceDocuNo, SourceDocuDate, TaxInvoiceNo, CouponNo,
             CustId, CustName, RegionCode, SalesEmpId, SalesEmpName,
             GoodID, GoodCode, GoodName, QtyTon,
             ListPricePerTon, NetPricePerTon, RebatePerTon, PlanId, PlanNo,
             ${kind === 'DIFF' ? 'RemainingTonDiff' : 'RemainingTonRebate'} AS RemainingTon,
             CASE WHEN RebatePerTon IS NULL THEN NULL
                  ELSE ${kind === 'DIFF' ? 'RemainingTonDiff' : 'RemainingTonRebate'} * RebatePerTon END AS RemainingAmt
      FROM wf.v_RebateAccrualRemaining
      ${where}
      ORDER BY SourceDocuDate ASC, SourceDocuNo ASC, SourceListNo ASC`, inputs);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── เอกสารคืนรีเบทของ WINSpeed (RB<รหัสผู้ขอ><ปี พ.ศ.>-<ลำดับ>) ───────────────
//
// dbo.SOInvHD Docutype 106 · 16,195 ใบ · **EmpID ว่างทุกใบ** WINSpeed ไม่ได้บันทึก
// ว่าใครเป็นผู้ขอ อักษรในเลขที่เอกสารจึงเป็นร่องรอยเดียวที่บอกได้ ดู migration 079

/** ปี พ.ศ. 2 หลักที่ใช้ในเลขที่เอกสาร */
const beYY = (d = new Date()) => String((d.getFullYear() + 543) % 100).padStart(2, '0');

/**
 * เดารหัสผู้ขอจากชื่อไทย — ตัวแรกของชื่อ + ตัวแรกของนามสกุล เป็นอักษรโรมัน
 *
 * เป็น "ข้อเสนอ" ให้ผู้ดูแลกดยืนยัน ไม่ใช่การตั้งค่าอัตโนมัติ
 * เพราะอักษรที่ใช้อยู่เดิมไม่ได้มาจากตัวแรกของชื่อจริง — วัดจากฐานจริงพบว่า 7 ใน 10 คน
 * อักษรไม่ตรงกับตัวแรกของชื่อเลย น่าจะมาจากชื่อเล่นซึ่งไม่มีในฐานข้อมูล
 * การเดาแล้วตั้งให้เองจะทำให้เลขที่เอกสารชี้ผิดคนอย่างถาวร
 */
const THAI_INITIAL = {
  'ก':'K','ข':'K','ฃ':'K','ค':'K','ฅ':'K','ฆ':'K','ง':'N','จ':'C','ฉ':'C','ช':'C',
  'ซ':'S','ฌ':'C','ญ':'Y','ฎ':'D','ฏ':'T','ฐ':'T','ฑ':'T','ฒ':'T','ณ':'N','ด':'D',
  'ต':'T','ถ':'T','ท':'T','ธ':'T','น':'N','บ':'B','ป':'P','ผ':'P','ฝ':'F','พ':'P',
  'ฟ':'F','ภ':'P','ม':'M','ย':'Y','ร':'R','ล':'L','ว':'W','ศ':'S','ษ':'S','ส':'S',
  'ห':'H','ฬ':'L','อ':'A','ฮ':'H',
};

/** ตัวอักษรโรมันจากพยางค์แรก — ข้ามสระหน้า เ แ โ ใ ไ ที่เขียนก่อนพยัญชนะ */
function initialOf(word) {
  for (const ch of String(word || '')) {
    if (/[A-Za-z]/.test(ch)) return ch.toUpperCase();
    if (THAI_INITIAL[ch]) return THAI_INITIAL[ch];
  }
  return '';
}

function suggestDocCode(fullName, taken) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const first = initialOf(parts[0]);
  const last = initialOf(parts[1]);
  if (!first) return null;
  // ชื่อ+นามสกุล ถ้ามี · ไม่มีนามสกุลก็ใช้ตัวเดียว แล้วเติมตัวเลขเมื่อชน
  const candidates = [first + last, first, first + 'A'].filter(c => c && c.length <= 2);
  for (const c of candidates) if (!taken.has(c)) return c;
  for (let i = 1; i <= 9; i++) if (!taken.has(first + i)) return first + i;
  return null;
}

// GET /api/rebate/doc-codes — รหัสผู้ขอที่ตั้งไว้แล้ว + หลักฐานจากเอกสารในอดีต
router.get('/doc-codes', requireRole('ADMIN', 'C_LEVEL', 'MANAGER', 'ACCOUNTING'), async (req, res) => {
  try {
    const assigned = (await wfQuery(`
      SELECT Id AS UserId, Username, DisplayName, EmpId, Role, RebateDocCode
      FROM wf.AppUser
      WHERE IsActive = 1 AND (RebateDocCode IS NOT NULL OR Role IN ('SALES','MANAGER'))
      ORDER BY CASE WHEN RebateDocCode IS NULL THEN 1 ELSE 0 END, RebateDocCode, Username`)).recordset || [];

    // หลักฐาน: อักษรชุดใดเคยออกให้ลูกค้าของพนักงานขายคนไหนบ้าง
    // ใช้ช่วยผู้ดูแลตั้งรหัส ไม่ได้ตั้งให้อัตโนมัติ เพราะบางอักษรคาบเกี่ยวหลายคน
    const evidence = (await wfQuery(`
      SELECT SeriesCode, EmpCode, EmpName, DocCount, FirstDoc, LastDoc, TotalAmnt
      FROM wf.v_RebateDocCodeEvidence
      WHERE DocCount >= 20
      ORDER BY SeriesCode, DocCount DESC`)).recordset || [];

    // เติมข้อเสนอรหัสให้คนที่ยังไม่มี — ผู้ดูแลกดยืนยันเองในหน้าจอ
    const taken = new Set(assigned.map(u => u.RebateDocCode).filter(Boolean));
    const withSuggestion = assigned.map(u => {
      if (u.RebateDocCode) return { ...u, suggested: null };
      const code = suggestDocCode(u.DisplayName || u.Username, taken);
      if (code) taken.add(code);
      return { ...u, suggested: code };
    });

    res.json({ assigned: withSuggestion, evidence });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// PATCH /api/rebate/doc-codes/:userId — ตั้ง/ล้างรหัสผู้ขอของผู้ใช้รายหนึ่ง
router.patch('/doc-codes/:userId', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ message: 'userId ไม่ถูกต้อง' });

    const raw = req.body?.code;
    const code = raw === null || raw === undefined || String(raw).trim() === ''
      ? null : String(raw).trim().toUpperCase();
    // A-Z เท่านั้น เพราะเลขที่เอกสารต้องอ่านออกและพิมพ์ตามได้จากกระดาษ
    if (code !== null && !/^[A-Z]{1,2}$/.test(code)) {
      return res.status(400).json({ message: 'รหัสผู้ขอต้องเป็นตัวอักษร A-Z 1-2 ตัว' });
    }

    if (code) {
      const taken = (await wfQuery(
        `SELECT Username FROM wf.AppUser WHERE RebateDocCode = @c AND Id <> @id`,
        { c: { type: sql.NVarChar(2), value: code }, id: { type: sql.Int, value: userId } })).recordset?.[0];
      // ปล่อยให้ซ้ำไม่ได้ — เลขที่เอกสารสองคนจะชนกันและตรวจย้อนกลับไม่ได้ว่าใครขอ
      if (taken) return res.status(409).json({ message: `รหัส ${code} ถูกใช้โดย ${taken.Username} แล้ว` });
    }

    const r = await wfQuery(
      `UPDATE wf.AppUser SET RebateDocCode = @c OUTPUT inserted.Id, inserted.Username, inserted.RebateDocCode WHERE Id = @id`,
      { c: { type: sql.NVarChar(2), value: code }, id: { type: sql.Int, value: userId } });
    if (!r.recordset?.length) return res.status(404).json({ message: 'ไม่พบผู้ใช้' });
    res.json(r.recordset[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/next-rb-no — เสนอเลขที่ใบคืนรีเบทใบถัดไปของผู้ขอรายนั้น
//
// อ่านลำดับล่าสุดจาก dbo.SOInvHD ตรง ๆ ไม่เก็บตัวนับของตัวเอง — ตัวนับที่แยกกัน
// จะเดินคนละทางกับ WINSpeed ทันทีที่มีคนคีย์ใบตรงในโปรแกรมเดิม
router.get('/next-rb-no', async (req, res) => {
  try {
    const userId = Number(req.query.userId) || Number(req.user.sub);
    const u = (await wfQuery(
      `SELECT Username, DisplayName, RebateDocCode FROM wf.AppUser WHERE Id = @id`,
      { id: { type: sql.Int, value: userId } })).recordset?.[0];
    if (!u) return res.status(404).json({ message: 'ไม่พบผู้ใช้' });
    if (!u.RebateDocCode) {
      return res.status(409).json({
        code: 'NO_DOC_CODE',
        message: `${u.DisplayName || u.Username} ยังไม่ได้ตั้งรหัสผู้ขอใช้รีเบท — ตั้งที่ ข้อมูลหลัก → ผู้อนุมัติรายภาค`,
      });
    }

    const yy = String(req.query.beYear || beYY()).slice(-2);
    const prefix = `RB${u.RebateDocCode}${yy}-`;
    // เรียงตาม "ตัวเลขลำดับ" ไม่ใช่ตามสตริง และตัดใบที่ส่วนท้ายไม่ใช่ตัวเลขทิ้ง
    //
    // ทำไมต้องกรอง: เคยมีใบ RBT69-TEST อยู่ในระบบ พอ ORDER BY DocuNo DESC
    // สตริง 'TEST' ชนะ '053' จึงถูกเลือกมาเป็นใบล่าสุด แล้ว parseInt('TEST') = NaN
    // ตกไปที่ nextSeq = 1 → เสนอเลข RBT69-001 ที่ถูกใช้ไปแล้ว (ของจริงต้องเป็น 054)
    // วัดจริง 22/08/2569 — ชุด T พังชุดเดียว อีก 7 ชุดถูกเพราะไม่มีใบที่ท้ายเป็นตัวอักษร
    //
    // TRY_CAST คืน NULL เมื่อแปลงไม่ได้ จึงคัดใบแบบ TEST ออกได้โดยไม่ต้อง hardcode คำว่า TEST
    const last = (await wfQuery(`
      WITH CandidateDocs AS (
        SELECT DocuNo,
               CASE 
                 WHEN SUBSTRING(DocuNo, @plen + 1, 10) NOT LIKE '%[^0-9]%'
                  AND SUBSTRING(DocuNo, @plen + 1, 10) <> ''
                  AND (
                    LEN(SUBSTRING(DocuNo, @plen + 1, 10)) <= 9
                    OR (LEN(SUBSTRING(DocuNo, @plen + 1, 10)) = 10 AND CAST(SUBSTRING(DocuNo, @plen + 1, 10) AS BIGINT) <= 2147483647)
                  )
                 THEN CAST(SUBSTRING(DocuNo, @plen + 1, 10) AS INT)
                 ELSE NULL
               END AS Seq
        FROM   dbo.SOInvHD WITH (NOLOCK)
        WHERE  Docutype = 106 AND DocuNo LIKE @p
      )
      SELECT TOP 1 DocuNo, Seq
      FROM   CandidateDocs
      WHERE  Seq IS NOT NULL
      ORDER  BY Seq DESC, DocuNo DESC`,
      {
        p:    { type: sql.NVarChar(25), value: `${prefix}%` },
        plen: { type: sql.Int, value: prefix.length },
      })).recordset?.[0];

    const lastSeq = last ? Number(last.Seq) : 0;
    const nextSeq = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
    res.json({
      docCode: u.RebateDocCode,
      beYear: yy,
      lastDocuNo: last?.DocuNo || null,
      suggested: `${prefix}${String(nextSeq).padStart(3, '0')}`,
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/rb-reconciliation — ใบขอเคลียร์ในแอป ↔ ใบคืนรีเบทใน WINSpeed
router.get('/rb-reconciliation', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const inputs = {};
    let where = 'WHERE 1=1';
    if (req.query.from) { where += ' AND (RbDocDate IS NULL OR RbDocDate >= @from)'; inputs.from = { type: sql.Date, value: req.query.from }; }
    if (req.query.to)   { where += ' AND (RbDocDate IS NULL OR RbDocDate <= @to)';   inputs.to   = { type: sql.Date, value: req.query.to }; }
    if (req.query.onlyProblems === 'true') where += ` AND MatchStatus <> N'ตรงกัน'`;

    const rows = (await wfQuery(`
      SELECT Side, ClaimId, RbDocuNo, CustId, AppAmt, WinAmt, RbDocDate, PeriodYear, PeriodMonth, Status, MatchStatus
      FROM wf.v_RebateRbReconciliation
      ${where}
      ORDER BY CASE WHEN MatchStatus = N'ตรงกัน' THEN 1 ELSE 0 END, RbDocDate DESC, RbDocuNo`, inputs)).recordset || [];

    const summary = rows.reduce((m, r) => { m[r.MatchStatus] = (m[r.MatchStatus] || 0) + 1; return m; }, {});
    res.json({ summary, rows: rows.slice(0, 500), truncated: rows.length > 500 });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/wf-trail-summary
router.get('/wf-trail-summary', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
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

// GET /api/rebate/wf-trail-list
router.get('/wf-trail-list', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
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

// GET /api/rebate/wf-trail-detail/:soId
router.get('/wf-trail-detail/:soId', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const soId = Number(req.params.soId);
    if (!Number.isFinite(soId)) return res.status(400).json({ message: 'Invalid SOID' });

    const so = (await wfQuery(`
      SELECT h.*, emp.EmpName AS SalesName
      FROM dbo.SOHD h
      LEFT JOIN dbo.EMEmp emp ON emp.EmpID = h.EmpID
      WHERE h.SOID = @soId
    `, { soId: { type: sql.Int, value: soId } })).recordset?.[0];
    if (!so) return res.status(404).json({ message: `ไม่พบข้อมูล SOID ${soId}` });

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

// GET /api/rebate/cn-summary
router.get('/cn-summary', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
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

// GET /api/rebate/cn-list?year=&empId=&custId=
router.get('/cn-list', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
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

// GET /api/rebate/cn-detail/:soInvId
router.get('/cn-detail/:soInvId', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const soInvId = Number(req.params.soInvId);
    if (!Number.isFinite(soInvId)) return res.status(400).json({ message: 'Invalid SOInvID' });

    const r = await wfQuery(`
        SELECT
          d.ListNo,
          d.GoodName,
          d.GoodQty2     AS QtyTon,
          d.GoodPrice2   AS RebatePerTon,
          d.GoodAmnt     AS RebateAmt,
          inv_d.GoodPrice2 AS OrigPrice
        FROM dbo.SOInvDT d
        LEFT JOIN dbo.SOInvHD cn    ON cn.SOInvID = d.SOInvID
        LEFT JOIN dbo.SOInvDT inv_d ON inv_d.SOInvID = cn.RefSOID AND inv_d.GoodID = d.GoodID
        WHERE d.SOInvID = @id
        ORDER BY d.ListNo
      `, { id: { type: sql.Int, value: soInvId } });
    if (!r.recordset || r.recordset.length === 0) {
      return res.status(404).json({ message: `ไม่พบข้อมูลรายละเอียด CN ID ${soInvId}` });
    }
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/rebate/sync-mirror — เลิกใช้แล้ว
//
// wf.CouponMirror เป็นสำเนาของ dbo.WFCoupon ที่ต้องกดปุ่มให้ตรงกันเอง ซึ่งเป็นต้นเหตุ
// ที่ข้อมูลรีเบทแยกกันเป็นสองชุด · ตั้งแต่ v1.6.1 ทุกหน้าจออ่านจาก dbo โดยตรง
// คงเส้นทางไว้เพื่อไม่ให้ไคลเอนต์รุ่นเก่าพัง แต่ตอบ 410 พร้อมบอกว่าให้ไปใช้อะไรแทน
router.post('/sync-mirror', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  res.status(410).json({
    message: 'ไม่ต้อง sync แล้ว — ยอดคูปองอ่านจาก WINSpeed โดยตรง',
    use: 'GET /api/rebate/coupons หรือ GET /api/rebate/accrual',
  });
});

// GET /api/rebate/coupons — คูปองคงค้างใน WINSpeed สรุปรายลูกค้า
//
// อ่านจาก dbo.WFCoupon โดยตรง · เดิมอ่านจาก wf.CouponMirror ซึ่งเป็นสำเนาที่ต้อง
// กดปุ่ม sync และไม่เคยถูก sync เลย (0 แถว) หน้าจอจึงว่างทั้งที่ในระบบมีคูปองอยู่จริง
// สำเนาที่ต้องกดปุ่มให้ตรงกันคือสิ่งที่ทำให้ข้อมูลรีเบทแยกกันตั้งแต่แรก
// GET /api/rebate/coupons — คูปองคงค้างใน WINSpeed สรุปรายลูกค้า
// R9-6: Scoped to salesperson's own EmpID if role is SALES
router.get('/coupons', async (req, res) => {
  try {
    const scopeEmpIds = await resolveScopeEmpIds(req.user);
    if (scopeEmpIds && !scopeEmpIds.length) return res.json([]);
    const { custId, empId } = req.query;
    let where = 'WHERE c.RemaQty > 0';
    const inputs = {};
    if (custId) { where += ` AND hd.CustID = @custId`; inputs.custId = { type: sql.NVarChar(20), value: custId }; }

    if (scopeEmpIds) where += empInClause('hd.EmpID', scopeEmpIds, inputs);
    if (empId && (!scopeEmpIds || scopeEmpIds.includes(Number(empId)))) { where += ` AND hd.EmpID = @empId`; inputs.empId = { type: sql.Int, value: Number(empId) }; }

    const r = await wfQuery(`
      SELECT CAST(hd.CustID AS NVARCHAR(20)) AS CustID,
             ISNULL(MAX(cu.CustName), MAX(hd.CustName)) AS CustName,
             hd.EmpID AS EmpID,
             ISNULL(MAX(emp.EmpName), CAST(hd.EmpID AS NVARCHAR(20))) AS EmpName,
             COUNT(c.CouponID)   AS CouponCount,
             SUM(c.RemaQty)      AS OutstandingTon,
             MIN(hd.DocuDate)    AS OldestDate
      FROM dbo.WFCoupon c
      JOIN dbo.SOHD hd        ON hd.SOID  = c.DocuID
      LEFT JOIN dbo.EMCust cu ON cu.CustID = hd.CustID
      LEFT JOIN dbo.EMEmp emp ON emp.EmpID = hd.EmpID
      ${where}
      GROUP BY hd.CustID, hd.EmpID
      ORDER BY OutstandingTon DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/coupons-worklist — Cross-customer near-expiry / expired coupon worklist (R9-6, R10-6)
router.get('/coupons-worklist', async (req, res) => {
  try {
    const scopeEmpIds = await resolveScopeEmpIds(req.user);
    if (scopeEmpIds && !scopeEmpIds.length) return res.json([]);
    const inputs = {};
    let where = 'WHERE c.RemaQty > 0';
    if (scopeEmpIds) where += empInClause('hd.EmpID', scopeEmpIds, inputs);

    let defaultDays = 180;
    let warningLeadDays = 30;
    try {
      const s = await wfQuery(`
        SELECT SettingKey, SettingValue 
        FROM wf.SystemSetting WITH (NOLOCK) 
        WHERE SettingKey IN ('TICKET_EXPIRY_DEFAULT_DAYS', 'TICKET_EXPIRY_WARNING_LEAD_DAYS')
      `);
      for (const row of s.recordset || []) {
        if (row.SettingKey === 'TICKET_EXPIRY_DEFAULT_DAYS') defaultDays = Number(row.SettingValue) || 180;
        if (row.SettingKey === 'TICKET_EXPIRY_WARNING_LEAD_DAYS') warningLeadDays = Number(row.SettingValue) || 30;
      }
    } catch { /* fallback */ }

    const r = await wfQuery(`
      SELECT c.CouponID, c.CouponNo, c.SONo,
             CONVERT(VARCHAR(10), hd.DocuDate, 120) AS DocuDate,
             CAST(hd.CustID AS NVARCHAR(20)) AS CustID,
             cu.CustCode,
             ISNULL(cu.CustName, hd.CustName) AS CustName,
             hd.EmpID AS EmpID,
             ISNULL(emp.EmpName, CAST(hd.EmpID AS NVARCHAR(20))) AS EmpName,
             c.GoodID, c.GoodName,
             c.GoodQty, c.RemaQty,
             CONVERT(VARCHAR(10), exp.ExpiryDate, 120) AS CustomExpiryDate,
             exp.Source AS ExpirySource
      FROM dbo.WFCoupon c
      JOIN dbo.SOHD hd        ON hd.SOID  = c.DocuID
      LEFT JOIN dbo.EMCust cu ON cu.CustID = hd.CustID
      LEFT JOIN dbo.EMEmp emp ON emp.EmpID = hd.EmpID
      LEFT JOIN wf.CouponExpiry exp ON exp.CouponId = c.CouponID
      ${where}
      ORDER BY hd.DocuDate ASC, c.CouponNo ASC
    `, inputs);

    const benesRes = await wfQuery(`
      SELECT b.OwnerCustId, b.BeneficiaryCustId, b.BeneficiaryCustCode,
             ISNULL(NULLIF(b.BeneficiaryCustName, ''), ISNULL(cu.CustName, ISNULL(b.BeneficiaryCustCode, b.BeneficiaryCustId))) AS BeneficiaryCustName,
             b.Scope, b.EffectiveTo, b.Reason
      FROM wf.CouponBeneficiary b WITH (NOLOCK)
      LEFT JOIN dbo.EMCust cu ON CAST(cu.CustID AS NVARCHAR(50)) = b.BeneficiaryCustId OR cu.CustCode = b.BeneficiaryCustCode
      WHERE b.Status = 'ACTIVE'
        AND (b.EffectiveFrom IS NULL OR b.EffectiveFrom <= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
        AND (b.EffectiveTo IS NULL OR b.EffectiveTo >= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
    `);
    const beneMap = new Map();
    for (const b of benesRes.recordset || []) {
      const arr = beneMap.get(String(b.OwnerCustId)) || [];
      arr.push({
        beneficiaryCustId: b.BeneficiaryCustId,
        beneficiaryCustCode: b.BeneficiaryCustCode,
        beneficiaryCustName: b.BeneficiaryCustName || b.BeneficiaryCustCode || b.BeneficiaryCustId,
        scope: b.Scope,
        reason: b.Reason
      });
      beneMap.set(String(b.OwnerCustId), arr);
    }

    const rows = (r.recordset || []).map(row => {
      let expiryDate = row.CustomExpiryDate || null;
      let source = row.ExpirySource || 'DEFAULT';
      if (!expiryDate && row.DocuDate) {
        const issueDate = new Date(row.DocuDate);
        const exp = new Date(issueDate.getTime() + defaultDays * 24 * 60 * 60 * 1000);
        expiryDate = exp.toISOString().slice(0, 10);
      }
      const daysLeft = expiryDate ? Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;
      const ownerBenes = beneMap.get(String(row.CustID)) || [];
      const relevantBenes = ownerBenes.filter(b => b.scope === 'ALL' || b.scope === String(row.GoodID));

      return {
        couponId: row.CouponID,
        couponNo: row.CouponNo,
        soNo: row.SONo,
        docuDate: row.DocuDate,
        custId: row.CustID,
        custCode: row.CustCode,
        ownerCustCode: row.CustCode,
        custName: row.CustName,
        empId: row.EmpID,
        empName: row.EmpName,
        goodId: row.GoodID,
        goodName: row.GoodName,
        goodQty: Number(row.GoodQty || 0),
        remaQty: Number(row.RemaQty || 0),
        redeemedQty: Math.max(0, Number(row.GoodQty || 0) - Number(row.RemaQty || 0)),
        customExpiryDate: row.CustomExpiryDate,
        expiryDate,
        expirySource: source,
        daysLeft,
        isExpired: daysLeft !== null ? daysLeft < 0 : false,
        isExpiringSoon: daysLeft !== null ? (daysLeft >= 0 && daysLeft <= warningLeadDays) : false,
        warningLeadDays,
        beneficiaries: relevantBenes
      };
    });

    res.json(rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/coupons/:custId — คูปองคงค้างของลูกค้ารายนี้ เรียงเก่าก่อน (FIFO) พร้อมวันหมดอายุ
router.get('/coupons/:custId', async (req, res) => {
  try {
    const custId = String(req.params.custId || '').trim();
    if (!custId) return res.status(400).json({ message: 'Invalid customer ID' });

    const scopeEmpIds = await resolveScopeEmpIds(req.user);
    if (scopeEmpIds) {
      if (!scopeEmpIds.length) {
        return res.status(403).json({ message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลคูปอง (ไม่พบรหัสพนักงานขายที่ผูกกับบัญชี)' });
      }
      const ci = { cid: { type: sql.NVarChar(20), value: custId } };
      const inList = empInClause('EmpID', scopeEmpIds, ci).replace(/^ AND /, '');
      const authCust = await wfQuery(`
        SELECT TOP 1 1 FROM dbo.SOHD WHERE CustID = @cid AND ${inList}
        UNION
        SELECT TOP 1 1 FROM dbo.EMCust WHERE CustID = @cid AND ${inList}
      `, ci);
      if (!authCust.recordset?.length) {
        return res.status(403).json({ message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลคูปองของลูกค้ารายนี้' });
      }
    }

    let defaultDays = 180;
    let warningLeadDays = 30;
    try {
      const s = await wfQuery(`
        SELECT SettingKey, SettingValue 
        FROM wf.SystemSetting WITH (NOLOCK) 
        WHERE SettingKey IN ('TICKET_EXPIRY_DEFAULT_DAYS', 'TICKET_EXPIRY_WARNING_LEAD_DAYS')
      `);
      for (const row of s.recordset || []) {
        if (row.SettingKey === 'TICKET_EXPIRY_DEFAULT_DAYS') defaultDays = Number(row.SettingValue) || 180;
        if (row.SettingKey === 'TICKET_EXPIRY_WARNING_LEAD_DAYS') warningLeadDays = Number(row.SettingValue) || 30;
      }
    } catch { /* fallback */ }

    const r = await wfQuery(`
        SELECT c.CouponID, c.CouponNo, c.SONo,
               CONVERT(VARCHAR(10), hd.DocuDate, 120) AS DocuDate,
               CAST(hd.CustID AS NVARCHAR(20)) AS CustID,
               ISNULL(cu.CustName, hd.CustName) AS CustName,
               hd.EmpID AS EmpID,
               ISNULL(emp.EmpName, CAST(hd.EmpID AS NVARCHAR(20))) AS EmpName,
               c.GoodID, c.GoodName, c.GoodPrice,
               c.GoodQty, c.RemaQty,
               c.GoodQty - c.RemaQty AS RedeemedQty,
               CONVERT(VARCHAR(10), exp.ExpiryDate, 120) AS CustomExpiryDate,
               exp.Source AS ExpirySource
        FROM dbo.WFCoupon c
        JOIN dbo.SOHD hd        ON hd.SOID  = c.DocuID
        LEFT JOIN dbo.EMCust cu ON cu.CustID = hd.CustID
        LEFT JOIN dbo.EMEmp emp ON emp.EmpID = hd.EmpID
        LEFT JOIN wf.CouponExpiry exp ON exp.CouponId = c.CouponID
        WHERE hd.CustID = @cid AND c.RemaQty > 0
        ORDER BY hd.DocuDate ASC, c.CouponNo ASC
      `, { cid: { type: sql.NVarChar(20), value: custId } });
    if (!r.recordset || r.recordset.length === 0) {
      return res.status(404).json({ message: `ไม่พบคูปองคงค้างสำหรับลูกค้า ID ${custId}` });
    }

    const benes = (await wfQuery(`
      SELECT b.BeneficiaryCustId, b.BeneficiaryCustCode,
             ISNULL(NULLIF(b.BeneficiaryCustName, ''), ISNULL(cu.CustName, ISNULL(b.BeneficiaryCustCode, b.BeneficiaryCustId))) AS BeneficiaryCustName,
             b.Scope, b.EffectiveTo, b.Reason
      FROM wf.CouponBeneficiary b WITH (NOLOCK)
      LEFT JOIN dbo.EMCust cu ON CAST(cu.CustID AS NVARCHAR(50)) = b.BeneficiaryCustId OR cu.CustCode = b.BeneficiaryCustCode
      WHERE b.OwnerCustId = @cid AND b.Status = 'ACTIVE'
        AND (b.EffectiveFrom IS NULL OR b.EffectiveFrom <= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
        AND (b.EffectiveTo IS NULL OR b.EffectiveTo >= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
    `, { cid: { type: sql.NVarChar(20), value: custId } })).recordset || [];

    const isSales = req.user?.role === 'SALES';

    const rows = r.recordset.map(row => {
      let expiryDate = row.CustomExpiryDate || null;
      let source = row.ExpirySource || 'DEFAULT';
      if (!expiryDate && row.DocuDate) {
        const issueDate = new Date(row.DocuDate);
        const exp = new Date(issueDate.getTime() + defaultDays * 24 * 60 * 60 * 1000);
        expiryDate = exp.toISOString().slice(0, 10);
      }
      const daysLeft = expiryDate ? Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;
      const relevantBenes = benes.filter(b => b.Scope === 'ALL' || b.Scope === String(row.GoodID)).map(b => ({
        beneficiaryCustId: b.BeneficiaryCustId,
        beneficiaryCustCode: b.BeneficiaryCustCode,
        beneficiaryCustName: b.BeneficiaryCustName || b.BeneficiaryCustCode || b.BeneficiaryCustId,
        scope: b.Scope,
        reason: b.Reason
      }));

      const out = {
        ...row,
        expiryDate,
        expirySource: source,
        daysLeft,
        isExpired: daysLeft !== null ? daysLeft < 0 : false,
        isExpiringSoon: daysLeft !== null ? (daysLeft >= 0 && daysLeft <= warningLeadDays) : false,
        warningLeadDays,
        beneficiaries: relevantBenes
      };
      if (isSales) delete out.GoodPrice;
      return out;
    });

    res.json(rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

/**
 * POST /api/rebate/claims/:id/apply-to-bill
 * D7/D8 & R9-1: Apply approved rebate claim as a discount to a draft SO
 * Restricted to ACCOUNTING, ADMIN, C_LEVEL
 */
router.post('/claims/:id/apply-to-bill', requireRole('ACCOUNTING', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  const claimId = Number(req.params.id);
  const { soId, targetSoId } = req.body || {};

  try {
    const result = await wfTransaction(async (tx) => {
      return await applyClaimToDraft(tx, { claimId, soId: soId ?? targetSoId, targetSoId, user: req.user });
    });

    res.json({
      success: true,
      message: `นำยอดรีเบท ฿${result.discountApplied.toLocaleString()} จากเคลม ${result.claimNo} ไปหักลดใน SO #${result.soId} เรียบร้อยแล้ว`,
      data: result
    });
  } catch (err) {
    console.error('[rebate/claims/apply-to-bill]', err);
    res.status(err.status || 500).json({ message: err.message, code: err.code });
  }
});

router.normalizeClaim = normalizeClaim;
router.buildCanonicalPayloadHash = buildCanonicalPayloadHash;
router.resolveCustomer = resolveCustomer;
router.getCustomerRegion = getCustomerRegion;
router.normalizePlanRegion = normalizePlanRegion;
router.normalizeGoodPattern = normalizeGoodPattern;
router.CANONICAL_SALE_REGIONS = CANONICAL_SALE_REGIONS;
module.exports = router;
