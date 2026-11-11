'use strict';

/**
 * costbook.js — Costlist Management (wf.CostBook, wf.CostBookLine, wf.CostBookAudit)
 *
 * Strictly restricted by cost.view / cost.manage permissions.
 * Costlist serves as the confidential minimum price floor across all sales,
 * quotations, and special prices.
 */

const router = require('express').Router();
const { sql, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { hasPermission } = require('../services/role-capabilities');
const { getBangkokDateString } = require('../services/so-pickup-policy');

router.use(requireAuth);

function requireCostView(req, res, next) {
  if (hasPermission(req.user, 'cost.view') || hasPermission(req.user, 'cost.manage')) {
    return next();
  }
  return res.status(403).json({
    code: 'FORBIDDEN_COST_VIEW',
    message: 'ไม่มีสิทธิ์เข้าถึงข้อมูล Costlist',
  });
}

const requireCostManage = requireCapability('cost.manage');

async function logAudit(queryFn, costBookId, action, fromStatus, toStatus, userId, note) {
  await queryFn(
    `INSERT INTO wf.CostBookAudit (CostBookId, Action, FromStatus, ToStatus, ByUser, Note)
     VALUES (@id, @a, @f, @t, @u, @n)`,
    {
      id: { type: sql.Int, value: costBookId },
      a: { type: sql.VarChar(40), value: action },
      f: { type: sql.VarChar(20), value: fromStatus || null },
      t: { type: sql.VarChar(20), value: toStatus || null },
      u: { type: sql.Int, value: userId || null },
      n: { type: sql.NVarChar(500), value: note || null },
    }
  );
}

// GET /api/costbook — list CostBooks
router.get('/', requireCostView, async (_req, res) => {
  try {
    const r = await wfQuery(`
      SELECT c.Id, c.Name, c.EffectiveMonth,
             CONVERT(VARCHAR(10), c.EffectiveFrom, 23) AS EffectiveFrom,
             CONVERT(VARCHAR(10), c.EffectiveTo, 23) AS EffectiveTo,
             c.Status, c.Note, c.CreatedAt, c.ApprovedAt, c.ActivatedAt, c.UpdatedAt,
             cu.DisplayName AS CreatedByName,
             au.DisplayName AS ApprovedByName,
             act.DisplayName AS ActivatedByName,
             (SELECT COUNT(*) FROM wf.CostBookLine l WHERE l.CostBookId = c.Id) AS LineCount,
             (SELECT COUNT(*) FROM wf.CostBookLine l WHERE l.CostBookId = c.Id AND l.CostPrice IS NOT NULL AND l.CostPrice > 0) AS PricedCount
      FROM wf.CostBook c
      LEFT JOIN wf.AppUser cu ON cu.Id = c.CreatedBy
      LEFT JOIN wf.AppUser au ON au.Id = c.ApprovedBy
      LEFT JOIN wf.AppUser act ON act.Id = c.ActivatedBy
      ORDER BY COALESCE(c.EffectiveFrom, CAST(c.EffectiveMonth + '-01' AS DATE)) DESC, c.Id DESC
    `);
    res.json(r.recordset || []);
  } catch (e) {
    console.error('[costbook/list]', e);
    res.status(500).json({ message: e.message });
  }
});

// GET /api/costbook/active-map?asOfDate=YYYY-MM-DD — confidential active cost map (only cost.view/cost.manage)
router.get('/active-map', requireCostView, async (req, res) => {
  try {
    const targetDate = req.query.asOfDate ? String(req.query.asOfDate).slice(0, 10) : getBangkokDateString();
    const bookRes = await wfQuery(`
      SELECT TOP 1 Id, Name, EffectiveMonth,
             CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
             CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo
      FROM wf.CostBook WITH (NOLOCK)
      WHERE Status = 'ACTIVE'
      ORDER BY
        CASE
          WHEN (EffectiveFrom IS NULL OR EffectiveFrom <= @d)
           AND (EffectiveTo IS NULL OR EffectiveTo >= @d) THEN 0
          ELSE 1
        END,
        COALESCE(EffectiveFrom, '1900-01-01') DESC,
        Id DESC
    `, { d: { type: sql.Date, value: targetDate } });

    const book = bookRes.recordset?.[0] || null;
    if (!book) return res.json({ costBook: null, items: {} });

    const linesRes = await wfQuery(`
      SELECT GoodId, GoodCode, CostPrice
      FROM wf.CostBookLine WITH (NOLOCK)
      WHERE CostBookId = @id AND CostPrice IS NOT NULL AND CostPrice > 0
    `, { id: { type: sql.Int, value: book.Id } });

    const items = {};
    for (const l of linesRes.recordset || []) {
      items[String(l.GoodId)] = Number(l.CostPrice);
    }
    res.json({ costBook: book, items });
  } catch (e) {
    console.error('[costbook/active-map]', e);
    res.status(500).json({ message: e.message });
  }
});

// GET /api/costbook/:id — book details + lines + audit
router.get('/:id', requireCostView, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid id' });

    const book = (await wfQuery(`
      SELECT Id, Name, EffectiveMonth,
             CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
             CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo,
             Status, Note, CreatedBy, CreatedAt, ApprovedBy, ApprovedAt, ActivatedBy, ActivatedAt, UpdatedAt
      FROM wf.CostBook WHERE Id = @id
    `, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Costlist' });

    const lines = (await wfQuery(`
      SELECT l.Id, l.CostBookId, l.GoodId,
             COALESCE(l.GoodCode, g.GoodCode) AS GoodCode,
             COALESCE(NULLIF(l.GoodName, ''), g.GoodName1) AS GoodName,
             COALESCE(l.GoodGroupId, g.GoodGroupID) AS GoodGroupId,
             COALESCE(l.GoodGroupName, gg.GoodGroupName) AS GoodGroupName,
             l.Unit, l.CostPrice, l.Note, l.UpdatedAt
      FROM wf.CostBookLine l
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON CAST(g.GoodID AS NVARCHAR(20)) = l.GoodId
      LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = g.GoodGroupID
      WHERE l.CostBookId = @id
      ORDER BY COALESCE(l.GoodGroupId, g.GoodGroupID, 9999), COALESCE(NULLIF(l.GoodName, ''), g.GoodName1, l.GoodId)
    `, { id: { type: sql.Int, value: id } })).recordset || [];

    const audit = (await wfQuery(`
      SELECT a.Action, a.FromStatus, a.ToStatus, u.DisplayName AS ByName, a.Note, a.At
      FROM wf.CostBookAudit a
      LEFT JOIN wf.AppUser u ON u.Id = a.ByUser
      WHERE a.CostBookId = @id
      ORDER BY a.At DESC, a.Id DESC
    `, { id: { type: sql.Int, value: id } })).recordset || [];

    res.json({ ...book, lines, audit });
  } catch (e) {
    console.error('[costbook/get]', e);
    res.status(500).json({ message: e.message });
  }
});

// POST /api/costbook — create new Costlist DRAFT (optionally seed from current active CostBook or active sellable goods)
router.post('/', requireCostManage, async (req, res) => {
  try {
    const {
      name,
      effectiveMonth,
      effectiveFrom,
      effectiveTo,
      note,
      seedFromCurrent = true,
      seedAllGoods = false,
      seedFromBookId = null,
    } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'กรุณาระบุชื่อ Costlist' });
    }
    const cleanFrom = effectiveFrom ? String(effectiveFrom).slice(0, 10) : null;
    const cleanTo = effectiveTo ? String(effectiveTo).slice(0, 10) : null;
    if (cleanFrom && cleanTo && cleanFrom > cleanTo) {
      return res.status(400).json({ message: 'วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด' });
    }
    const monthStr = effectiveMonth || (cleanFrom ? cleanFrom.slice(0, 7) : getBangkokDateString().slice(0, 7));

    const newId = await wfTransaction(async tx => {
      const tq = async (text, inputs = {}) => {
        const r = tx.request();
        for (const [k, { type, value }] of Object.entries(inputs)) r.input(k, type, value);
        return r.query(text);
      };

      const ins = await tq(`
        INSERT INTO wf.CostBook (Name, EffectiveMonth, EffectiveFrom, EffectiveTo, Note, CreatedBy)
        OUTPUT inserted.Id
        VALUES (@n, @m, @ef, @et, @note, @u)
      `, {
        n: { type: sql.NVarChar(120), value: String(name).trim() },
        m: { type: sql.Char(7), value: String(monthStr).slice(0, 7) },
        ef: { type: sql.Date, value: cleanFrom },
        et: { type: sql.Date, value: cleanTo },
        note: { type: sql.NVarChar(500), value: note || null },
        u: { type: sql.Int, value: req.user.sub },
      });
      const id = ins.recordset[0].Id;

      let seededCount = 0;
      if (seedFromBookId) {
        const seedRes = await tq(`
          INSERT INTO wf.CostBookLine (CostBookId, GoodId, GoodCode, GoodName, GoodGroupId, GoodGroupName, Unit, CostPrice, Note)
          SELECT @newId, GoodId, GoodCode, GoodName, GoodGroupId, GoodGroupName, Unit, CostPrice, Note
          FROM wf.CostBookLine WHERE CostBookId = @srcId
        `, { newId: { type: sql.Int, value: id }, srcId: { type: sql.Int, value: Number(seedFromBookId) } });
        seededCount = Number(seedRes.rowsAffected?.[0] || 0);
      } else if (seedFromCurrent) {
        const cur = (await tq(`
          SELECT TOP 1 Id FROM wf.CostBook
          WHERE Id <> @id AND Status IN ('ACTIVE', 'APPROVED', 'ARCHIVED')
          ORDER BY CASE WHEN Status = 'ACTIVE' THEN 0 WHEN Status = 'APPROVED' THEN 1 ELSE 2 END, Id DESC
        `, { id: { type: sql.Int, value: id } })).recordset[0];
        if (cur) {
          const seedRes = await tq(`
            INSERT INTO wf.CostBookLine (CostBookId, GoodId, GoodCode, GoodName, GoodGroupId, GoodGroupName, Unit, CostPrice, Note)
            SELECT @newId, GoodId, GoodCode, GoodName, GoodGroupId, GoodGroupName, Unit, CostPrice, Note
            FROM wf.CostBookLine WHERE CostBookId = @srcId
          `, { newId: { type: sql.Int, value: id }, srcId: { type: sql.Int, value: cur.Id } });
          seededCount = Number(seedRes.rowsAffected?.[0] || 0);
        }
      }

      if (seededCount === 0 && seedAllGoods) {
        await tq(`
          INSERT INTO wf.CostBookLine (CostBookId, GoodId, GoodCode, GoodName, GoodGroupId, GoodGroupName, Unit, CostPrice)
          SELECT @newId,
                 CAST(g.GoodID AS NVARCHAR(20)),
                 g.GoodCode,
                 g.GoodName1,
                 g.GoodGroupID,
                 gg.GoodGroupName,
                 ISNULL(u.GoodUnitName, N'ตัน'),
                 NULL
          FROM dbo.EMGood g WITH (NOLOCK)
          LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = g.GoodGroupID
          LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = g.MainGoodUnitID
          WHERE g.GoodGroupID IN (1003, 1004)
            AND ISNULL(g.Inactive, 'A') = 'A'
        `, { newId: { type: sql.Int, value: id } });
      }

      await logAudit(tq, id, 'CREATE', null, 'DRAFT', req.user.sub, note || name);
      return id;
    });

    res.json({ id: newId });
  } catch (e) {
    console.error('[costbook/create]', e);
    res.status(500).json({ message: e.message });
  }
});

