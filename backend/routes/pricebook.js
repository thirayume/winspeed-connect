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
      SELECT b.Id, b.Name, b.EffectiveMonth, b.EffectiveFrom, b.EffectiveTo, b.Status, b.Note,
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

// GET /api/pricebook/winspeed-sets — รายการประกาศราคาจาก WinSpeed (dbo.EMSetPriceHD)
router.get('/winspeed-sets', async (req, res) => {
  try {
    const rows = await query(`
      SELECT hd.SetPriceID, hd.DocuNo, hd.DocuDate, hd.BeginDate, hd.EndDate, hd.CustID,
             c.CustName, hd.Remark1,
             COUNT(dt.ListID) AS LineCount,
             CASE WHEN GETDATE() >= hd.BeginDate AND GETDATE() <= DATEADD(day, 1, hd.EndDate) THEN 1 ELSE 0 END AS IsActivePeriod
      FROM dbo.EMSetPriceHD hd WITH (NOLOCK)
      LEFT JOIN dbo.EMCust c WITH (NOLOCK) ON c.CustID = hd.CustID
      LEFT JOIN dbo.EMSetPriceDT dt WITH (NOLOCK) ON dt.SetPriceID = hd.SetPriceID
      GROUP BY hd.SetPriceID, hd.DocuNo, hd.DocuDate, hd.BeginDate, hd.EndDate, hd.CustID, c.CustName, hd.Remark1
      ORDER BY hd.BeginDate DESC, hd.SetPriceID DESC
    `);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/pricebook/winspeed-sets/:id/lines — รายการสินค้าและราคาของชุด WinSpeed
router.get('/winspeed-sets/:id/lines', async (req, res) => {
  try {
    const spid = Number(req.params.id);
    const rows = await query(`
      SELECT dt.SetPriceID, dt.ListNo, dt.ListID AS GoodID, g.GoodCode, g.GoodName1 AS GoodName,
             gg.GoodGroupName, ISNULL(u.GoodUnitName, N'ตัน') AS Unit, dt.GoodPriceNet AS Price, dt.Remark
      FROM dbo.EMSetPriceDT dt WITH (NOLOCK)
      JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.ListID
      LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = g.GoodGroupID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = dt.GoodUnitID
      WHERE dt.SetPriceID = @spid
        AND ISNULL(g.Inactive, 'A') = 'A'
      ORDER BY g.GoodCode
    `, { spid: { type: sql.Int, value: spid } });
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/pricebook/sync-from-winspeed — ซิงค์/นำเข้าตารางราคาจาก WinSpeed เข้าสู่ wf.PriceBook
router.post('/sync-from-winspeed', requireRole('ACCOUNTING', 'MANAGER', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { setPriceIds, name, status, effectiveFrom, effectiveTo, note } = req.body || {};
    
    // 1. หา sets ที่จะนำเข้า
    let targetSetIds = Array.isArray(setPriceIds) && setPriceIds.length > 0
      ? setPriceIds.map(Number).filter(Boolean)
      : [];

    if (targetSetIds.length === 0) {
      // ค้นหาชุดราคาประกาศทั่วไปที่ active ในปัจจุบัน (CustID IS NULL)
      const activeSets = await query(`
        SELECT SetPriceID, DocuNo, BeginDate, EndDate
        FROM dbo.EMSetPriceHD WITH (NOLOCK)
        WHERE CustID IS NULL AND GETDATE() >= BeginDate AND GETDATE() <= DATEADD(day, 1, EndDate)
      `);
      targetSetIds = activeSets.map(s => Number(s.SetPriceID));
      if (targetSetIds.length === 0) {
        // ถ้าไม่มี active วันนี้ เอา 2 ชุดล่าสุด
        const latestSets = await query(`
          SELECT TOP 2 SetPriceID, DocuNo, BeginDate, EndDate
          FROM dbo.EMSetPriceHD WITH (NOLOCK)
          WHERE CustID IS NULL
          ORDER BY BeginDate DESC, SetPriceID DESC
        `);
        targetSetIds = latestSets.map(s => Number(s.SetPriceID));
      }
    }

    if (targetSetIds.length === 0) {
      return res.status(400).json({ message: 'ไม่พบชุดราคา WinSpeed ที่ต้องการซิงค์' });
    }

    // 2. ดึงข้อมูล header ของ sets เหล่านี้
    const setHeaders = await query(`
      SELECT SetPriceID, DocuNo, BeginDate, EndDate
      FROM dbo.EMSetPriceHD WITH (NOLOCK)
      WHERE SetPriceID IN (${targetSetIds.join(',')})
      ORDER BY BeginDate DESC
    `);
    const docNos = setHeaders.map(h => h.DocuNo).join(', ');
    const minBegin = effectiveFrom || (setHeaders[0]?.BeginDate ? new Date(setHeaders[0].BeginDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
    const maxEnd = effectiveTo || (setHeaders[0]?.EndDate ? new Date(setHeaders[0].EndDate).toISOString().slice(0, 10) : null);
    const effMonth = minBegin.slice(0, 7);

    const bookName = name || `ตารางราคา WinSpeed (${docNos}) ประจำวันที่ ${minBegin}${maxEnd ? ' ถึง ' + maxEnd : ''}`;
    const initialStatus = status === 'DRAFT' ? 'DRAFT' : 'ACTIVE';

    // 3. ดึงรายการสินค้าและราคาจาก dbo.EMSetPriceDT
    const items = await query(`
      ;WITH ranked AS (
        SELECT dt.ListID AS GoodID, dt.GoodPriceNet, dt.GoodUnitID, dt.Remark,
               ROW_NUMBER() OVER (PARTITION BY dt.ListID ORDER BY hd.BeginDate DESC, dt.SetPriceID DESC) rn
        FROM dbo.EMSetPriceHD hd WITH (NOLOCK)
        JOIN dbo.EMSetPriceDT dt WITH (NOLOCK) ON dt.SetPriceID = hd.SetPriceID
        WHERE hd.SetPriceID IN (${targetSetIds.join(',')}) AND dt.GoodPriceNet > 0
      )
      SELECT r.GoodID, g.GoodCode, g.GoodName1 AS GoodName, ISNULL(u.GoodUnitName, N'ตัน') AS Unit,
             r.GoodPriceNet AS Price, r.Remark
      FROM ranked r
      JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = r.GoodID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = COALESCE(r.GoodUnitID, g.SaleGoodUnitID, g.MainGoodUnitID)
      WHERE r.rn = 1
        AND ISNULL(g.Inactive, 'A') = 'A'
      ORDER BY g.GoodCode
    `);

    if (items.length === 0) {
      return res.status(400).json({ message: 'ชุดราคาที่เลือกไม่มีรายการสินค้าที่มีราคา' });
    }

    // 4. สร้าง PriceBook
    const r = await wfQuery(`
      INSERT INTO wf.PriceBook (Name, EffectiveMonth, EffectiveFrom, EffectiveTo, Status, Note, CreatedBy, ApprovedBy, ApprovedAt, ActivatedBy, ActivatedAt)
      OUTPUT INSERTED.Id VALUES (@n, @m, @ef, @et, @s, @note, @u, @appBy, @appAt, @actBy, @actAt)
    `, {
      n: { type: sql.NVarChar(120), value: bookName },
      m: { type: sql.Char(7), value: effMonth },
      ef: { type: sql.Date, value: minBegin ? new Date(minBegin) : null },
      et: { type: sql.Date, value: maxEnd ? new Date(maxEnd) : null },
      s: { type: sql.NVarChar(20), value: initialStatus },
      note: { type: sql.NVarChar(300), value: note || `ซิงค์จาก WinSpeed: ${docNos}` },
      u: { type: sql.Int, value: req.user.sub },
      appBy: { type: sql.Int, value: initialStatus === 'ACTIVE' ? req.user.sub : null },
      appAt: { type: sql.DateTime, value: initialStatus === 'ACTIVE' ? new Date() : null },
      actBy: { type: sql.Int, value: initialStatus === 'ACTIVE' ? req.user.sub : null },
      actAt: { type: sql.DateTime, value: initialStatus === 'ACTIVE' ? new Date() : null },
    });
    const bookId = r.recordset[0].Id;

    // 5. ถ้า ACTIVE ให้ Archive เล่ม ACTIVE เดิมของเดือนเดียวกัน
    if (initialStatus === 'ACTIVE') {
      await wfQuery(`
        UPDATE wf.PriceBook SET Status='ARCHIVED'
        WHERE Status='ACTIVE' AND EffectiveMonth=@m AND Id<>@id
      `, { m: { type: sql.Char(7), value: effMonth }, id: { type: sql.Int, value: bookId } });
    }

    // 6. เพิ่ม wf.PriceBookLine
    for (const item of items) {
      await wfQuery(`
        INSERT INTO wf.PriceBookLine (PriceBookId, GoodId, GoodName, Unit, Price, LineStatus, Note)
        VALUES (@b, @g, @n, @u, @p, 'ACTIVE', @note)
      `, {
        b: { type: sql.Int, value: bookId },
        g: { type: sql.NVarChar(20), value: String(item.GoodID) },
        n: { type: sql.NVarChar(200), value: item.GoodName },
        u: { type: sql.NVarChar(20), value: item.Unit || 'ตัน' },
        p: { type: sql.Decimal(18, 2), value: item.Price },
        note: { type: sql.NVarChar(200), value: item.Remark || null },
      });
    }

    await logAudit(bookId, 'SYNC_FROM_WINSPEED', null, initialStatus, req.user.sub, `ซิงค์ ${items.length} รายการจาก WinSpeed sets: ${docNos}`);

    res.json({ ok: true, priceBookId: bookId, lineCount: items.length, status: initialStatus, name: bookName });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/pricebook/:id — book + lines + audit
router.get('/:id', async (req, res) => {
  try {
    const id = { type: sql.Int, value: Number(req.params.id) };
    const book = (await wfQuery(`SELECT * FROM wf.PriceBook WHERE Id=@id`, { id })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Price Book' });
    const lines = (await wfQuery(`SELECT Id, GoodId, GoodName, Unit, Price, LineStatus, Note FROM wf.PriceBookLine WHERE PriceBookId=@id ORDER BY GoodId`, { id })).recordset;
    const audit = (await wfQuery(`SELECT a.Action, a.FromStatus, a.ToStatus, u.DisplayName AS ByName, a.Note, a.At
                                  FROM wf.PriceBookAudit a LEFT JOIN wf.AppUser u ON u.Id=a.ByUser
                                  WHERE a.PriceBookId=@id ORDER BY a.At DESC`, { id })).recordset;
    res.json({ ...book, lines, audit });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/pricebook — สร้าง DRAFT (+ seedFromCurrent)
router.post('/', requireRole('ACCOUNTING', 'MANAGER', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { name, effectiveMonth, effectiveFrom, effectiveTo, note, seedFromCurrent } = req.body || {};
    const fromDate = effectiveFrom ? String(effectiveFrom).slice(0, 10) : null;
    const toDate = effectiveTo ? String(effectiveTo).slice(0, 10) : null;
    const effMonth = effectiveMonth || (fromDate ? fromDate.slice(0, 7) : new Date().toISOString().slice(0, 7));
    if (!name) return res.status(400).json({ message: 'name จำเป็น' });
    const r = await wfQuery(`INSERT INTO wf.PriceBook (Name, EffectiveMonth, EffectiveFrom, EffectiveTo, Note, CreatedBy)
                             OUTPUT INSERTED.Id VALUES (@n,@m,@ef,@et,@note,@u)`, {
      n: { type: sql.NVarChar(120), value: name },
      m: { type: sql.Char(7), value: effMonth },
      ef: { type: sql.Date, value: fromDate ? new Date(fromDate) : null },
      et: { type: sql.Date, value: toDate ? new Date(toDate) : null },
      note: { type: sql.NVarChar(300), value: note || null },
      u: { type: sql.Int, value: req.user.sub },
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
router.post('/:id/lines', requireRole('ACCOUNTING', 'MANAGER', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const book = (await wfQuery(`SELECT Status FROM wf.PriceBook WHERE Id=@id`, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Price Book' });
    if (book.Status !== 'DRAFT') return res.status(400).json({ message: 'แก้ไขรายการได้เฉพาะสถานะ DRAFT' });
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    await wfQuery(`DELETE FROM wf.PriceBookLine WHERE PriceBookId=@id`, { id: { type: sql.Int, value: id } });
    for (const l of lines) {
      // "งดขาย" ไม่มีราคา ส่วน *** (กำลังยกเลิก) ยังขายได้จึงต้องมีราคา
      // ฐานข้อมูลบังคับกติกานี้ด้วย CHECK อีกชั้น กันการเขียนจากทางอื่นที่ลืมตรวจ
      const lineStatus = ['ACTIVE', 'DISCONTINUING', 'SUSPENDED'].includes(String(l.lineStatus || '').toUpperCase())
        ? String(l.lineStatus).toUpperCase() : 'ACTIVE';
      const linePrice = lineStatus === 'SUSPENDED' ? null : Number(l.price);
      if (lineStatus !== 'SUSPENDED' && !Number.isFinite(linePrice)) {
        return res.status(400).json({ message: `สูตร ${l.goodName || l.goodId} ต้องระบุราคา หรือกำหนดสถานะเป็นงดขาย` });
      }
      await wfQuery(`INSERT INTO wf.PriceBookLine (PriceBookId, GoodId, GoodName, Unit, Price, LineStatus, Note) VALUES (@b,@g,@n,@u,@p,@ls,@note)`, {
        ls:   { type: sql.NVarChar(20),  value: lineStatus },
        note: { type: sql.NVarChar(200), value: l.note || null },
        b: { type: sql.Int, value: id }, g: { type: sql.NVarChar(20), value: String(l.goodId) },
        n: { type: sql.NVarChar(200), value: l.goodName || null }, u: { type: sql.NVarChar(20), value: l.unit || 'ตัน' },
        p: { type: sql.Decimal(18,2), value: linePrice },
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
    const __r = await wfQuery(`UPDATE wf.PriceBook SET Status=@s ${setCol} WHERE Id=@id AND Status=@from`, {
      s: { type: sql.NVarChar(20), value: to }, u: { type: sql.Int, value: req.user.sub }, id: { type: sql.Int, value: id },
      from: { type: sql.NVarChar(20), value: from },
    });
    if (!__r.rowsAffected?.[0]) return res.status(409).json({ message: `เปลี่ยนสถานะไม่สำเร็จ: สถานะต้องเป็น ${from} และไม่ถูกแก้ไขโดยผู้อื่น` });
    await logAudit(id, action, from, to, req.user.sub, req.body?.note);
    res.json({ ok: true, status: to });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
}

router.post('/:id/approve',  requireRole('MANAGER', 'ADMIN', 'C_LEVEL'), (req, res) => transition(req, res, { from: 'DRAFT', to: 'APPROVED', action: 'APPROVE', col: { by: 'ApprovedBy', at: 'ApprovedAt' } }));
router.post('/:id/activate', requireRole('MANAGER', 'ADMIN', 'C_LEVEL'), (req, res) => transition(req, res, { from: 'APPROVED', to: 'ACTIVE', action: 'ACTIVATE', col: { by: 'ActivatedBy', at: 'ActivatedAt' } }));
router.post('/:id/archive',  requireRole('MANAGER', 'ADMIN', 'C_LEVEL'), (req, res) => transition(req, res, { from: 'ACTIVE', to: 'ARCHIVED', action: 'ARCHIVE', col: null }));

// ── ราคาพิเศษรายร้านค้า (ตารางท้ายฟอร์มราคาขายประจำเดือน) ─────────────

// GET /api/pricebook/:id/special — รายการราคาพิเศษของเล่มนั้น
router.get('/:id/special', async (req, res) => {
  try {
    const rows = (await wfQuery(`
      SELECT sp.*, req.DisplayName AS RequestedByName, app.DisplayName AS ApprovedByName
      FROM wf.PriceBookSpecialPrice sp
      LEFT JOIN wf.AppUser req ON req.Id = sp.RequestedBy
      LEFT JOIN wf.AppUser app ON app.Id = sp.ApprovedBy
      WHERE sp.PriceBookId = @id
      ORDER BY sp.CustName, sp.GoodName`,
      { id: { type: sql.Int, value: Number(req.params.id) } })).recordset || [];
    res.json(rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/pricebook/:id/special — บันทึกคำขอราคาพิเศษ
router.post('/:id/special', requireRole('SALES', 'COUNTER_SALES', 'ACCOUNTING', 'MANAGER', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { custId, custName, goodId, goodName, requestedPrice, note } = req.body || {};
    if (!custId) return res.status(400).json({ message: 'ต้องระบุรหัสลูกค้า' });
    const r = await wfQuery(`
      INSERT INTO wf.PriceBookSpecialPrice (PriceBookId, CustId, CustName, GoodId, GoodName, RequestedPrice, Note, RequestedBy)
      OUTPUT inserted.Id
      VALUES (@b, @c, @cn, @g, @gn, @rp, @note, @uid)`,
      {
        b:    { type: sql.Int,           value: Number(req.params.id) },
        c:    { type: sql.NVarChar(20),  value: String(custId) },
        cn:   { type: sql.NVarChar(200), value: custName || null },
        g:    { type: sql.NVarChar(20),  value: goodId || null },
        gn:   { type: sql.NVarChar(200), value: goodName || null },
        rp:   { type: sql.Decimal(18,2), value: requestedPrice != null ? Number(requestedPrice) : null },
        note: { type: sql.NVarChar(300), value: note || null },
        uid:  { type: sql.Int,           value: req.user.sub },
      });
    res.status(201).json({ id: r.recordset[0].Id });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/pricebook/special/:spId — อนุมัติราคาพิเศษ
// ราคาที่อนุมัติเป็นตัวที่ระบบใช้จริง (ดู wf.v_PriceBookEffective) จึงจำกัดสิทธิ์
// ให้เฉพาะผู้อนุมัติราคา ไม่ใช่ผู้ยื่นคำขอ
router.patch('/special/:spId', requireRole('MANAGER', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { approvedPrice } = req.body || {};
    if (approvedPrice == null || !Number.isFinite(Number(approvedPrice)) || Number(approvedPrice) <= 0) {
      return res.status(400).json({ message: 'ราคาที่อนุมัติต้องเป็นตัวเลขมากกว่า 0' });
    }
    const sp = (await wfQuery(`SELECT RequestedBy FROM wf.PriceBookSpecialPrice WHERE Id=@id`,
      { id: { type: sql.Int, value: Number(req.params.spId) } })).recordset?.[0];
    if (!sp) return res.status(404).json({ message: 'ไม่พบคำขอราคาพิเศษ' });
    if (Number(sp.RequestedBy) === Number(req.user.sub)) {
      return res.status(403).json({ message: 'ผู้ยื่นคำขอราคาพิเศษอนุมัติคำขอของตนเองไม่ได้' });
    }
    const r = await wfQuery(`
      UPDATE wf.PriceBookSpecialPrice SET ApprovedPrice=@p, ApprovedBy=@uid, ApprovedAt=GETUTCDATE() WHERE Id=@id`,
      { id: { type: sql.Int, value: Number(req.params.spId) },
        p: { type: sql.Decimal(18,2), value: Number(approvedPrice) },
        uid: { type: sql.Int, value: req.user.sub } });
    if (!r.rowsAffected[0]) return res.status(404).json({ message: 'ไม่พบคำขอราคาพิเศษ' });
    res.json({ id: Number(req.params.spId), approvedPrice: Number(approvedPrice) });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/pricebook/:id/effective?custId= — ราคาที่ใช้จริง รวมราคาพิเศษแล้ว
router.get('/:id/effective', async (req, res) => {
  try {
    const rows = (await wfQuery(`
      SELECT GoodId, GoodName, Unit, LineStatus, StandardPrice, SpecialPrice, EffectivePrice, Sellable
      FROM wf.v_PriceBookEffective
      WHERE PriceBookId = @id AND (@cust IS NULL OR CustId = @cust OR CustId IS NULL)
      ORDER BY GoodName`,
      { id: { type: sql.Int, value: Number(req.params.id) },
        cust: { type: sql.NVarChar(20), value: req.query.custId || null } })).recordset || [];
    res.json(rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = router;
