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
// EMP-00036 ถูกผูกกับภาคใต้ทั้งที่ยอดขายอยู่ภาคอีสาน และไม่มีทางแก้จากหน้าจอเลย
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
    const { poolId, claimAmt, custId, note, lines, invoices } = req.body;
    if (!poolId || (!claimAmt && (!lines || !lines.length))) {
      return res.status(400).json({ message: 'poolId และ claimAmt (หรือรายการย่อย lines) จำเป็น' });
    }

    const pool = (await wfQuery(`SELECT * FROM wf.RebatePool WHERE Id=@id`, { id: { type: sql.Int, value: poolId } })).recordset?.[0];
    if (!pool) return res.status(404).json({ message: 'ไม่พบ pool' });
    if (!canViewAllRebateAmounts(req.user) && Number(pool.SalesUserId) !== Number(req.user.sub)) {
      return res.status(403).json({ message: 'ไม่มีสิทธิ์เคลม pool ของพนักงานขายอื่น' });
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
      let calculatedSum = 0;
      lines.forEach((l, idx) => {
        const qtyTon = Number(l.qtyTon || 0);
        const pricePerTon = Number(l.pricePerTon || 0);
        const netPricePerTon = Number(l.netPricePerTon || 0);
        const rebatePerTon = pricePerTon - netPricePerTon;
        const lineAmount = Math.round(qtyTon * rebatePerTon * 100) / 100;
        calculatedSum += lineAmount;

        // ใบขอเคลียร์มีสองตาราง: คืนรีเบท (เทียบราคาสุทธิโปรโมชั่น) และ
        // คืนส่วนต่าง (เทียบราคาขายใน Pricelist) — รูปคำนวณเดียวกัน ต่างที่ราคาที่ใช้เทียบ
        const lineType = String(l.lineType || 'REBATE').toUpperCase() === 'DIFF' ? 'DIFF' : 'REBATE';
        parsedLines.push({
          lineNo: idx + 1,
          lineType,
          invoiceNo: l.invoiceNo ? String(l.invoiceNo).trim().slice(0, 50) : null,
          goodCode: String(l.goodCode || 'GENERAL').trim(),
          goodName: l.goodName ? String(l.goodName).trim() : null,
          qtyTon,
          pricePerTon,
          netPricePerTon,
          rebatePerTon,
          planId: l.planId ? Number(l.planId) : null,
          remark: l.remark ? String(l.remark).trim() : null
        });
      });
      totalAmt = Math.round(calculatedSum * 100) / 100;
    }

    const available = Number(pool.AccruedAmt) - Number(pool.ClaimedAmt);
    if (totalAmt > available) {
      return res.status(400).json({ message: `ยอดเกิน: ขอ ฿${totalAmt.toFixed(2)} ใช้ได้ ฿${available.toFixed(2)}` });
    }

    // R6-05 — กระทบยอดกับการขนจริงก่อนรับใบขอเคลียร์
    //
    // เอกสารฉบับที่ 5 (รายงานการขนสินค้า) ใช้ยืนยันว่าลูกค้าขนครบตามที่ขอเคลียร์จริง
    // ในระบบเรา "ยอดขนจริง" คือ QtyTon ใน wf.RebateLedger ซึ่งตั้งตอนชั่งออกเท่านั้น
    //
    // เจตนา: บล็อกและให้คนแก้ ไม่ตัดยอดให้อัตโนมัติ — การตัดเงียบ ๆ จะทำให้ผู้แทนขาย
    // ไม่รู้ว่าถูกหักอะไรไป และตรวจย้อนกลับตอน ISO ไม่ได้ว่าหักด้วยเหตุใด
    if (parsedLines.length) {
      // ยอดขนจริงต้องมาจาก dbo (WINSpeed) ไม่ใช่ wf.RebateLedger
      //
      // ledger ตั้งตอนชั่งออก "ผ่านแอปเรา" เท่านั้น ใบที่ยืนยันและส่งของนอกแอป
      // จะไม่มี ledger เลย การกระทบยอดจึงมองไม่เห็นของที่ขนไปแล้วจริง ๆ
      // เอกสารฉบับที่ 5 (รายงานการขนสินค้า) ที่ฝ่ายบัญชีใช้ตรวจ ก็อ่านจาก dbo
      //
      // นิยาม "ขนจริงแล้ว" = มีเอกสาร DocuType 104 (ใบส่งของ/ใบกำกับ) ออกแล้ว
      //
      // WINSpeed เก็บใบสั่งขายเป็น DocuType 103 และใบส่งของ/ใบกำกับเป็น 104
      // โดยใช้ DocuNo เดียวกัน ส่วน RefNo ของใบ 104 คือเลขใบกำกับภาษี (AI69-xxxxx)
      // ปริมาณที่ส่งจริงจึงอ่านจาก SODT ของเอกสาร 104 ไม่ใช่ของใบสั่งขาย
      // เพราะใบสั่งขายคือ "สั่งเท่าไร" ส่วนใบ 104 คือ "ส่งจริงเท่าไร" ซึ่งอาจไม่เท่ากัน
      //
      // เดิมใช้ h.clearflag='Y' ซึ่งผิด — วัดจากฐานจริงเมื่อ 6 ส.ค. 2569:
      // ทั้งฐานมี 2,065,989 ตัน · เอกสาร 104 ครอบคลุม 2,037,465 ตัน (61,319 ใบ)
      // แต่ clearflag='Y' มีเพียง 337 ตัน (24 ใบ ซึ่งเป็นใบทดสอบที่แอปเราตั้งค่าเองทั้งหมด)
      // การกระทบยอดจึงเทียบกับ 0.016% ของความจริง และบล็อกการยื่นเคลมเกือบทุกใบ
      //
      // ไม่ใช้ DocuStatus='Y' เพราะเป็นธงสถานะที่เลื่อนได้ และ migration 072 ตั้งเป็น 'Y'
      // ตั้งแต่ตอนสร้างใบก่อนส่งของ · เอกสาร 104 เป็นหลักฐานที่มีอยู่จริงหรือไม่มี
      // ซึ่งเป็นสิ่งที่ผู้ตรวจยอมรับได้
      const delivered = custId
        ? (await wfQuery(`
            SELECT g.GoodCode, SUM(d.GoodQty2) AS DeliveredTon
            FROM dbo.SOHD h
            JOIN dbo.SODT d ON d.SOID = h.SOID
            JOIN dbo.EMGood g ON g.GoodID = d.GoodID
            WHERE h.CustID = @cust AND h.DocuType = 104 AND d.GoodQty2 > 0
            GROUP BY g.GoodCode`,
            { cust: { type: sql.NVarChar(20), value: String(custId) } })).recordset || []
        // ไม่ระบุลูกค้าก็เทียบกับ ledger ของ pool ไปก่อน ดีกว่าไม่ตรวจอะไรเลย
        : (await wfQuery(`
            SELECT GoodCode, SUM(QtyTon) AS DeliveredTon
            FROM wf.RebateLedger
            WHERE PoolId = @pid AND ISNULL(ReversedFlag, 0) = 0
            GROUP BY GoodCode`,
            { pid: { type: sql.Int, value: poolId } })).recordset || [];

      const claimedBefore = (await wfQuery(`
        SELECT l.GoodCode, l.LineType, SUM(l.QtyTon) AS ClaimedTon
        FROM wf.RebateClaimLine l
        JOIN wf.RebateClaim c ON c.Id = l.ClaimId
        WHERE c.PoolId = @pid AND c.Status <> 'REJECTED'
        GROUP BY l.GoodCode, l.LineType`,
        { pid: { type: sql.Int, value: poolId } })).recordset || [];

      const shippedTon = (code) =>
        Number(delivered.find(r => String(r.GoodCode) === String(code))?.DeliveredTon || 0);
      // โควตาแยกตามชนิด เพราะตันชุดเดียวกันขอได้ทั้งคืนรีเบทและคืนส่วนต่าง
      const usedTon = (code, kind) =>
        Number(claimedBefore.find(r => String(r.GoodCode) === String(code) && r.LineType === kind)?.ClaimedTon || 0)
        + parsedLines.filter(p => p.goodCode === code && p.lineType === kind && p.lineNo < 0).reduce((a, b) => a + b.qtyTon, 0);

      const problems = [];
      for (const line of parsedLines) {
        const shipped = shippedTon(line.goodCode);
        const used = usedTon(line.goodCode, line.lineType);
        const remain = Math.round((shipped - used) * 1000) / 1000;
        if (line.qtyTon > remain + 0.001) {
          const kindLabel = line.lineType === 'DIFF' ? 'คืนส่วนต่าง' : 'คืนรีเบท';
          problems.push(`${line.goodCode} (${kindLabel}): ขอเคลียร์ ${line.qtyTon} ตัน แต่ขนจริงคงเหลือ ${remain} ตัน`
            + (shipped ? ` (ขนจริง ${shipped} ตัน · เคลียร์ไปแล้ว ${used} ตัน)` : ' (ไม่พบการขนจริงของสูตรนี้)'));
        }
      }
      if (problems.length) {
        return res.status(400).json({
          message: 'ยอดขอเคลียร์ไม่ตรงกับยอดขนจริง',
          source: custId ? 'WINSpeed (ใบที่ปิดการขนแล้วของลูกค้ารายนี้)' : 'ยอดรีเบทค้างรับในระบบ',
          reconciliation: problems,
        });
      }
    }

    // Infer RegionCode from Customer
    const regionCode = await getCustomerRegion(custId);

    // 1. Create RebateClaim Header
    const claimR = await wfQuery(
      `INSERT INTO wf.RebateClaim (PoolId, SalesUserId, CustId, ClaimAmt, RemainingAmt, Status, Note, RegionCode, CurrentTier)
       OUTPUT inserted.*
       VALUES (@pid, @uid, @cid, @amt, @amt, 'TIER2_PENDING', @note, @rcode, 2)`,
      {
        pid:   { type: sql.Int,          value: poolId },
        uid:   { type: sql.Int,          value: req.user.sub },
        cid:   { type: sql.NVarChar(20), value: custId || null },
        amt:   { type: sql.Decimal(12,2),value: totalAmt },
        note:  { type: sql.NVarChar(500),value: note || null },
        rcode: { type: sql.VarChar(10),  value: regionCode }
      }
    );
    const claim = claimR.recordset[0];

    // 2. Create RebateClaimLine records
    for (const line of parsedLines) {
      await wfQuery(
        `INSERT INTO wf.RebateClaimLine (ClaimId, [LineNo], LineType, InvoiceNo, GoodCode, GoodName, QtyTon, PricePerTon, NetPricePerTon, RebatePerTon, PlanId, Remark)
         VALUES (@cid, @lno, @ltype, @inv, @gcode, @gname, @qty, @price, @netPrice, @rebate, @planId, @remark)`,
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
          remark:   { type: sql.NVarChar(500), value: line.remark }
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

    // 5. FIFO Cut on Ledger
    let remaining = totalAmt;
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

    // 6. Update Pool ClaimedAmt
    await wfQuery(
      `UPDATE wf.RebatePool SET ClaimedAmt=ClaimedAmt+@amt, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
      { amt: { type: sql.Decimal(12,2), value: totalAmt }, id: { type: sql.Int, value: poolId } }
    );

    res.json(claim);
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

    const allowSameUserOverride = process.env.ALLOW_SINGLE_USER_MULTI_TIER_APPROVAL === 'true' || ['ADMIN', 'C_LEVEL'].includes(userRole);
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
      const canApproveTier3 = ['MARKETING', 'MANAGER', 'APPROVER', 'ADMIN', 'C_LEVEL'].includes(userRole);
      if (!canApproveTier3) {
        return res.status(403).json({ message: 'ไม่มีสิทธิ์อนุมัติชั้นที่ 3 (ผู้จัดการฝ่ายตลาด)' });
      }

      await wfQuery(`
        INSERT INTO wf.RebateClaimApproval (ClaimId, Tier, RequiredRole, Decision, DecidedBy, DecidedByName, DecidedAt, Reason)
        VALUES (@cid, 3, 'MARKETING_MGR', 'APPROVED', @uid, @uname, GETUTCDATE(), @note)
      `, {
        cid:   { type: sql.Int,          value: claimId },
        uid:   { type: sql.Int,          value: userId },
        uname: { type: sql.NVarChar(150),value: userName },
        note:  { type: sql.NVarChar(500),value: note || 'อนุมัติชั้นที่ 3 (ผู้จัดการฝ่ายตลาด)' }
      });

      await wfQuery(`
        UPDATE wf.RebateClaim SET Status = 'TIER4_PENDING', CurrentTier = 4 WHERE Id = @id
      `, { id: { type: sql.Int, value: claimId } });

      return res.json({ id: claimId, status: 'TIER4_PENDING', currentTier: 4, message: 'อนุมัติชั้นที่ 3 (ผู้จัดการฝ่ายตลาด) เรียบร้อย' });
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

      await wfQuery(`
        UPDATE wf.RebateClaim 
        SET Status = 'APPROVED', 
            ApprovedAt = GETUTCDATE(), 
            ApprovedBy = @uid, 
            CnDocuNo = @cn
        WHERE Id = @id
      `, {
        id:  { type: sql.Int,          value: claimId },
        uid: { type: sql.Int,          value: userId },
        cn:  { type: sql.NVarChar(20), value: docuNo || null }
      });

      return res.json({ id: claimId, status: 'APPROVED', currentTier: 4, message: 'อนุมัติชั้นที่ 4 (กรรมการบริหาร) เสร็จสมบูรณ์' });
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

// ── Legacy Data Migration (Tons to Baht) ───────────────────────────────────
router.post('/migrate-legacy', requireRole('ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const { rate } = req.body;
    if (!rate || isNaN(Number(rate)) || Number(rate) <= 0) {
      return res.status(400).json({ message: 'กรุณาระบุอัตราการแปลง (rate) เช่น 100 บาท/ตัน' });
    }
    const conversionRate = Number(rate);

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

    const legacyPlan = await wfQuery(`SELECT PlanId FROM wf.RebatePlan WHERE PlanNo = 'LEGACY-WS-COUPON'`);
    if (!legacyPlan.recordset || legacyPlan.recordset.length === 0) {
      return res.status(500).json({ message: 'ไม่พบแผน RebatePlan (LEGACY-WS-COUPON) กรุณารัน Migration 075' });
    }
    const legacyPlanId = legacyPlan.recordset[0].PlanId;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    let processed = 0;
    let totalInjectedBaht = 0;
    const errors = [];

    for (const row of legacyBalances) {
      if (!row.EmpID) continue;
      
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

      let pool = (await wfQuery(`SELECT * FROM wf.RebatePool WHERE SalesUserId=@u AND PeriodYear=@y AND PeriodMonth=@m`,
        { u: { type: sql.Int, value: salesUserId }, y: { type: sql.Int, value: currentYear }, m: { type: sql.Int, value: currentMonth } })).recordset?.[0];
      
      if (!pool) {
        pool = (await wfQuery(`INSERT INTO wf.RebatePool (SalesUserId, PeriodYear, PeriodMonth, AllocatedAmt) OUTPUT inserted.* VALUES (@u,@y,@m,0)`,
          { u: { type: sql.Int, value: salesUserId }, y: { type: sql.Int, value: currentYear }, m: { type: sql.Int, value: currentMonth } })).recordset[0];
      }

      await wfQuery(`UPDATE wf.RebatePool SET AllocatedAmt = AllocatedAmt + @amt, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
        { amt: { type: sql.Decimal(14,2), value: bahtAmount }, id: { type: sql.Int, value: pool.Id } });

      await wfQuery(`INSERT INTO wf.RebateLedger (PlanId, Region, PoolId, SoId, CustId, GoodId, GoodCode, QtyTon, PricePerTon, NetPricePerTon, RebatePerTon, RebateAmount, RemainingAmt, Status)
        VALUES (@planId, 'ALL', @pid, NULL, 'LEGACY', '0', 'LEGACY_MIGRATION', @tons, 0, 0, @rate, @baht, @baht, 'ACCRUED')`,
        {
          planId: { type: sql.Int, value: legacyPlanId },
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

// POST /api/rebate/sync-mirror — ดึงข้อมูลคูปองจาก dbo สู่ wf.CouponMirror
router.post('/sync-mirror', requireRole('ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const r = await wfQuery(`
      MERGE wf.CouponMirror AS tgt
      USING (
        SELECT c.CouponID, c.CouponNo, c.DocuID AS SourceSOID, src.DocuNo AS SourceDocuNo,
               src.CustID, src.EmpID AS SalesEmpId, c.GoodID,
               c.GoodQty AS IssuedTon, c.RemaQty AS RemainingTon, c.GoodPrice
        FROM dbo.WFCoupon c WITH (NOLOCK)
        JOIN dbo.SOHD src   WITH (NOLOCK) ON src.SOID = c.DocuID
      ) AS s ON tgt.CouponID = s.CouponID
      WHEN MATCHED AND (tgt.RemainingTon <> s.RemainingTon) THEN
        UPDATE SET tgt.RemainingTon = s.RemainingTon, tgt.LastSyncAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (CouponID, CouponNo, SourceSOID, SourceDocuNo, CustId, SalesEmpId, GoodId, IssuedTon, RemainingTon, GoodPrice)
        VALUES (s.CouponID, s.CouponNo, s.SourceSOID, s.SourceDocuNo, s.CustID, s.SalesEmpId, s.GoodID, s.IssuedTon, s.RemainingTon, s.GoodPrice);
    `);
    res.json({ message: 'Sync WFCoupon to CouponMirror completed.', rowsAffected: r.rowsAffected });
  } catch (e) {
    console.error('[rebate-sync]', e.message);
    res.status(500).json({ message: e.message });
  }
});

// GET /api/rebate/coupons — รายลูกค้า สรุปยอดคูปองคงค้าง (ใช้ wf.CouponMirror)
router.get('/coupons', async (req, res) => {
  try {
    const { custId, empId } = req.query;
    let where = 'WHERE c.RemainingTon > 0';
    const inputs = {};
    if (custId) { where += ` AND c.CustID = @custId`; inputs.custId = { type: sql.NVarChar(20), value: custId }; }
    if (empId)  { where += ` AND c.SalesEmpId = @empId`;  inputs.empId  = { type: sql.Int,          value: Number(empId) }; }

    const r = await wfQuery(`
      SELECT c.CustID, ISNULL(MAX(hd.CustName), c.CustID) AS CustName,
             c.SalesEmpId AS EmpID,
             ISNULL(MAX(emp.EmpName), CAST(c.SalesEmpId AS NVARCHAR(20))) AS EmpName,
             COUNT(c.CouponID)   AS CouponCount,
             SUM(c.RemainingTon) AS OutstandingTon,
             MIN(hd.DocuDate)    AS OldestDate
      FROM wf.CouponMirror c
      LEFT JOIN dbo.SOHD hd ON hd.SOID = c.SourceSOID
      LEFT JOIN dbo.EMEmp emp ON emp.EmpID = c.SalesEmpId
      ${where}
      GROUP BY c.CustID, c.SalesEmpId
      ORDER BY OutstandingTon DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/rebate/coupons/:custId — รายการคูปองของลูกค้า (ใช้ wf.CouponMirror)
router.get('/coupons/:custId', async (req, res) => {
  try {
    const custId = String(req.params.custId || '').trim();
    if (!custId) return res.status(400).json({ message: 'Invalid customer ID' });

    const r = await wfQuery(`
        SELECT c.CouponID, c.CouponNo, c.SourceDocuNo AS SONo,
               CONVERT(VARCHAR(10), hd.DocuDate, 120) AS DocuDate,
               c.CustID, hd.CustName,
               c.SalesEmpId AS EmpID,
               ISNULL(emp.EmpName, CAST(c.SalesEmpId AS NVARCHAR(20))) AS EmpName,
               c.GoodID, hd_dt.GoodName,
               c.IssuedTon AS GoodQty,
               c.RemainingTon AS RemaQty,
               c.IssuedTon - c.RemainingTon AS RedeemedQty
        FROM wf.CouponMirror c
        LEFT JOIN dbo.SOHD hd ON hd.SOID = c.SourceSOID
        LEFT JOIN dbo.SODT hd_dt ON hd_dt.SOID = c.SourceSOID AND hd_dt.GoodID = c.GoodId
        LEFT JOIN dbo.EMEmp emp ON emp.EmpID = c.SalesEmpId
        WHERE c.CustID = @cid AND c.RemainingTon > 0
        ORDER BY hd.DocuDate ASC
      `, { cid: { type: sql.NVarChar(20), value: custId } });
    if (!r.recordset || r.recordset.length === 0) {
      return res.status(404).json({ message: `ไม่พบคูปองคงค้างสำหรับลูกค้า ID ${custId}` });
    }
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = router;
