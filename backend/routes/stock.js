/**
 * stock.js — DG-04 Operational stock source (wf)
 *   แหล่งสต๊อกปฏิบัติการที่อนุมัติแล้ว (ไม่ assume dbo.ICStock)
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { legacyCutoffInput, legacyCutoffSql } = require('../services/legacy-cutoff');

router.use(requireAuth);

const STOCK_UNIT = 'ตัน';

// GET /api/stock/atp — Available To Promise (SO-06)
router.get('/atp', requireRole('SALES', 'COUNTER_SALES', 'WAREHOUSE', 'MANAGER', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { goodCode, warehouseId, requestedQty, excludeTripId, excludeSoId } = req.query;
    const reqQtyNum = requestedQty != null && requestedQty !== '' ? Number(requestedQty) : null;
    const excludeTripNum = excludeTripId != null && excludeTripId !== '' ? Number(excludeTripId) : null;
    // the bill being edited: its own saved draft must not count against itself
    const excludeSoNum = Number.isInteger(Number(excludeSoId)) && Number(excludeSoId) > 0 ? Number(excludeSoId) : null;

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

    const buildMeta = () => ({
      filterGoodCode: goodCode || null,
      filterWarehouseId: warehouseId || null,
      requestedQty: reqQtyNum,
      excludeTripId: excludeTripNum,
      excludeSoId: excludeSoNum,
      freshnessPolicy: {
        days: freshnessDays,
        provenance: freshnessProvenance
      }
    });

    // Nothing entered for these goods: every bill dialog calls this, so do not read the booking tables for nothing.
    const stockRows = stockRes.recordset || [];
    if (stockRows.length === 0) {
      return res.json({ data: [], asOf: new Date().toISOString(), meta: buildMeta() });
    }

    // 3. Open bookings: what WinSpeed still holds open on each 103 line, the backlog report's figure less trucks gone.
    // The query this replaces treated a booking as invoiced when its number equalled an invoice's SONo, but SONo holds
    // the 104's number and the 103 and 104 counters overlap. On 2 Nov 2026 that hid about four fifths of the open tons,
    // on bookings no invoice refers to.
    // Bookings before LEGACY_DOC_CUTOFF_DATE stay out, as everywhere else (owner D9); an open control ticket stays in.
    // A truck the scale has weighed out has left, even when WinSpeed has no 104 yet: about a fifth of the trucks on
    // 2 Nov 2026, and each carried all its booking's open tons, so the booking drops out. The scale writes dbo.WGHD,
    // never ext.WeighOutWeight. A control ticket is drawn by many trucks, so it stays in.
    const confInputs = await legacyCutoffInput();
    let confTripClause = '';
    if (excludeTripNum != null) {
      confTripClause = 'AND (ext.TripId IS NULL OR ext.TripId <> @exTrip)';
      confInputs.exTrip = { type: sql.Int, value: excludeTripNum };
    }

    const confRes = await wfQuery(`
      SELECT RTRIM(g.GoodCode) AS GoodCode, SUM(dt.RemaQty) AS ConfirmedReservedQty
      FROM dbo.SOHD hd WITH (NOLOCK)
      JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
      JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.GoodID
      LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON CAST(hd.SOID AS VARCHAR(50)) = ext.SOID
      WHERE hd.DocuType = 103
        AND ISNULL(hd.DocuStatus, 'N') <> 'C'
        AND ISNULL(hd.ClearSO, 'N') <> 'Y'
        AND ISNULL(hd.ClearFlag, 'N') <> 'Y'
        AND dt.RemaQty > 0
        AND ext.WeighOutWeight IS NULL
        AND (RTRIM(hd.TransRegistration) = N'ตั๋วคุม' OR NOT EXISTS (
          SELECT 1 FROM dbo.WGHD wg WITH (NOLOCK)
          WHERE wg.SPID = hd.SOID AND wg.WGType = 'SO' AND RTRIM(wg.Status) = '3'))
        AND ${legacyCutoffSql('hd')}
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
    if (excludeSoNum != null) {
      draftQuery += ` AND o.Id <> @exSo`;
      draftInputs.exSo = { type: sql.Int, value: excludeSoNum };
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

      // Bookings are held in tons, so only a stock figure in tons can be netted against them
      const validUnit = g.unit === STOCK_UNIT;
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
      meta: buildMeta()
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
    const { goodId, warehouseId, qtyOnHand, unit, source } = req.body || {};
    const code = String(goodId ?? '').trim();
    if (!code) return res.status(400).json({ message: 'goodId จำเป็น' });
    const qty = qtyOnHand === '' || qtyOnHand == null ? NaN : Number(qtyOnHand);
    if (!Number.isFinite(qty) || qty < 0) {
      return res.status(400).json({ message: 'จำนวนคงเหลือต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป' });
    }
    if (unit != null && unit !== STOCK_UNIT) {
      return res.status(400).json({ message: `สต๊อกปฏิบัติการใช้หน่วย${STOCK_UNIT}เท่านั้น` });
    }
    // The badge on the bill screen joins on this code, so a mistyped one would save and then never show
    const good = await wfQuery(
      `SELECT TOP 1 RTRIM(GoodCode) AS GoodCode, GoodName1 AS GoodName FROM dbo.EMGood WITH (NOLOCK) WHERE GoodCode = @g`,
      { g: { type: sql.NVarChar(50), value: code } }
    );
    const master = good.recordset?.[0];
    if (!master) return res.status(400).json({ message: `ไม่พบรหัสสินค้า ${code}` });
    await wfQuery(`
      MERGE wf.OperationalStock AS t
      USING (SELECT @g AS GoodId, @w AS WarehouseId) AS s ON t.GoodId=s.GoodId AND t.WarehouseId=s.WarehouseId
      WHEN MATCHED THEN UPDATE SET GoodName=COALESCE(@n,GoodName), QtyOnHand=@q, Unit=COALESCE(@u,Unit), Source=@src, AsOf=GETUTCDATE(), UpdatedBy=@uid
      WHEN NOT MATCHED THEN INSERT (GoodId, WarehouseId, GoodName, QtyOnHand, Unit, Source, UpdatedBy)
        VALUES (@g, @w, @n, @q, @u, @src, @uid);`,
      {
        g:  { type: sql.NVarChar(20),  value: master.GoodCode },
        w:  { type: sql.NVarChar(20),  value: warehouseId || '-' },
        n:  { type: sql.NVarChar(200), value: master.GoodName || null },
        q:  { type: sql.Decimal(18,2), value: qty },
        u:  { type: sql.NVarChar(20),  value: STOCK_UNIT },
        src:{ type: sql.NVarChar(40),  value: source || 'MANUAL' },
        uid:{ type: sql.Int,           value: req.user.sub },
      });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
