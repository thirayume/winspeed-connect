/**
 * rebate.js — Rebate Pool + FIFO Ledger + Claims (4-Tier Approval & Multi-Line Items)
 * ⚠ Writes ไปที่ wf schema เท่านั้น
 */
const router = require('express').Router();
const { sql, wfQuery, query } = require('../db');
const { requireAuth, requireRole, requireRebateAmountAccess, canViewAllRebateAmounts } = require('../middleware/auth');

router.use(requireAuth);

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

async function getCustomerRegion(custId) {
  if (!custId) return '99';
  try {
    const r = await wfQuery(`
      SELECT TOP 1 sa.SaleAreaCode
      FROM dbo.EMCust c
      JOIN dbo.EMSaleArea sa ON sa.SaleAreaID = c.SaleAreaID
      WHERE c.CustID = @cid
    `, { cid: { type: sql.NVarChar(20), value: String(custId) } });
    const code = r.recordset?.[0]?.SaleAreaCode;
    if (!code || code.length < 2) return '99';
    const reg = code.substring(0, 2);
    return ['01', '02', '03', '04', '05', '06'].includes(reg) ? reg : '99';
  } catch (e) {
    console.warn(`[rebate] Could not infer region for customer ${custId}: ${e.message}`);
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
    if (canViewAllRebateAmounts(req.user)) {
      if (userId) { conditions.push(`p.SalesUserId = @uid`); inputs.uid = { type: sql.Int, value: Number(userId) }; }
    } else {
      conditions.push(`p.SalesUserId = @uid`);
      inputs.uid = { type: sql.Int, value: Number(req.user.sub) };
    }
    if (year)   { conditions.push(`p.PeriodYear = @y`);   inputs.y  = { type: sql.Int, value: Number(year) }; }
    if (month)  { conditions.push(`p.PeriodMonth = @m`);  inputs.m  = { type: sql.Int, value: Number(month) }; }
    
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
    if (!canViewAllRebateAmounts(req.user)) {
      conditions.push(`c.SalesUserId = @salesUserId`);
      inputs.salesUserId = { type: sql.Int, value: Number(req.user.sub) };
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await wfQuery(`
      SELECT c.*, u.DisplayName AS SalesName, r.RegionName,
             (SELECT COUNT(*) FROM wf.RebateClaimLine l WHERE l.ClaimId = c.Id) AS LineCount,
             (SELECT COUNT(*) FROM wf.RebateClaimInvoice i WHERE i.ClaimId = c.Id) AS InvoiceCount
      FROM wf.RebateClaim c
      JOIN wf.AppUser u ON u.Id = c.SalesUserId
      LEFT JOIN wf.SaleRegion r ON r.RegionCode = c.RegionCode
      ${where}
      ORDER BY c.CreatedAt DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/claims/:id — ดึงใบขอเคลียร์ใบเดียวพร้อมรายการย่อย และประวัติการอนุมัติ
router.get('/claims/:id', requireRebateAmountAccess, async (req, res) => {
  try {
    const claimId = Number(req.params.id);
    if (!Number.isFinite(claimId)) return res.status(400).json({ message: 'Invalid claim ID' });

    const claimR = await wfQuery(`
      SELECT c.*, u.DisplayName AS SalesName, r.RegionName, appvUser.DisplayName AS ApprovedByName
      FROM wf.RebateClaim c
      JOIN wf.AppUser u ON u.Id = c.SalesUserId
      LEFT JOIN wf.SaleRegion r ON r.RegionCode = c.RegionCode
      LEFT JOIN wf.AppUser appvUser ON appvUser.Id = c.ApprovedBy
      WHERE c.Id = @id
    `, { id: { type: sql.Int, value: claimId } });

    const claim = claimR.recordset?.[0];
    if (!claim) return res.status(404).json({ message: `ไม่พบใบขอเคลียร์ ID ${claimId}` });

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

    res.json({ claim, lines, approvals, invoices, totals });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/rebate/claims — ยื่นเคลม (รองรับ Multi-line 6 บรรทัด & 4-Tier Approval parity)
router.post('/claims', requireRole('SALES', 'ACCOUNTING', 'ADMIN', 'C_LEVEL', 'MANAGER'), async (req, res) => {
  try {
    const { poolId, claimAmt, custId, note, lines, invoices, periodYear, periodMonth } = req.body;
    if (!claimAmt && (!lines || !lines.length)) {
      return res.status(400).json({ message: 'ต้องระบุ claimAmt หรือรายการย่อย lines' });
    }

    // poolId ไม่บังคับแล้ว — ยอดสะสมอ่านจาก WINSpeed ตรง ๆ (ดู migration 076)
    // ยังรับไว้เพื่อความเข้ากันได้กับใบเก่าและงบที่จัดสรรรายพนักงานขาย
    let pool = null;
    if (poolId) {
      pool = (await wfQuery(`SELECT * FROM wf.RebatePool WHERE Id=@id`, { id: { type: sql.Int, value: poolId } })).recordset?.[0];
      if (!pool) return res.status(404).json({ message: 'ไม่พบ pool' });
      if (!canViewAllRebateAmounts(req.user) && Number(pool.SalesUserId) !== Number(req.user.sub)) {
        return res.status(403).json({ message: 'ไม่มีสิทธิ์เคลม pool ของพนักงานขายอื่น' });
      }
    }

    // Determine lines & calculated total
    let totalAmt = Number(claimAmt || 0);
    const parsedLines = [];

    if (Array.isArray(lines) && lines.length > 0) {
      // แบบฟอร์มมี 6 บรรทัดต่อตาราง และมีสองตาราง จึงรวมได้ 12 บรรทัด
      if (lines.length > 12) return res.status(400).json({ message: 'ใบขอเคลียร์รองรับสูงสุด 12 รายการย่อย (6 บรรทัดต่อตาราง)' });
      const perTable = lines.reduce((m, l) => {
        const k = String(l.lineType || 'REBATE').toUpperCase() === 'DIFF' ? 'DIFF' : 'REBATE';
        m[k] = (m[k] || 0) + 1; return m;
      }, {});
      for (const [kind, n] of Object.entries(perTable)) {
        if (n > 6) return res.status(400).json({ message: `ตาราง${kind === 'DIFF' ? 'คืนส่วนต่าง' : 'คืนรีเบท'}รองรับสูงสุด 6 บรรทัด` });
      }
      if (!custId) {
        return res.status(400).json({
          message: 'ต้องระบุลูกค้า (custId) เมื่อยื่นรายการย่อย — ยอดสะสมอ่านจากใบส่งของของลูกค้ารายนั้น'
        });
      }

      // ── ตัดสิทธิ์แบบ FIFO จากใบส่งของจริงใน WINSpeed ─────────────────────────
      //
      // แต่ละบรรทัดบนแบบฟอร์ม (สูตรปุ๋ย + ตัน) ถูกกระจายลงล็อตที่เก่าที่สุดก่อน
      // ล็อต = หนึ่งบรรทัดของใบส่งของ (SOID + ListNo) จึงตอบได้เสมอว่าเงินที่คืน
      // มาจากการขนเที่ยวใด ใบกำกับเลขใด ซึ่งเป็นสิ่งที่ผู้ตรวจ ISO ขอดู
      //
      // ผู้ยื่นระบุใบเองก็ได้ (ส่ง sourceSOID/sourceListNo มา) ระบบจะตัดใบนั้นตรง ๆ
      // เพราะแบบฟอร์มกระดาษมีช่อง "เลขที่ INV" ให้เขียนเจาะจงอยู่แล้ว
      const lotRows = (await wfQuery(`
        SELECT SourceSOID, SourceListNo, SourceDocuNo, SourceDocuDate, CouponNo,
               SourceRefSOID, SourceRefListNo, SourceBookingDocuNo,
               GoodCode, GoodName, ListPricePerTon, NetPricePerTon, RebatePerTon, PlanId,
               RemainingTonRebate, RemainingTonDiff
        FROM wf.v_RebateAccrualRemaining
        WHERE CustId = @cid AND (RemainingTonRebate > 0 OR RemainingTonDiff > 0)
        ORDER BY SourceDocuDate ASC, SourceDocuNo ASC, SourceListNo ASC`,
        { cid: { type: sql.NVarChar(20), value: String(custId) } })).recordset || [];

      // ตันที่ถูกจองไปแล้วภายในคำขอฉบับนี้ — กันสองบรรทัดของใบเดียวกันแย่งล็อตซ้ำ
      const takenInRequest = new Map();
      const keyOf = (lot, kind) => `${lot.SourceSOID}|${lot.SourceListNo}|${kind}`;
      const lotRemaining = (lot, kind) =>
        Math.round((Number(kind === 'DIFF' ? lot.RemainingTonDiff : lot.RemainingTonRebate)
          - (takenInRequest.get(keyOf(lot, kind)) || 0)) * 1000) / 1000;

      const problems = [];
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
          takenInRequest.set(keyOf(lot, lineType), (takenInRequest.get(keyOf(lot, lineType)) || 0) + take);

          // ราคาที่ใช้: ถ้าผู้ยื่นกรอกมา ใช้ตามที่กรอก (แบบฟอร์มกระดาษเป็นเอกสารต้นทาง)
          // ถ้าไม่กรอก ดึงจากใบส่งของ (ราคาขาย) และแผนส่งเสริมการขายที่อนุมัติแล้ว (ราคาสุทธิ)
          const pricePerTon = Number(l.pricePerTon) > 0 ? Number(l.pricePerTon) : Number(lot.ListPricePerTon || 0);
          const netPricePerTon = Number(l.netPricePerTon) > 0 ? Number(l.netPricePerTon)
            : (lot.NetPricePerTon === null || lot.NetPricePerTon === undefined ? 0 : Number(lot.NetPricePerTon));
          const rebatePerTon = Math.round((pricePerTon - netPricePerTon) * 100) / 100;
          const lineAmount = Math.round(take * rebatePerTon * 100) / 100;
          calculatedSum += lineAmount;

          // ใบขอเคลียร์มีสองตาราง: คืนรีเบท (เทียบราคาสุทธิโปรโมชั่น) และ
          // คืนส่วนต่าง (เทียบราคาขายใน Pricelist) — รูปคำนวณเดียวกัน ต่างที่ราคาที่ใช้เทียบ
          parsedLines.push({
            lineNo: ++seq,
            lineType,
            invoiceNo: (l.invoiceNo ? String(l.invoiceNo).trim() : String(lot.SourceDocuNo || '')).slice(0, 50) || null,
            goodCode: String(lot.GoodCode || goodCode || 'GENERAL').trim(),
            goodName: l.goodName ? String(l.goodName).trim() : (lot.GoodName || null),
            qtyTon: take,
            pricePerTon,
            netPricePerTon,
            rebatePerTon,
            planId: l.planId ? Number(l.planId) : (lot.PlanId ? Number(lot.PlanId) : null),
            remark: l.remark ? String(l.remark).trim() : null,
            sourceSOID: Number(lot.SourceSOID),
            sourceListNo: Number(lot.SourceListNo),
            sourceDocuNo: lot.SourceDocuNo || null,
            sourceDocuDate: lot.SourceDocuDate || null,
            sourceCouponNo: lot.CouponNo || null,
            // ใบสั่งขายต้นทางของบรรทัดใบส่งของนี้ (dbo.SODT.RefSOID) — ดู migration 081
            sourceRefSOID: lot.SourceRefSOID ?? null,
            sourceRefListNo: lot.SourceRefListNo ?? null,
            sourceBookingDocuNo: lot.SourceBookingDocuNo || null,
          });
          want = Math.round((want - take) * 1000) / 1000;
        }

        if (want > 0.001) {
          const kindLabel = lineType === 'DIFF' ? 'คืนส่วนต่าง' : 'คืนรีเบท';
          const totalAvail = wantedFrom.reduce((a, r) => a + Math.max(0, lotRemaining(r, lineType)), 0);
          problems.push(`${goodCode} (${kindLabel}): ขอเคลียร์ ${Number(l.qtyTon)} ตัน แต่ขนจริงคงเหลือ `
            + `${Math.round(totalAvail * 1000) / 1000} ตัน — ขาดอีก ${want} ตัน`);
        }
      }

      // เจตนา: บล็อกและให้คนแก้ ไม่ตัดยอดให้อัตโนมัติ — การตัดเงียบ ๆ จะทำให้ผู้แทนขาย
      // ไม่รู้ว่าถูกหักอะไรไป และตรวจย้อนกลับตอน ISO ไม่ได้ว่าหักด้วยเหตุใด
      if (problems.length) {
        return res.status(400).json({
          message: 'ยอดขอเคลียร์ไม่ตรงกับยอดขนจริง',
          source: 'WINSpeed — ใบส่งของ/ใบกำกับ (DocuType 104) ของลูกค้ารายนี้',
          reconciliation: problems,
        });
      }
      if (!parsedLines.length) {
        return res.status(400).json({ message: 'ไม่มีรายการที่ตัดสิทธิ์ได้' });
      }
      totalAmt = Math.round(calculatedSum * 100) / 100;
    }

    // งบที่จัดสรรให้พนักงานขาย (ถ้าใบนี้ผูกกับ pool) ยังเป็นเพดานอีกชั้น
    // แยกจากการตัดสิทธิ์ตามตัน — คนละเรื่องกัน ตันมาจากการขน เงินมาจากงบที่อนุมัติ
    if (pool) {
      const available = Number(pool.AccruedAmt) - Number(pool.ClaimedAmt);
      if (totalAmt > available) {
        return res.status(400).json({ message: `ยอดเกิน: ขอ ฿${totalAmt.toFixed(2)} ใช้ได้ ฿${available.toFixed(2)}` });
      }
    }

    // Infer RegionCode from Customer
    const regionCode = await getCustomerRegion(custId);

    // งวดที่ขอเบิก — รีเบทเบิกย้อนหลัง ใบ RB ในระบบเดิมเขียนเดือนไว้ในหมายเหตุ
    // ถ้าผู้ยื่นไม่ระบุ ใช้เดือนของใบส่งของที่ใหม่ที่สุดในใบนี้ ซึ่งเป็นงวดที่เบิกจริง
    let pYear = Number(periodYear) || null;
    let pMonth = Number(periodMonth) || null;
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

    // 1. Create RebateClaim Header
    const claimR = await wfQuery(
      `INSERT INTO wf.RebateClaim (PoolId, SalesUserId, CustId, ClaimAmt, RemainingAmt, Status, Note, RegionCode, CurrentTier, PeriodYear, PeriodMonth)
       OUTPUT inserted.*
       VALUES (@pid, @uid, @cid, @amt, @amt, 'TIER2_PENDING', @note, @rcode, 2, @py, @pm)`,
      {
        pid:   { type: sql.Int,          value: pool ? pool.Id : null },
        uid:   { type: sql.Int,          value: req.user.sub },
        cid:   { type: sql.NVarChar(20), value: custId || null },
        amt:   { type: sql.Decimal(12,2),value: totalAmt },
        note:  { type: sql.NVarChar(500),value: note || null },
        rcode: { type: sql.VarChar(10),  value: regionCode },
        py:    { type: sql.Int,          value: pYear },
        pm:    { type: sql.Int,          value: pMonth }
      }
    );
    const claim = claimR.recordset[0];

    // 2. Create RebateClaimLine records
    for (const line of parsedLines) {
      await wfQuery(
        `INSERT INTO wf.RebateClaimLine (ClaimId, [LineNo], LineType, InvoiceNo, GoodCode, GoodName, QtyTon, PricePerTon, NetPricePerTon, RebatePerTon, PlanId, Remark,
                                        SourceSOID, SourceListNo, SourceDocuNo, SourceDocuDate, SourceCouponNo,
                                        SourceRefSOID, SourceRefListNo, SourceBookingDocuNo)
         VALUES (@cid, @lno, @ltype, @inv, @gcode, @gname, @qty, @price, @netPrice, @rebate, @planId, @remark,
                 @sSoid, @sList, @sDocu, @sDate, @sCoup, @sRefSoid, @sRefList, @sBook)`,
        {
          ltype:    { type: sql.NVarChar(10),  value: line.lineType },
          inv:      { type: sql.NVarChar(50),  value: line.invoiceNo },
          cid:      { type: sql.Int,           value: claim.Id },
          lno:      { type: sql.Int,           value: line.lineNo },
          gcode:    { type: sql.NVarChar(50),  value: line.goodCode },
          gname:    { type: sql.NVarChar(200), value: line.goodName },
          qty:      { type: sql.Decimal(18,3), value: line.qtyTon },
          price:    { type: sql.Decimal(18,2), value: line.pricePerTon },
          netPrice: { type: sql.Decimal(18,2), value: line.netPricePerTon },
          rebate:   { type: sql.Decimal(18,2), value: line.rebatePerTon },
          planId:   { type: sql.Int,           value: line.planId },
          remark:   { type: sql.NVarChar(500), value: line.remark },
          // ร่องรอยกลับไปยังบรรทัดใบส่งของที่ถูกตัดสิทธิ์ — ตัวที่ทำให้ FIFO ตรวจย้อนกลับได้
          sSoid:    { type: sql.Int,           value: line.sourceSOID ?? null },
          sList:    { type: sql.Int,           value: line.sourceListNo ?? null },
          sDocu:    { type: sql.NVarChar(25),  value: line.sourceDocuNo ?? null },
          sDate:    { type: sql.Date,          value: line.sourceDocuDate ?? null },
          sCoup:    { type: sql.NVarChar(25),  value: line.sourceCouponNo ?? null },
          // สืบต่อไปถึงใบสั่งขาย — ตอบผู้ตรวจได้ว่าเงินก้อนนี้มาจากคำสั่งซื้อฉบับไหน
          sRefSoid: { type: sql.Int,           value: line.sourceRefSOID ?? null },
          sRefList: { type: sql.Int,           value: line.sourceRefListNo ?? null },
          sBook:    { type: sql.NVarChar(25),  value: line.sourceBookingDocuNo ?? null }
        }
      );
    }

    // 3. Create RebateClaimInvoice records if provided
    if (Array.isArray(invoices) && invoices.length > 0) {
      for (const invNo of invoices) {
        if (!invNo) continue;
        await wfQuery(
          `INSERT INTO wf.RebateClaimInvoice (ClaimId, DocuNo) VALUES (@cid, @dno)`,
          { cid: { type: sql.Int, value: claim.Id }, dno: { type: sql.NVarChar(50), value: String(invNo).trim() } }
        );
      }
    }

    // 4. Log Tier 1 Submission Approval Record
    await wfQuery(
      `INSERT INTO wf.RebateClaimApproval (ClaimId, Tier, RequiredRole, Decision, DecidedBy, DecidedByName, DecidedAt, Reason)
       VALUES (@cid, 1, 'SALES', 'APPROVED', @uid, @uname, GETUTCDATE(), 'ยื่นใบขออนุมัติเคลียร์รีเบท')`,
      {
        cid:   { type: sql.Int,          value: claim.Id },
        uid:   { type: sql.Int,          value: req.user.sub },
        uname: { type: sql.NVarChar(150),value: await approverName(req.user) }
      }
    );

    // 5. ตัดงบที่จัดสรร (เฉพาะใบที่ผูกกับ pool)
    //
    // การตัด "สิทธิ์เป็นตัน" ไม่ได้อยู่ตรงนี้แล้ว — บันทึกไว้ที่ Source* ของแต่ละบรรทัด
    // และ view wf.v_RebateAccrualRemaining หักให้เองโดยไม่ต้องมีสำเนายอดคงเหลือ
    // ที่เหลือตรงนี้คือการตัด "งบเป็นบาท" ที่ผู้บริหารจัดสรรให้พนักงานขายรายเดือน
    if (pool) {
      let remaining = totalAmt;
      const ledger = (await wfQuery(
        `SELECT * FROM wf.RebateLedger WHERE PoolId=@pid AND RemainingAmt>0 AND ReversedFlag=0 ORDER BY CreatedAt ASC`,
        { pid: { type: sql.Int, value: pool.Id } }
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

      await wfQuery(
        `UPDATE wf.RebatePool SET ClaimedAmt=ClaimedAmt+@amt, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
        { amt: { type: sql.Decimal(12,2), value: totalAmt }, id: { type: sql.Int, value: pool.Id } }
      );
    }

    // เอกสารที่รองรับการขอใช้รีเบท — ผู้อนุมัติต้องเห็นว่าอ้างแผนฉบับใด
    //
    // บรรทัดที่ไม่มีแผนรองรับไม่ถูกบล็อก เพราะแผนบางฉบับยังเป็นกระดาษที่ยังไม่ถูกคีย์เข้าระบบ
    // แต่ต้องแจ้งให้ผู้ยื่นและผู้อนุมัติเห็น ไม่งั้นจะอนุมัติเงินที่ไม่มีเอกสารต้นทางโดยไม่รู้ตัว
    const planIds = [...new Set(parsedLines.map(l => l.planId).filter(Boolean))];
    const plans = planIds.length
      ? (await wfQuery(
          `SELECT PlanId, PlanNo, Title, NetPrice, ValidFrom, ValidTo FROM wf.RebatePlan
           WHERE PlanId IN (${planIds.map(Number).join(',')})`)).recordset || []
      : [];
    const linesWithoutPlan = parsedLines.filter(l => !l.planId).length;

    res.json({
      ...claim,
      periodYear: pYear,
      periodMonth: pMonth,
      plans,
      linesWithoutPlan,
      warnings: linesWithoutPlan
        ? [`${linesWithoutPlan} บรรทัดยังไม่มีแบบขออนุมัติรายการส่งเสริมการขายรองรับ — ผู้อนุมัติควรตรวจเอกสารกระดาษประกอบ`]
        : [],
    });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/rebate/claims/:id/approve — 4-Tier Progression Approval
router.post('/claims/:id/approve', async (req, res) => {
  try {
    const claimId = Number(req.params.id);
    const { docuNo, note } = req.body || {};
    if (!Number.isFinite(claimId)) return res.status(400).json({ message: 'Invalid claim ID' });

    const claimR = await wfQuery(`SELECT * FROM wf.RebateClaim WHERE Id = @id`, { id: { type: sql.Int, value: claimId } });
    const claim = claimR.recordset?.[0];
    if (!claim) return res.status(404).json({ message: `ไม่พบใบขอเคลียร์ ID ${claimId}` });

    if (claim.Status === 'APPROVED' || claim.Status === 'CN_ISSUED') {
      return res.status(400).json({ message: 'ใบขอเคลียร์นี้ได้รับการอนุมัติสมบูรณ์แล้ว' });
    }
    if (claim.Status === 'REJECTED') {
      return res.status(400).json({ message: 'ใบขอเคลียร์นี้ถูกไม่อนุมัติ (REJECTED) กรุณายื่นใหม่' });
    }

    const currentTier = claim.CurrentTier || 2;
    const userRole = req.user.role || '';
    const userId = Number(req.user.sub);
    const userName = await approverName(req.user);

    // Check Segregation of Duties: Don't allow same person to approve consecutive tiers if strict mode
    const prevApproval = (await wfQuery(
      `SELECT TOP 1 DecidedBy FROM wf.RebateClaimApproval WHERE ClaimId = @cid AND Decision = 'APPROVED' ORDER BY Tier DESC`,
      { cid: { type: sql.Int, value: claimId } }
    )).recordset?.[0];

    // เดิมเขียนว่า `... === 'true' || ['ADMIN','C_LEVEL'].includes(userRole)`
    // ซึ่งแปลว่า **ผู้ใช้ C_LEVEL หรือ ADMIN คนเดียวเซ็นครบทั้งสี่ชั้นได้ด้วยตัวเอง**
    // ตอนนั้น C_LEVEL มี 20 บัญชี ใครคนใดคนหนึ่งก็อนุมัติใบทั้งใบได้คนเดียว
    // ซึ่งทำให้การมีสี่ลายเซ็นไม่มีความหมายเลย
    //
    // เหลือทางยกเว้นเดียวคือตัวแปรสภาพแวดล้อม ซึ่งตั้งได้เฉพาะผู้ดูแลเซิร์ฟเวอร์
    // และควรเปิดเฉพาะกรณีฉุกเฉินที่บันทึกเหตุผลไว้แล้วเท่านั้น
    const allowSameUserOverride = process.env.ALLOW_SINGLE_USER_MULTI_TIER_APPROVAL === 'true';
    if (prevApproval && Number(prevApproval.DecidedBy) === userId && !allowSameUserOverride) {
      return res.status(403).json({ message: 'ไม่อนุญาตให้บุคคลเดิมอนุมัติซ้ำสองชั้นติดต่อกัน (Segregation of Duties)' });
    }

    // Tier 2: Regional Manager Approval
    if (currentTier === 2) {
      const regionCode = claim.RegionCode || '99';
      // Check if caller is assigned to region in UserSaleArea or has elevated role
      const isRegionalMgr = (await wfQuery(
        `SELECT 1 FROM wf.UserSaleArea WHERE UserId = @uid AND RegionCode = @rcode`,
        { uid: { type: sql.Int, value: userId }, rcode: { type: sql.VarChar(10), value: regionCode } }
      )).recordset?.length > 0;

      const canApproveTier2 = isRegionalMgr || ['MANAGER', 'APPROVER', 'ADMIN', 'C_LEVEL'].includes(userRole);
      if (!canApproveTier2) {
        return res.status(403).json({ message: `ไม่มีสิทธิ์อนุมัติชั้นที่ 2 (ผู้จัดการภาค ${regionCode})` });
      }

      await wfQuery(`
        INSERT INTO wf.RebateClaimApproval (ClaimId, Tier, RequiredRole, Decision, DecidedBy, DecidedByName, DecidedAt, Reason)
        VALUES (@cid, 2, 'REGIONAL_MGR', 'APPROVED', @uid, @uname, GETUTCDATE(), @note)
      `, {
        cid:   { type: sql.Int,          value: claimId },
        uid:   { type: sql.Int,          value: userId },
        uname: { type: sql.NVarChar(150),value: userName },
        note:  { type: sql.NVarChar(500),value: note || 'อนุมัติชั้นที่ 2 (ผู้จัดการภาค)' }
      });

      await wfQuery(`
        UPDATE wf.RebateClaim SET Status = 'TIER3_PENDING', CurrentTier = 3 WHERE Id = @id
      `, { id: { type: sql.Int, value: claimId } });

      return res.json({ id: claimId, status: 'TIER3_PENDING', currentTier: 3, message: 'อนุมัติชั้นที่ 2 (ผู้จัดการภาค) เรียบร้อย' });
    }

    // Tier 3: Marketing Manager Approval
    if (currentTier === 3) {
      // ชั้นที่ 3 = กรรมการบริหาร (DECISIONS-v1.6.0 ข้อ 2 · ทางเลือก 2ก)
      //
      // เดิมรับ MARKETING/MANAGER/APPROVER ด้วย ซึ่งเป็นชุดคนเดียวกับที่ชั้น 2 รับ
      // ชั้นที่เพิ่มมาจึงไม่ได้เพิ่มการตรวจสอบจริง เพียงเพิ่มจำนวนลายเซ็น
      //
      // ไม่ใช้ MARKETING เพราะบริษัทไม่มีฝ่ายการตลาด — ตรวจ dbo.EMPost ครบทั้ง 10 ตำแหน่ง
      // แล้วไม่มีตำแหน่งใดเกี่ยวกับการตลาดเลย · ฟอร์มกระดาษเขียนว่า "ผู้จัดการฝ่ายตลาด"
      // แต่ผู้ที่เซ็นจริงคือกรรมการบริหาร ซึ่งบริษัทมีสองคนพอดีสำหรับชั้น 3 และ 4
      //
      // ⚠ ต้องใช้คู่กับ migration 082 ที่ลด C_LEVEL จาก 20 บัญชีเหลือกรรมการบริหารสองคน
      //   ถ้าบทบาทยังถูกแจกกว้าง การบีบตรงนี้จะไม่เปลี่ยนอะไรเลย
      const canApproveTier3 = ['ADMIN', 'C_LEVEL'].includes(userRole);
      if (!canApproveTier3) {
        return res.status(403).json({ message: 'ไม่มีสิทธิ์อนุมัติชั้นที่ 3 (กรรมการบริหาร)' });
      }

      await wfQuery(`
        INSERT INTO wf.RebateClaimApproval (ClaimId, Tier, RequiredRole, Decision, DecidedBy, DecidedByName, DecidedAt, Reason)
        VALUES (@cid, 3, 'MARKETING_MGR', 'APPROVED', @uid, @uname, GETUTCDATE(), @note)
      `, {
        cid:   { type: sql.Int,          value: claimId },
        uid:   { type: sql.Int,          value: userId },
        uname: { type: sql.NVarChar(150),value: userName },
        note:  { type: sql.NVarChar(500),value: note || 'อนุมัติชั้นที่ 3 (กรรมการบริหาร)' }
      });

      await wfQuery(`
        UPDATE wf.RebateClaim SET Status = 'TIER4_PENDING', CurrentTier = 4 WHERE Id = @id
      `, { id: { type: sql.Int, value: claimId } });

      return res.json({ id: claimId, status: 'TIER4_PENDING', currentTier: 4, message: 'อนุมัติชั้นที่ 3 (กรรมการบริหาร) เรียบร้อย' });
    }

    // Tier 4: Executive (C_LEVEL / ADMIN) Final Approval
    if (currentTier === 4) {
      const canApproveTier4 = ['C_LEVEL', 'ADMIN', 'ACCOUNTING'].includes(userRole);
      if (!canApproveTier4) {
        return res.status(403).json({ message: 'ไม่มีสิทธิ์อนุมัติชั้นที่ 4 (กรรมการบริหาร / C_LEVEL)' });
      }

      await wfQuery(`
        INSERT INTO wf.RebateClaimApproval (ClaimId, Tier, RequiredRole, Decision, DecidedBy, DecidedByName, DecidedAt, Reason)
        VALUES (@cid, 4, 'EXECUTIVE', 'APPROVED', @uid, @uname, GETUTCDATE(), @note)
      `, {
        cid:   { type: sql.Int,          value: claimId },
        uid:   { type: sql.Int,          value: userId },
        uname: { type: sql.NVarChar(150),value: userName },
        note:  { type: sql.NVarChar(500),value: note || 'อนุมัติชั้นที่ 4 (กรรมการบริหาร)' }
      });

      // เลขที่ใบคืนรีเบทของ WINSpeed (RB<รหัสผู้ขอ><ปี พ.ศ.>-<ลำดับ>)
      //
      // **ไม่บล็อกถ้ายังหาไม่เจอ** — ลำดับงานจริงคืออนุมัติกระดาษก่อน แล้วบัญชีจึงคีย์
      // ใบลดหนี้เข้า WINSpeed ตอนอนุมัติจึงมักยังไม่มีใบนั้น การบังคับจะทำให้อนุมัติไม่ได้เลย
      // แต่ถ้าเจอแล้ว ผูก SOInvID ไว้ทันทีเพื่อให้รายงานกระทบยอดตรวจได้
      const rb = docuNo
        ? (await wfQuery(
            `SELECT TOP 1 SOInvID, DocuDate, NetAmnt FROM dbo.SOInvHD
             WHERE DocuNo = @dn AND Docutype = 106`,
            { dn: { type: sql.NVarChar(25), value: String(docuNo).trim() } })).recordset?.[0]
        : null;

      await wfQuery(`
        UPDATE wf.RebateClaim 
        SET Status = 'APPROVED', 
            ApprovedAt = GETUTCDATE(), 
            ApprovedBy = @uid, 
            CnDocuNo = @cn,
            RbSOInvID = @rbid,
            RbDocDate = @rbdate,
            RbMatchedAt = CASE WHEN @rbid IS NULL THEN NULL ELSE GETUTCDATE() END
        WHERE Id = @id
      `, {
        id:     { type: sql.Int,          value: claimId },
        uid:    { type: sql.Int,          value: userId },
        cn:     { type: sql.NVarChar(20), value: docuNo || null },
        rbid:   { type: sql.Int,          value: rb ? rb.SOInvID : null },
        rbdate: { type: sql.Date,         value: rb ? rb.DocuDate : null }
      });

      const warnings = [];
      if (!docuNo) warnings.push('ยังไม่ได้ระบุเลขที่ใบคืนรีเบท — ต้องกลับมาเติมเมื่อบัญชีออกใบแล้ว');
      else if (!rb) warnings.push(`ยังไม่พบใบ ${docuNo} ใน WINSpeed — จะขึ้นในรายงานกระทบยอดจนกว่าจะออกใบจริง`);
      else if (Math.abs(Number(rb.NetAmnt) - Number(claim.ClaimAmt)) > 0.01) {
        warnings.push(`ยอดไม่ตรง: ใบขอเคลียร์ ฿${Number(claim.ClaimAmt).toFixed(2)} · ใบ ${docuNo} ใน WINSpeed ฿${Number(rb.NetAmnt).toFixed(2)}`);
      }

      return res.json({
        id: claimId, status: 'APPROVED', currentTier: 4,
        message: 'อนุมัติชั้นที่ 4 (กรรมการบริหาร) เสร็จสมบูรณ์',
        rbDocuNo: docuNo || null,
        rbMatched: !!rb,
        warnings,
      });
    }

    res.status(400).json({ message: 'ขั้นตอนอนุมัติไม่ถูกต้อง' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/rebate/claims/:id/reject — ตีกลับ/ไม่อนุมัติใบขออนุมัติ
router.post('/claims/:id/reject', async (req, res) => {
  try {
    const claimId = Number(req.params.id);
    const { reason } = req.body || {};
    if (!Number.isFinite(claimId)) return res.status(400).json({ message: 'Invalid claim ID' });
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: 'กรุณาระบุเหตุผลการไม่อนุมัติ (Reason)' });
    }

    const claimR = await wfQuery(`SELECT * FROM wf.RebateClaim WHERE Id = @id`, { id: { type: sql.Int, value: claimId } });
    const claim = claimR.recordset?.[0];
    if (!claim) return res.status(404).json({ message: `ไม่พบใบขอเคลียร์ ID ${claimId}` });

    const currentTier = claim.CurrentTier || 1;

    // Log Rejection in approval trail
    await wfQuery(`
      INSERT INTO wf.RebateClaimApproval (ClaimId, Tier, RequiredRole, Decision, DecidedBy, DecidedByName, DecidedAt, Reason)
      VALUES (@cid, @tier, @rrole, 'REJECTED', @uid, @uname, GETUTCDATE(), @reason)
    `, {
      cid:    { type: sql.Int,          value: claimId },
      tier:   { type: sql.Int,          value: currentTier },
      rrole:  { type: sql.VarChar(30),  value: req.user.role || 'APPROVER' },
      uid:    { type: sql.Int,          value: req.user.sub },
      uname:  { type: sql.NVarChar(150),value: await approverName(req.user) },
      reason: { type: sql.NVarChar(500),value: String(reason).trim() }
    });

    // Revert status to REJECTED & reset CurrentTier = 1
    await wfQuery(`
      UPDATE wf.RebateClaim SET Status = 'REJECTED', CurrentTier = 1 WHERE Id = @id
    `, { id: { type: sql.Int, value: claimId } });

    res.json({ id: claimId, status: 'REJECTED', message: 'ไม่อนุมัติใบขอเคลียร์และบันทึกประวัติการปฏิเสธเรียบร้อย' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/summary — KPI ภาพรวมต่อพนักงานขาย (wf.RebatePool)
router.get('/summary', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
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
router.patch('/plans/:id', requireRole('MANAGER', 'ADMIN', 'APPROVER', 'C_LEVEL'), async (req, res) => {
  try {
    const planId = Number(req.params.id);
    if (!Number.isFinite(planId)) return res.status(400).json({ message: 'Invalid Plan ID' });

    const existingPlan = (await wfQuery(`SELECT 1 FROM wf.RebatePlan WHERE PlanId = @id`, { id: { type: sql.Int, value: planId } })).recordset?.[0];
    if (!existingPlan) return res.status(404).json({ message: `ไม่พบ Rebate Plan ID ${planId}` });

    const f = req.body || {};
    const sets = [], inputs = { id: { type: sql.Int, value: planId } };
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
    const __r = await wfQuery(`UPDATE wf.RebatePlan SET ${sets.join(', ')} WHERE PlanId=@id`, inputs);
    if (!__r.rowsAffected?.[0]) return res.status(404).json({ message: `ไม่พบ Rebate Plan ID ${planId}` });
    res.json({ id: planId, ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/rebate/plans/:id/allocate — จัดสรรงบ Plan → Pool ของ Sales
router.post('/plans/:id/allocate', requireRole('MANAGER', 'ADMIN', 'APPROVER', 'C_LEVEL'), async (req, res) => {
  try {
    const planId = Number(req.params.id);
    if (!Number.isFinite(planId)) return res.status(400).json({ message: 'Invalid Plan ID' });

    const existingPlan = (await wfQuery(`SELECT 1 FROM wf.RebatePlan WHERE PlanId = @id`, { id: { type: sql.Int, value: planId } })).recordset?.[0];
    if (!existingPlan) return res.status(404).json({ message: `ไม่พบ Rebate Plan ID ${planId}` });

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
    const custId = String(req.params.custId || '').trim();
    if (!custId) return res.status(400).json({ message: 'ต้องระบุรหัสลูกค้า' });
    const kind = String(req.query.lineType || 'REBATE').toUpperCase() === 'DIFF' ? 'DIFF' : 'REBATE';
    const inputs = { cid: { type: sql.NVarChar(20), value: custId } };
    let where = `WHERE CustId = @cid AND ${kind === 'DIFF' ? 'RemainingTonDiff' : 'RemainingTonRebate'} > 0`;
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
    const last = (await wfQuery(`
      SELECT TOP 1 DocuNo FROM dbo.SOInvHD
      WHERE Docutype = 106 AND DocuNo LIKE @p
      ORDER BY DocuNo DESC`,
      { p: { type: sql.NVarChar(25), value: `${prefix}%` } })).recordset?.[0];

    const lastSeq = last ? parseInt(String(last.DocuNo).slice(prefix.length), 10) : 0;
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
router.get('/coupons', async (req, res) => {
  try {
    const { custId, empId } = req.query;
    let where = 'WHERE c.RemaQty > 0';
    const inputs = {};
    if (custId) { where += ` AND hd.CustID = @custId`; inputs.custId = { type: sql.NVarChar(20), value: custId }; }
    if (empId)  { where += ` AND hd.EmpID  = @empId`;  inputs.empId  = { type: sql.Int,          value: Number(empId) }; }

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

// GET /api/rebate/coupons/:custId — คูปองคงค้างของลูกค้ารายนี้ เรียงเก่าก่อน (FIFO)
router.get('/coupons/:custId', async (req, res) => {
  try {
    const custId = String(req.params.custId || '').trim();
    if (!custId) return res.status(400).json({ message: 'Invalid customer ID' });

    const r = await wfQuery(`
        SELECT c.CouponID, c.CouponNo, c.SONo,
               CONVERT(VARCHAR(10), hd.DocuDate, 120) AS DocuDate,
               CAST(hd.CustID AS NVARCHAR(20)) AS CustID,
               ISNULL(cu.CustName, hd.CustName) AS CustName,
               hd.EmpID AS EmpID,
               ISNULL(emp.EmpName, CAST(hd.EmpID AS NVARCHAR(20))) AS EmpName,
               c.GoodID, c.GoodName, c.GoodPrice,
               c.GoodQty, c.RemaQty,
               c.GoodQty - c.RemaQty AS RedeemedQty
        FROM dbo.WFCoupon c
        JOIN dbo.SOHD hd        ON hd.SOID  = c.DocuID
        LEFT JOIN dbo.EMCust cu ON cu.CustID = hd.CustID
        LEFT JOIN dbo.EMEmp emp ON emp.EmpID = hd.EmpID
        WHERE hd.CustID = @cid AND c.RemaQty > 0
        ORDER BY hd.DocuDate ASC, c.CouponNo ASC
      `, { cid: { type: sql.NVarChar(20), value: custId } });
    if (!r.recordset || r.recordset.length === 0) {
      return res.status(404).json({ message: `ไม่พบคูปองคงค้างสำหรับลูกค้า ID ${custId}` });
    }
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = router;