// PUT /api/costbook/:id — update Costlist header (Name, EffectiveFrom, EffectiveTo, Note)
router.put('/:id', requireCostManage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, effectiveFrom, effectiveTo, note } = req.body || {};
    const book = (await wfQuery(`SELECT Id, Status, Name FROM wf.CostBook WHERE Id = @id`, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Costlist' });
    if (book.Status === 'ARCHIVED') return res.status(400).json({ message: 'ไม่สามารถแก้ไข Costlist ที่เก็บเข้าคลังแล้ว' });

    const cleanFrom = effectiveFrom ? String(effectiveFrom).slice(0, 10) : null;
    const cleanTo = effectiveTo ? String(effectiveTo).slice(0, 10) : null;
    if (cleanFrom && cleanTo && cleanFrom > cleanTo) {
      return res.status(400).json({ message: 'วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด' });
    }
    const cleanName = name != null && String(name).trim() ? String(name).trim() : book.Name;
    const nextMonth = cleanFrom ? cleanFrom.slice(0, 7) : undefined;

    await wfQuery(`
      UPDATE wf.CostBook
      SET Name = @name,
          EffectiveMonth = COALESCE(@em, EffectiveMonth),
          EffectiveFrom = COALESCE(@ef, EffectiveFrom),
          EffectiveTo = COALESCE(@et, EffectiveTo),
          Note = @note,
          UpdatedAt = GETUTCDATE()
      WHERE Id = @id
    `, {
      id: { type: sql.Int, value: id },
      name: { type: sql.NVarChar(120), value: cleanName },
      em: { type: sql.Char(7), value: nextMonth || null },
      ef: { type: sql.Date, value: cleanFrom },
      et: { type: sql.Date, value: cleanTo },
      note: { type: sql.NVarChar(500), value: note ?? null },
    });

    await logAudit(wfQuery, id, 'UPDATE_HEADER', book.Status, book.Status, req.user.sub, `${cleanName} (${cleanFrom || '-'} ถึง ${cleanTo || '-'})`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[costbook/update-header]', e);
    res.status(500).json({ message: e.message });
  }
});

