/**
 * stock.js — DG-04 Operational stock source (wf)
 *   แหล่งสต๊อกปฏิบัติการที่อนุมัติแล้ว (ไม่ assume dbo.ICStock)
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

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
router.put('/', requireRole('WAREHOUSE', 'MANAGER', 'ADMIN'), async (req, res) => {
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
