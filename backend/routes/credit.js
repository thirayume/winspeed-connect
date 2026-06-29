/**
 * credit.js — FR-003 Credit master / credit hold (wf)
 *   จัดการวงเงิน/สถานะ hold ต่อลูกค้า · ตรวจตอน confirm (ใน so.js)
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/credit — รายการลูกค้าที่ตั้ง credit (โดยเฉพาะที่ hold)
router.get('/', async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT c.CustId, c.CustName, c.CreditLimit, c.CreditHold, c.Note, u.DisplayName AS UpdatedByName, c.UpdatedAt
      FROM wf.CreditMaster c LEFT JOIN wf.AppUser u ON u.Id=c.UpdatedBy
      ORDER BY c.CreditHold DESC, c.UpdatedAt DESC`);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/credit/:custId — ดูเครดิตลูกค้ารายเดียว
router.get('/:custId', async (req, res) => {
  try {
    const r = await wfQuery(`SELECT CustId, CustName, CreditLimit, CreditHold, Note FROM wf.CreditMaster WHERE CustId=@c`,
      { c: { type: sql.NVarChar(20), value: String(req.params.custId) } });
    res.json(r.recordset[0] || { CustId: req.params.custId, CreditLimit: null, CreditHold: false });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PUT /api/credit/:custId — ตั้ง/แก้เครดิต (ACCOUNTING/MANAGER/ADMIN)
router.put('/:custId', requireRole('ACCOUNTING', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { custName, creditLimit, creditHold, note } = req.body || {};
    await wfQuery(`
      MERGE wf.CreditMaster AS t USING (SELECT @c AS CustId) AS s ON t.CustId=s.CustId
      WHEN MATCHED THEN UPDATE SET CustName=COALESCE(@n,CustName), CreditLimit=@lim, CreditHold=@hold, Note=@note, UpdatedBy=@u, UpdatedAt=GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (CustId, CustName, CreditLimit, CreditHold, Note, UpdatedBy)
        VALUES (@c,@n,@lim,@hold,@note,@u);`,
      {
        c:    { type: sql.NVarChar(20),  value: String(req.params.custId) },
        n:    { type: sql.NVarChar(200), value: custName || null },
        lim:  { type: sql.Decimal(18,2), value: creditLimit ?? null },
        hold: { type: sql.Bit,           value: creditHold ? 1 : 0 },
        note: { type: sql.NVarChar(300), value: note || null },
        u:    { type: sql.Int,           value: req.user.sub },
      });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