// POST /api/costbook/:id/lines — bulk replace lines (DRAFT, APPROVED, or ACTIVE)
router.post('/:id/lines', requireCostManage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { lines } = req.body || {};
    if (!Array.isArray(lines)) return res.status(400).json({ message: 'ต้องระบุรายการสินค้า lines' });

    const book = (await wfQuery(`SELECT Id, Status FROM wf.CostBook WHERE Id = @id`, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Costlist' });
    if (book.Status === 'ARCHIVED') return res.status(400).json({ message: 'ไม่สามารถแก้ไข Costlist ที่เก็บเข้าคลังแล้ว' });

    for (const l of lines) {
      if (!l.goodId) return res.status(400).json({ message: 'รหัสสินค้า (goodId) จำเป็นทุกรายการ' });
      if (l.costPrice !== null && l.costPrice !== undefined && l.costPrice !== '') {
        const p = Number(l.costPrice);
        if (!Number.isFinite(p) || p <= 0) {
          return res.status(400).json({ message: `ราคาทุนของ ${l.goodName || l.goodId} ต้องเป็นตัวเลขมากกว่า 0` });
        }
      }
    }

    await wfTransaction(async tx => {
      const tq = async (text, inputs = {}) => {
        const r = tx.request();
        for (const [k, { type, value }] of Object.entries(inputs)) r.input(k, type, value);
        return r.query(text);
      };

      await tq(`DELETE FROM wf.CostBookLine WHERE CostBookId = @id`, { id: { type: sql.Int, value: id } });

      for (const l of lines) {
        const cp = (l.costPrice !== null && l.costPrice !== undefined && l.costPrice !== '') ? Number(l.costPrice) : null;
        await tq(`
          INSERT INTO wf.CostBookLine (CostBookId, GoodId, GoodCode, GoodName, GoodGroupId, GoodGroupName, Unit, CostPrice, Note)
          SELECT @cbId, @gid,
                 COALESCE(@gc, g.GoodCode),
                 COALESCE(NULLIF(@gn, ''), g.GoodName1),
                 COALESCE(@ggId, g.GoodGroupID),
                 COALESCE(@ggName, gg.GoodGroupName),
                 @u, @cp, @note
          FROM (SELECT 1 AS dummy) x
          LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON CAST(g.GoodID AS NVARCHAR(20)) = @gid
          LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = g.GoodGroupID
        `, {
          cbId: { type: sql.Int, value: id },
          gid: { type: sql.NVarChar(20), value: String(l.goodId) },
          gc: { type: sql.NVarChar(50), value: l.goodCode || null },
          gn: { type: sql.NVarChar(200), value: l.goodName || null },
          ggId: { type: sql.Int, value: l.goodGroupId != null ? Number(l.goodGroupId) : null },
          ggName: { type: sql.NVarChar(100), value: l.goodGroupName || null },
          u: { type: sql.NVarChar(30), value: l.unit || 'ตัน' },
          cp: { type: sql.Decimal(12, 2), value: cp },
          note: { type: sql.NVarChar(255), value: l.note || null },
        });
      }

      await tq(`UPDATE wf.CostBook SET UpdatedAt = GETUTCDATE() WHERE Id = @id`, { id: { type: sql.Int, value: id } });
      await logAudit(tq, id, 'EDIT_LINES', book.Status, book.Status, req.user.sub, `${lines.length} รายการ`);
    });

    res.json({ ok: true, count: lines.length });
  } catch (e) {
    console.error('[costbook/lines]', e);
    res.status(500).json({ message: e.message });
  }
});

