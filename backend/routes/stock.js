/**
 * stock.js — DG-04 Operational stock source (wf)
 *   แหล่งสต๊อกปฏิบัติการที่อนุมัติแล้ว (ไม่ assume dbo.ICStock)
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/stock/atp — Available To Promise (SO-06)
router.get('/atp', requireRole('SALES', 'COUNTER_SALES', 'WAREHOUSE', 'MANAGER', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { goodCode, warehouseId, requestedQty, excludeTripId } = req.query;
    const reqQtyNum = requestedQty != null && requestedQty !== '' ? Number(requestedQty) : null;
    const excludeTripNum = excludeTripId != null && excludeTripId !== '' ? Number(excludeTripId) : null;

    // 1. Get operational stock rows (GoodId is GoodCode in OperationalStock)
    let stockQuery = `
      SELECT s.GoodId, s.WarehouseId, s.GoodName, s.QtyOnHand, s.Unit, s.Source, s.AsOf
      FROM wf.OperationalStock s
      WHERE 1=1
    `;
    const stockInputs = {};
    if (goodCode) {
      stockQuery += ` AND s.GoodId = @gc`;
      stockInputs.gc = { type: sql.NVarChar(50), value: String(goodCode).trim() };
    }
    if (warehouseId) {
      stockQuery += ` AND s.WarehouseId = @wh`;
      stockInputs.wh = { type: sql.NVarChar(50), value: String(warehouseId).trim() };
    }
    const stockRes = await wfQuery(stockQuery, stockInputs);

    // 2. Query SystemSetting for stock freshness policy
    const settingRes = await wfQuery(`
      SELECT SettingValue FROM wf.SystemSetting WHERE SettingKey = 'STOCK_FRESHNESS_DAYS'
    `);
    const settingVal = settingRes.recordset?.[0]?.SettingValue;
    const freshnessDays = settingVal && Number(settingVal) > 0 ? Number(settingVal) : 7;
    const freshnessProvenance = settingVal ? 'wf.SystemSetting:STOCK_FRESHNESS_DAYS' : 'DEFAULT_POLICY';

    // 3. Active Confirmed SO remaining demand (103 minus fulfilled 104 & invoiced 107/202)
    // - ลบ 60-day cutoff ที่ไม่มี authority ออก
    // - ตัดบิลที่ปิดแล้วด้วย ClearSO = 'Y', ClearFlag = 'Y', WeighOutWeight IS NOT NULL, หรือออก Invoice 107/202 แล้ว
    // - ตัดยอดตามบรรทัดที่ส่งมอบแล้วใน 104 (Fulfilled104)
    // - ตัดบิลในเที่ยวที่ระบุใน excludeTripId (ทั้งแบบ DRAFT และ CONFIRMED)
    const confInputs = {};
    let confTripClause = '';
    if (excludeTripNum != null) {
      confTripClause = 'AND (ext.TripId IS NULL OR ext.TripId <> @exTrip)';
      confInputs.exTrip = { type: sql.Int, value: excludeTripNum };
    }

    const confRes = await wfQuery(`
      WITH Fulfilled104 AS (
        SELECT dt.RefSOID, dt.RefListNo, SUM(dt.GoodQty2) AS ShippedQty
        FROM dbo.SODT dt WITH(NOLOCK)
        JOIN dbo.SOHD hd WITH(NOLOCK) ON hd.SOID = dt.SOID
        WHERE hd.DocuType = 104 AND hd.DocuStatus <> 'C' AND dt.RefSOID IS NOT NULL
        GROUP BY dt.RefSOID, dt.RefListNo
      ),
      InvoicedSO AS (
        SELECT DISTINCT invdt.RefID AS SOID
        FROM dbo.SOInvDT invdt WITH (NOLOCK)
        JOIN dbo.SOInvHD invhd WITH (NOLOCK) ON invhd.SOInvID = invdt.SOInvID
        WHERE invhd.DocuType IN (107, 202) AND invdt.RefID IS NOT NULL
        UNION
        SELECT DISTINCT s.SOID
        FROM dbo.SOInvHD invhd WITH (NOLOCK)
        JOIN dbo.SOHD s WITH (NOLOCK) ON s.DocuNo = invhd.SONo
        WHERE invhd.DocuType IN (107, 202) AND invhd.SONo IS NOT NULL AND invhd.SONo <> ''
      )
      SELECT RTRIM(g.GoodCode) AS GoodCode,
             SUM(CASE 
               WHEN dt.GoodQty2 > ISNULL(f.ShippedQty, 0) THEN dt.GoodQty2 - ISNULL(f.ShippedQty, 0)
               ELSE 0 
             END) AS ConfirmedReservedQty
      FROM dbo.SODT dt WITH(NOLOCK)
      JOIN dbo.EMGood g WITH(NOLOCK) ON g.GoodID = dt.GoodID
      JOIN dbo.SOHD hd WITH(NOLOCK) ON hd.SOID = dt.SOID
      LEFT JOIN Fulfilled104 f ON f.RefSOID = dt.SOID AND f.RefListNo = dt.ListNo
      LEFT JOIN InvoicedSO inv ON inv.SOID = hd.SOID
      LEFT JOIN wf.SalesOrderExt ext WITH(NOLOCK) ON CAST(hd.SOID AS VARCHAR(50)) = ext.SOID
      WHERE hd.DocuType = 103 
        AND hd.DocuStatus <> 'C' 
        AND (hd.ClearSO IS NULL OR hd.ClearSO <> 'Y')
        AND (hd.ClearFlag IS NULL OR hd.ClearFlag <> 'Y')
        AND (ext.WeighOutWeight IS NULL)
        AND inv.SOID IS NULL
        ${confTripClause}
      GROUP BY RTRIM(g.GoodCode)
    `, confInputs);

    // 4. Active Draft SO demand (wf.SalesOrderLine)
    // - Exclude orders in current previewed trip if excludeTripId is provided
    let draftQuery = `
      SELECT l.GoodCode, SUM(l.QtyTon) AS DraftReservedQty
      FROM wf.SalesOrderLine l
      JOIN wf.SalesOrder o ON o.Id = l.SoId
      WHERE o.Status IN ('DRAFT', 'SUBMITTED', 'PRICE_APPROVED')
    `;
    const draftInputs = {};
    if (excludeTripNum != null) {
      draftQuery += ` AND (o.TripId IS NULL OR o.TripId <> @exTrip)`;
      draftInputs.exTrip = { type: sql.Int, value: excludeTripNum };
    }
    draftQuery += ` GROUP BY l.GoodCode`;
    const draftRes = await wfQuery(draftQuery, draftInputs);

    // Map reservations by GoodCode
    const confirmedMap = new Map();
    for (const r of (confRes.recordset || [])) {
      confirmedMap.set(String(r.GoodCode).trim(), Number(r.ConfirmedReservedQty || 0));
    }
    const draftMap = new Map();
    for (const r of (draftRes.recordset || [])) {
      draftMap.set(String(r.GoodCode).trim(), Number(r.DraftReservedQty || 0));
    }

    // Group operational stock by GoodId
    const stockRows = stockRes.recordset || [];
    const goodsMap = new Map();
    for (const s of stockRows) {
      const gCode = String(s.GoodId).trim();
      if (!goodsMap.has(gCode)) {
        goodsMap.set(gCode, {
          goodCode: gCode,
          goodName: s.GoodName,
          unit: s.Unit,
          source: s.Source,
          asOf: s.AsOf,
          warehouses: [],
          totalOnHand: 0
        });
      }
      const g = goodsMap.get(gCode);
      const onHand = Number(s.QtyOnHand || 0);
      g.totalOnHand += onHand;
      g.warehouses.push({
        warehouseId: s.WarehouseId,
        qtyOnHand: onHand,
        unit: s.Unit,
        source: s.Source,
        asOf: s.AsOf
      });
    }

    // Evaluate ATP per GoodCode
    const now = new Date();
    const results = [];

    for (const [gCode, g] of goodsMap.entries()) {
      const confReserved = confirmedMap.get(gCode) || 0;
      const draftReserved = draftMap.get(gCode) || 0;
      const totalCommitted = confReserved + draftReserved;
      const totalAvailable = g.totalOnHand - totalCommitted;

      // Freshness provenance check
      let isStale = false;
      let freshness = 'FRESH';
      if (!g.asOf) {
        isStale = true;
        freshness = 'UNKNOWN';
      } else {
        const asOfDate = new Date(g.asOf);
        const ageHours = (now.getTime() - asOfDate.getTime()) / (1000 * 60 * 60);
        if (isNaN(ageHours) || ageHours < 0 || ageHours > freshnessDays * 24) {
          isStale = true;
          freshness = (isNaN(ageHours) || ageHours < 0) ? 'UNKNOWN' : 'STALE';
        } else {
          freshness = 'FRESH';
        }
      }

      // Unit check: Valid standard units are 'ตัน' and 'ถุง'
      const validUnit = g.unit === 'ตัน' || g.unit === 'ถุง';
      let state = 'UNKNOWN';
      let stateReason = null;

      if (!validUnit) {
        state = 'UNKNOWN';
        freshness = 'UNKNOWN';
        stateReason = `หน่วยสินค้าไม่ชัดเจน (${g.unit || 'ไม่ระบุ'})`;
      } else if (isStale && g.totalOnHand > 0) {
        state = 'UNKNOWN';
        stateReason = (!g.asOf || freshness === 'UNKNOWN')
          ? 'ไม่พบวันที่ระบุความสดใหม่ของข้อมูลสต๊อกหรือเวลาในอนาคต (AsOf INVALID/UNKNOWN)'
          : `ข้อมูลสต๊อกไม่อัปเดต (ข้อมูลเกิน ${freshnessDays} วัน ตาม ${freshnessProvenance})`;
      } else if (reqQtyNum != null && reqQtyNum > 0) {
        if (totalAvailable >= reqQtyNum) {
          state = 'FULLY_READY';
        } else if (totalAvailable > 0) {
          state = 'PARTIALLY_READY';
          stateReason = `ต้องการ ${reqQtyNum} ตัน แต่พร้อมจ่าย ${totalAvailable.toFixed(3)} ตัน (ขาด ${(reqQtyNum - totalAvailable).toFixed(3)} ตัน)`;
        } else {
          state = 'SHORTAGE';
          stateReason = `สต๊อกไม่พอจ่าย (ต้องการ ${reqQtyNum} ตัน ขาดดุล ${Math.abs(totalAvailable).toFixed(3)} ตัน)`;
        }
      } else {
        if (g.totalOnHand === 0) {
          state = 'OUT_OF_STOCK';
          stateReason = 'ไม่มีสินค้าในคลังปฏิบัติการ';
        } else if (totalAvailable > 0) {
          state = 'FULLY_READY';
        } else {
          state = 'SHORTAGE';
          stateReason = `สินค้าถูกจองเต็มแล้ว (พร้อมจ่าย 0 / ยอดจอง ${totalCommitted.toFixed(3)} ตัน)`;
        }
      }

      results.push({
        goodCode: gCode,
        goodName: g.goodName,
        totalOnHand: Number(g.totalOnHand.toFixed(3)),
        confirmedReserved: Number(confReserved.toFixed(3)),
        draftReserved: Number(draftReserved.toFixed(3)),
        unallocatedDemand: Number(totalCommitted.toFixed(3)),
        totalAvailable: Number(totalAvailable.toFixed(3)),
        requestedQty: reqQtyNum,
        shortageQty: (reqQtyNum != null && totalAvailable < reqQtyNum)
          ? Number((reqQtyNum - Math.max(0, totalAvailable)).toFixed(3))
          : (totalAvailable < 0 ? Number(Math.abs(totalAvailable).toFixed(3)) : 0),
        unit: g.unit || 'ตัน',
        source: g.source || 'MANUAL',
        asOf: g.asOf,
        isStale,
        freshness,
        state,
        stateReason,
        policyProvenance: freshnessProvenance,
        freshnessDays,
        warehouses: g.warehouses.map(w => ({
          warehouseId: w.warehouseId,
          qtyOnHand: Number(w.qtyOnHand.toFixed(3)),
          unit: w.unit,
          source: w.source,
          asOf: w.asOf
        }))
      });
    }

    res.json({
      data: results,
      asOf: now.toISOString(),
      meta: {
        filterGoodCode: goodCode || null,
        filterWarehouseId: warehouseId || null,
        requestedQty: reqQtyNum,
        excludeTripId: excludeTripNum,
        freshnessPolicy: {
          days: freshnessDays,
          provenance: freshnessProvenance
        }
      }
    });
  } catch (e) {
    console.error('[stock/atp]', e);
    res.status(500).json({ message: e.message });
  }
});

// GET /api/stock — รายการสต๊อกปฏิบัติการ
router.get('/', async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT s.GoodId, s.WarehouseId, s.GoodName, s.QtyOnHand, s.Unit, s.Source, s.AsOf, u.DisplayName AS UpdatedByName
      FROM wf.OperationalStock s LEFT JOIN wf.AppUser u ON u.Id=s.UpdatedBy
      ORDER BY s.GoodId, s.WarehouseId`);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PUT /api/stock — upsert (WAREHOUSE/MANAGER/ADMIN)
router.put('/', requireRole('WAREHOUSE', 'MANAGER', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { goodId, warehouseId, goodName, qtyOnHand, unit, source } = req.body || {};
    if (!goodId) return res.status(400).json({ message: 'goodId จำเป็น' });
    await wfQuery(`
      MERGE wf.OperationalStock AS t
      USING (SELECT @g AS GoodId, @w AS WarehouseId) AS s ON t.GoodId=s.GoodId AND t.WarehouseId=s.WarehouseId
      WHEN MATCHED THEN UPDATE SET GoodName=COALESCE(@n,GoodName), QtyOnHand=@q, Unit=COALESCE(@u,Unit), Source=@src, AsOf=GETUTCDATE(), UpdatedBy=@uid
      WHEN NOT MATCHED THEN INSERT (GoodId, WarehouseId, GoodName, QtyOnHand, Unit, Source, UpdatedBy)
        VALUES (@g, @w, @n, @q, @u, @src, @uid);`,
      {
        g:  { type: sql.NVarChar(20),  value: String(goodId) },
        w:  { type: sql.NVarChar(20),  value: warehouseId || '-' },
        n:  { type: sql.NVarChar(200), value: goodName || null },
        q:  { type: sql.Decimal(18,2), value: Number(qtyOnHand) || 0 },
        u:  { type: sql.NVarChar(20),  value: unit || 'ตัน' },
        src:{ type: sql.NVarChar(40),  value: source || 'MANUAL' },
        uid:{ type: sql.Int,           value: req.user.sub },
      });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
