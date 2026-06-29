/**
 * pricebook.js — FR-023 Price Book workflow
 *   DRAFT → APPROVED → ACTIVE → ARCHIVED (มี audit ทุก transition)
 *   governance layer เหนือราคา · ราคาจริงยังอยู่ dbo.EMSetPriceDT (ไม่เขียน dbo จากที่นี่)
 */
const router = require('express').Router();
const { sql, query, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

async function logAudit(bookId, action, fromStatus, toStatus, userId, note) {
  await wfQuery(`INSERT INTO wf.PriceBookAudit (PriceBookId, Action, FromStatus, ToStatus, ByUser, Note)
                VALUES (@b,@a,@f,@t,@u,@n)`, {
    b: { type: sql.Int, value: bookId }, a: { type: sql.NVarChar(40), value: action },
    f: { type: sql.NVarChar(20), value: fromStatus }, t: { type: sql.NVarChar(20), value: toStatus },
    u: { type: sql.Int, value: userId }, n: { type: sql.NVarChar(300), value: note || null },
  });
}

// GET /api/pricebook — รายการ
router.get('/', async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT b.Id, b.Name, b.EffectiveMonth, b.Status, b.Note,
             cu.DisplayName AS CreatedByName, b.CreatedAt,
             au.DisplayName AS ApprovedByName, b.ApprovedAt,
             ac.DisplayName AS ActivatedByName, b.ActivatedAt,
             (SELECT COUNT(*) FROM wf.PriceBookLine l WHERE l.PriceBookId=b.Id) AS LineCount
      FROM wf.PriceBook b
      LEFT JOIN wf.AppUser cu ON cu.Id=b.CreatedBy
      LEFT JOIN wf.AppUser au ON au.Id=b.ApprovedBy
      LEFT JOIN wf.AppUser ac ON ac.Id=b.ActivatedBy
      ORDER BY b.CreatedAt DESC`);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/pricebook/:id — book + lines + audit
router.get('/:id', async (req, res) => {
  try {
    const id = { type: sql.Int, value: Number(req.params.id) };
    const book = (await wfQuery(`SELECT * FROM wf.PriceBook WHERE Id=@id`, { id })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Price Book' });
    const lines = (await wfQuery(`SELECT Id, GoodId, GoodName, Unit, Price FROM wf.PriceBookLine WHERE PriceBookId=@id ORDER BY GoodId`, { id })).recordset;
    const audit = (await wfQuery(`SELECT a.Action, a.FromStatus, a.ToStatus, u.DisplayName AS ByName, a.Note, a.At
                                  FROM wf.PriceBookAudit a LEFT JOIN wf.AppUser u ON u.Id=a.ByUser
                                  WHERE a.PriceBookId=@id ORDER BY a.At DESC`, { id })).recordset;
    res.json({ ...book, lines, audit });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/pricebook — สร้าง DRAFT (+ seedFromCurrent)
router.post('/', requireRole('ACCOUNTING', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { name, effectiveMonth, note, seedFromCurrent } = req.body || {};
    if (!name || !effectiveMonth) return res.status(400).json({ message: 'name และ effectiveMonth (YYYY-MM) จำเป็น' });
    const r = await wfQuery(`INSERT INTO wf.PriceBook (Name, EffectiveMonth, Note, CreatedBy)
                             OUTPUT INSERTED.Id VALUES (@n,@m,@note,@u)`, {
      n: { type: sql.NVarChar(120), value: name }, m: { type: sql.Char(7), value: effectiveMonth },
      note: { type: sql.NVarChar(300), value: note || null }, u: { type: sql.Int, value: req.user.sub },
    });
    const bookId = r.recordset[0].Id;
    await logAudit(bookId, 'CREATE', null, 'DRAFT', req.user.sub, note);

    if (seedFromCurrent) {
      const cur = await query(`
        ;WITH ranked AS (
          SELECT dt.ListID AS GoodID, dt.GoodPriceNet,
                 ROW_NUMBER() OVER (PARTITION BY dt.ListID ORDER BY hd.BeginDate DESC) rn
          FROM dbo.EMSetPriceHD hd WITH (NOLOCK)
          JOIN dbo.EMSetPriceDT dt WITH (NOLOCK) ON dt.SetPriceID=hd.SetPriceID
          WHERE dt.GoodPriceNet>0 AND hd.CustID IS NULL)
        SELECT r.GoodID, g.GoodCode, g.GoodName1 AS GoodName, r.GoodPriceNet AS Price
        FROM ranked r JOIN dbo.EMGood g ON g.GoodID=r.GoodID WHERE r.rn=1`);
      for (const c of cur) {
        await wfQuery(`INSERT INTO wf.PriceBookLine (PriceBookId, GoodId, GoodName, Unit, Price)
                       VALUES (@b,@g,@n,'ตัน',@p)`, {
          b: { type: sql.Int, value: bookId }, g: { type: sql.NVarChar(20), value: String(c.GoodID) },
          n: { type: sql.NVarChar(200), value: c.GoodName }, p: { type: sql.Decimal(18,2), value: c.Price },
        });
      }
      await logAudit(bookId, 'ADD_LINES', 'DRAFT', 'DRAFT', req.user.sub, `seed ${cur.length} รายการจากราคาปัจจุบัน`);
    }
    res.json({ id: bookId });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/pricebook/:id/lines — แทนที่รายการ (เฉพาะ DRAFT)
router.post('/:id/lines', requireRole('ACCOUNTING', 'MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const book = (await wfQuery(`SELECT Status FROM wf.PriceBook WHERE Id=@id`, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Price Book' });
    if (book.Status !== 'DRAFT') return res.status(400).json({ message: 'แก้ไขรายการได้เฉพาะสถานะ DRAFT' });
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    await wfQuery(`DELETE FROM wf.PriceBookLine WHERE PriceBookId=@id`, { id: { type: sql.Int, value: id } });
    for (const l of lines) {
      await wfQuery(`INSERT INTO wf.PriceBookLine (PriceBookId, GoodId, GoodName, Unit, Price) VALUES (@b,@g,@n,@u,@p)`, {
        b: { type: sql.Int, value: id }, g: { type: sql.NVarChar(20), value: String(l.goodId) },
        n: { type: sql.NVarChar(200), value: l.goodName || null }, u: { type: sql.NVarChar(20), value: l.unit || 'ตัน' },
        p: { type: sql.Decimal(18,2), value: Number(l.price) || 0 },
      });
    }
    await logAudit(id, 'ADD_LINES', 'DRAFT', 'DRAFT', req.user.sub, `${lines.length} รายการ`);
    res.json({ ok: true, count: lines.length });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

async function transition(req, res, { from, to, action, col }) {
  try {
    const id = Number(req.params.id);
    const book = (await wfQuery(`SELECT Status FROM wf.PriceBook WHERE Id=@id`, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Price Book' });
    if (book.Status !== from) return res.status(400).json({ message: `ต้องอยู่สถานะ ${from} ก่อน (ปัจจุบัน ${book.Status})` });
    // activate: archive ACTIVE เดิมของเดือนเดียวกัน
    if (to === 'ACTIVE') {
      await wfQuery(`UPDATE wf.PriceBook SET Status='ARCHIVED'
                     WHERE Status='ACTIVE' AND EffectiveMonth=(SELECT EffectiveMonth FROM wf.PriceBook WHERE Id=@id) AND Id<>@id`,
        { id: { type: sql.Int, value: id } });
    }
    const setCol = col ? `, ${col.by}=@u, ${col.at}=GETUTCDATE()` : '';
    await wfQuery(`UPDATE wf.PriceBook SET Status=@s ${setCol} WHERE Id=@id`, {
      s: { type: sql.NVarChar(20), value: to }, u: { type: sql.Int, value: req.user.sub }, id: { type: sql.Int, value: id },
    });
    await logAudit(id, action, from, to, req.user.sub, req.body?.note);
    res.json({ ok: true, status: to });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
}

router.post('/:id/approve',  requireRole('MANAGER', 'ADMIN'), (req, res) => transition(req, res, { from: 'DRAFT', to: 'APPROVED', action: 'APPROVE', col: { by: 'ApprovedBy', at: 'ApprovedAt' } }));
router.post('/:id/activate', requireRole('MANAGER', 'ADMIN'), (req, res) => transition(req, res, { from: 'APPROVED', to: 'ACTIVE', action: 'ACTIVATE', col: { by: 'ActivatedBy', at: 'ActivatedAt' } }));
router.post('/:id/archive',  requireRole('MANAGER', 'ADMIN'), (req, res) => transition(req, res, { from: 'ACTIVE', to: 'ARCHIVED', action: 'ARCHIVE', col: null }));

module.exports = router;