// PATCH /api/costbook/:id/lines/:lineId — inline single-line cost update
router.patch('/:id/lines/:lineId', requireCostManage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    const { costPrice, note } = req.body || {};

    const book = (await wfQuery(`SELECT Id, Status FROM wf.CostBook WHERE Id = @id`, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Costlist' });
    if (book.Status === 'ARCHIVED') return res.status(400).json({ message: 'ไม่สามารถแก้ไข Costlist ที่เก็บเข้าคลังแล้ว' });

    const cp = (costPrice === null || costPrice === undefined || costPrice === '') ? null : Number(costPrice);
    if (cp !== null && (!Number.isFinite(cp) || cp <= 0)) {
      return res.status(400).json({ message: 'ราคาทุนต้องเป็นตัวเลขมากกว่า 0' });
    }

    const r = await wfQuery(`
      UPDATE wf.CostBookLine
      SET CostPrice = @cp,
          Note = COALESCE(@note, Note),
          UpdatedAt = GETUTCDATE()
      WHERE Id = @lineId AND CostBookId = @cbId
    `, {
      cp: { type: sql.Decimal(12, 2), value: cp },
      note: { type: sql.NVarChar(255), value: note === undefined ? null : (note || null) },
      lineId: { type: sql.Int, value: lineId },
      cbId: { type: sql.Int, value: id },
    });
    if (!r.rowsAffected?.[0]) return res.status(404).json({ message: 'ไม่พบรายการสินค้านี้' });

    await logAudit(wfQuery, id, 'EDIT_LINE', book.Status, book.Status, req.user.sub, `Line ${lineId} -> Cost ${cp ?? '-'}`);
    res.json({ ok: true, costPrice: cp });
  } catch (e) {
    console.error('[costbook/edit-line]', e);
    res.status(500).json({ message: e.message });
  }
});

// POST /api/costbook/:id/lines/item — upsert single formula line into Costlist
router.post('/:id/lines/item', requireCostManage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { goodId, goodCode, goodName, unit = 'ตัน', costPrice, note } = req.body || {};
    if (!goodId) return res.status(400).json({ message: 'กรุณาเลือกสินค้า' });

    const book = (await wfQuery(`SELECT Id, Status FROM wf.CostBook WHERE Id = @id`, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Costlist' });
    if (book.Status === 'ARCHIVED') return res.status(400).json({ message: 'ไม่สามารถแก้ไข Costlist ที่เก็บเข้าคลังแล้ว' });

    const cp = (costPrice === null || costPrice === undefined || costPrice === '') ? null : Number(costPrice);
    if (cp !== null && (!Number.isFinite(cp) || cp <= 0)) {
      return res.status(400).json({ message: 'ราคาทุนต้องมากกว่า 0' });
    }

    const existing = (await wfQuery(`SELECT Id FROM wf.CostBookLine WHERE CostBookId = @cbId AND GoodId = @gid`, {
      cbId: { type: sql.Int, value: id },
      gid: { type: sql.NVarChar(20), value: String(goodId) },
    })).recordset[0];

    if (existing) {
      await wfQuery(`
        UPDATE wf.CostBookLine
        SET CostPrice = @cp, Note = COALESCE(@note, Note), UpdatedAt = GETUTCDATE()
        WHERE Id = @lineId
      `, {
        cp: { type: sql.Decimal(12, 2), value: cp },
        note: { type: sql.NVarChar(255), value: note ?? null },
        lineId: { type: sql.Int, value: existing.Id },
      });
    } else {
      await wfQuery(`
        INSERT INTO wf.CostBookLine (CostBookId, GoodId, GoodCode, GoodName, GoodGroupId, GoodGroupName, Unit, CostPrice, Note)
        SELECT @cbId, @gid,
               COALESCE(@gc, g.GoodCode),
               COALESCE(NULLIF(@gn, ''), g.GoodName1),
               g.GoodGroupID,
               gg.GoodGroupName,
               @u, @cp, @note
        FROM (SELECT 1 AS dummy) x
        LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON CAST(g.GoodID AS NVARCHAR(20)) = @gid
        LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = g.GoodGroupID
      `, {
        cbId: { type: sql.Int, value: id },
        gid: { type: sql.NVarChar(20), value: String(goodId) },
        gc: { type: sql.NVarChar(50), value: goodCode || null },
        gn: { type: sql.NVarChar(200), value: goodName || null },
        u: { type: sql.NVarChar(30), value: unit },
        cp: { type: sql.Decimal(12, 2), value: cp },
        note: { type: sql.NVarChar(255), value: note || null },
      });
    }

    await logAudit(wfQuery, id, existing ? 'EDIT_LINE' : 'ADD_LINE', book.Status, book.Status, req.user.sub, `${goodName || goodId}: ${cp ?? '-'}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[costbook/add-item]', e);
    res.status(500).json({ message: e.message });
  }
});

// Workflow: approve | activate | archive
for (const [action, fromStatuses, toStatus, col] of [
  ['approve', ['DRAFT'], 'APPROVED', 'ApprovedBy'],
  ['activate', ['APPROVED', 'DRAFT'], 'ACTIVE', 'ActivatedBy'],
  ['archive', ['ACTIVE', 'APPROVED', 'DRAFT'], 'ARCHIVED', null],
]) {
  router.post(`/:id/${action}`, requireCostManage, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const book = (await wfQuery(`SELECT Id, Status, EffectiveMonth FROM wf.CostBook WHERE Id = @id`, { id: { type: sql.Int, value: id } })).recordset[0];
      if (!book) return res.status(404).json({ message: 'ไม่พบ Costlist' });
      if (!fromStatuses.includes(book.Status)) {
        return res.status(409).json({ message: `ต้องเป็น ${fromStatuses.join(' หรือ ')} (ปัจจุบัน: ${book.Status})` });
      }

      if (toStatus === 'ACTIVE') {
        const lineCnt = (await wfQuery(`SELECT COUNT(*) AS cnt FROM wf.CostBookLine WHERE CostBookId = @id AND CostPrice IS NOT NULL AND CostPrice > 0`, { id: { type: sql.Int, value: id } })).recordset[0]?.cnt || 0;
        if (lineCnt === 0) {
          return res.status(400).json({ message: 'ต้องกรอกราคาทุนอย่างน้อย 1 รายการก่อนเปิดใช้งาน' });
        }
        await wfQuery(`
          UPDATE wf.CostBook
          SET Status = 'ARCHIVED', UpdatedAt = GETUTCDATE()
          WHERE Status = 'ACTIVE' AND EffectiveMonth = @em AND Id <> @id
        `, { em: { type: sql.Char(7), value: book.EffectiveMonth }, id: { type: sql.Int, value: id } });
      }

      const setCol = col ? `, ${col} = @uid, ${col.replace('By', 'At')} = GETUTCDATE()` : '';
      await wfQuery(`UPDATE wf.CostBook SET Status = @s, UpdatedAt = GETUTCDATE() ${setCol} WHERE Id = @id`, {
        s: { type: sql.VarChar(20), value: toStatus },
        uid: { type: sql.Int, value: req.user.sub },
        id: { type: sql.Int, value: id },
      });

      await logAudit(wfQuery, id, action.toUpperCase(), book.Status, toStatus, req.user.sub, req.body?.note || null);
      res.json({ ok: true, status: toStatus });
    } catch (e) {
      console.error(`[costbook/${action}]`, e);
      res.status(500).json({ message: e.message });
    }
  });
}

module.exports = router;

