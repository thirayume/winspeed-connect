'use strict';

/**
 * pricebook.js — FR-023 Price Book workflow & Two-Way WinSpeed Sync (dbo.EMSetPriceHD / DT)
 * Draft -> Approved -> Active <-> WinSpeed Sync, LineStatus (ACTIVE/DISCONTINUING/SUSPENDED),
 * Special Price per Customer, and Confidential Costlist Minimum Price Enforcement.
 */
const router = require('express').Router();
const { sql, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireRole, requireCapability } = require('../middleware/auth');
const { assertPricesAboveCost } = require('../services/cost-authority');
const { getBangkokDateString } = require('../services/so-pickup-policy');
const { broadcast } = require('../services/socket');
const {
  parseDateOnly,
  parseSetIds,
  hasSyncColumns,
  resolveBookWinSpeedSetIds,
  assertNoPriceOverlap,
  syncBookToWinSpeed,
  syncSpecialPriceToWinSpeed,
  reconcileFromWinSpeed,
  invalidateReconcileCache,
} = require('../services/pricebook-winspeed-sync');

function notifyPriceBookUpdated(payload = {}) {
  try {
    invalidateReconcileCache();
    broadcast('pricebook_updated', payload);
  } catch {
    // Non-fatal in unit tests or when sockets aren't initialized
  }
}

router.use(requireAuth);

const requirePricingManage = requireCapability('pricing.manage');
const SPECIAL_APPROVE_ROLES = ['MANAGER', 'C_LEVEL', 'ADMIN', 'ACCOUNTING'];

async function audit(queryFn, bookId, action, fromStatus, toStatus, userId, note) {
  await queryFn(
    `INSERT INTO wf.PriceBookAudit (PriceBookId, Action, FromStatus, ToStatus, ByUser, Note)
     VALUES (@b, @a, @f, @t, @u, @n)`,
    {
      b: { type: sql.Int, value: bookId },
      a: { type: sql.VarChar(40), value: action },
      f: { type: sql.VarChar(20), value: fromStatus || null },
      t: { type: sql.VarChar(20), value: toStatus || null },
      u: { type: sql.Int, value: userId || null },
      n: { type: sql.NVarChar(500), value: note || null },
    }
  );
}

function txQuery(tx) {
  return async (text, inputs = {}) => {
    const req = tx.request();
    for (const [name, { type, value }] of Object.entries(inputs)) req.input(name, type, value);
    return req.query(text);
  };
}

// GET /api/pricebook — รายการ (used by CreateSODialog + PriceBookManager)
router.get('/', async (_req, res) => {
  try {
    await reconcileFromWinSpeed();
    const syncCols = await hasSyncColumns();
    const extraCols = syncCols ? ', b.SourceSetPriceIds, b.WinSpeedSyncAt, sb.DisplayName AS LastSyncedByName' : '';
    const extraJoin = syncCols ? 'LEFT JOIN wf.AppUser sb ON sb.Id = b.LastSyncedBy' : '';
    const r = await wfQuery(`
      SELECT b.Id, b.Name, b.EffectiveMonth,
             CONVERT(VARCHAR(10), b.EffectiveFrom, 23) AS EffectiveFrom,
             CONVERT(VARCHAR(10), b.EffectiveTo, 23) AS EffectiveTo,
             b.Status, b.Note, b.CreatedAt,
             b.ApprovedAt, b.ActivatedAt${extraCols},
             u.DisplayName AS CreatedByName, au.DisplayName AS ApprovedByName, act.DisplayName AS ActivatedByName,
             (SELECT COUNT(*) FROM wf.PriceBookLine l WHERE l.PriceBookId=b.Id) AS LineCount
      FROM wf.PriceBook b
      LEFT JOIN wf.AppUser u   ON u.Id   = b.CreatedBy
      LEFT JOIN wf.AppUser au  ON au.Id  = b.ApprovedBy
      LEFT JOIN wf.AppUser act ON act.Id = b.ActivatedBy
      ${extraJoin}
      ORDER BY COALESCE(b.EffectiveFrom, CAST(b.EffectiveMonth + '-01' AS DATE)) DESC, b.Id DESC`);
    res.json(r.recordset);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/pricebook/winspeed-sets — รายการประกาศราคาจาก WinSpeed (dbo.EMSetPriceHD)
router.get('/winspeed-sets', async (_req, res) => {
  try {
    const r = await wfQuery(`
      SELECT hd.SetPriceID, hd.DocuNo,
             CONVERT(VARCHAR(10), hd.DocuDate, 23) AS DocuDate,
             CONVERT(VARCHAR(10), hd.BeginDate, 23) AS BeginDate,
             CONVERT(VARCHAR(10), hd.EndDate, 23) AS EndDate,
             hd.CustID, c.CustName, hd.Remark1,
             (SELECT COUNT(*) FROM dbo.EMSetPriceDT dt WITH (NOLOCK) WHERE dt.SetPriceID = hd.SetPriceID) AS LineCount,
             CASE WHEN CAST(hd.BeginDate AS DATE) <= CAST(GETDATE() AS DATE) AND CAST(hd.EndDate AS DATE) >= CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END AS IsActivePeriod
      FROM dbo.EMSetPriceHD hd WITH (NOLOCK)
      LEFT JOIN dbo.EMCust c WITH (NOLOCK) ON c.CustID = hd.CustID
      WHERE hd.CustID IS NULL
      ORDER BY hd.BeginDate DESC, hd.SetPriceID DESC
    `);
    res.json(r.recordset || []);
  } catch (e) { console.error('[pricebook/winspeed-sets]', e); res.status(500).json({ message: e.message }); }
});

// GET /api/pricebook/winspeed-sets/:id/lines — รายการสินค้าและราคาของชุด WinSpeed
router.get('/winspeed-sets/:id/lines', async (req, res) => {
  try {
    const setId = Number(req.params.id);
    if (!Number.isInteger(setId) || setId <= 0) return res.status(400).json({ message: 'Invalid SetPriceID' });
    const r = await wfQuery(`
      SELECT dt.SetPriceID, dt.ListNo, CAST(dt.ListID AS NVARCHAR(20)) AS GoodID,
             g.GoodCode, g.GoodName1 AS GoodName, g.GoodGroupID AS GoodGroupId, gg.GoodGroupName,
             ISNULL(u.GoodUnitName, N'ตัน') AS Unit,
             dt.GoodPriceNet AS Price, dt.Remark
      FROM dbo.EMSetPriceDT dt WITH (NOLOCK)
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.ListID
      LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = g.GoodGroupID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = ISNULL(dt.GoodUnitID, g.MainGoodUnitID)
      WHERE dt.SetPriceID = @setId
      ORDER BY gg.GoodGroupName, g.GoodName1, dt.ListNo
    `, { setId: { type: sql.Int, value: setId } });
    res.json(r.recordset || []);
  } catch (e) { console.error('[pricebook/winspeed-set-lines]', e); res.status(500).json({ message: e.message }); }
});

// POST /api/pricebook/sync-from-winspeed — ซิงค์/นำเข้าตารางราคาจาก WinSpeed เข้าสู่ wf.PriceBook
router.post('/sync-from-winspeed', requirePricingManage, async (req, res) => {
  try {
    const { setPriceIds, name, status = 'DRAFT', effectiveFrom, effectiveTo, note } = req.body || {};
    const targetIds = Array.isArray(setPriceIds) ? setPriceIds.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];

    // 1. ค้นหา WinSpeed SetPriceHD
    let headersQuery = `
      SELECT hd.SetPriceID, hd.DocuNo, hd.BeginDate, hd.EndDate, hd.Remark1
      FROM dbo.EMSetPriceHD hd WITH (NOLOCK)
      WHERE hd.CustID IS NULL
    `;
    const inputs = {};
    if (targetIds.length > 0) {
      const ph = targetIds.map((id, idx) => { inputs[`sp${idx}`] = { type: sql.Int, value: id }; return `@sp${idx}`; });
      headersQuery += ` AND hd.SetPriceID IN (${ph.join(',')})`;
    } else {
      headersQuery += ` AND CAST(hd.BeginDate AS DATE) <= CAST(GETDATE() AS DATE) AND CAST(hd.EndDate AS DATE) >= CAST(GETDATE() AS DATE)`;
    }
    headersQuery += ` ORDER BY hd.BeginDate DESC, hd.SetPriceID ASC`;

    const headers = (await wfQuery(headersQuery, inputs)).recordset || [];
    if (!headers.length) {
      return res.status(404).json({ message: 'ไม่พบชุดราคาประกาศ WinSpeed ตามเงื่อนไขที่เลือก' });
    }

    // 2. ดึงรายการสินค้ารวมกัน (ถ้าหลายชุดเช่น สูตร + แม่ปุ๋ย ให้เรียงลำดับใหม่และเก็บ SetPriceID/ListNo ไว้ sync กลับ!)
    const foundIds = headers.map(h => h.SetPriceID);
    const idInputs = {};
    const idPh = foundIds.map((id, i) => { idInputs[`sid${i}`] = { type: sql.Int, value: id }; return `@sid${i}`; });
    const linesRes = (await wfQuery(`
      SELECT dt.SetPriceID, dt.ListNo, CAST(dt.ListID AS NVARCHAR(20)) AS GoodId,
             g.GoodCode, g.GoodName1 AS GoodName, g.GoodGroupID AS GoodGroupId, gg.GoodGroupName,
             ISNULL(u.GoodUnitName, N'ตัน') AS Unit,
             dt.GoodPriceNet AS Price, dt.Remark
      FROM dbo.EMSetPriceDT dt WITH (NOLOCK)
      JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.ListID
      LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = g.GoodGroupID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = ISNULL(dt.GoodUnitID, g.MainGoodUnitID)
      WHERE dt.SetPriceID IN (${idPh.join(',')})
        AND ISNULL(g.Inactive, 'A') = 'A'
      ORDER BY dt.SetPriceID DESC, dt.ListNo ASC
    `, idInputs)).recordset || [];

    const dedupMap = new Map();
    for (const l of linesRes) {
      if (!dedupMap.has(l.GoodId)) dedupMap.set(l.GoodId, l);
    }
    const items = [...dedupMap.values()];
    if (!items.length) {
      return res.status(400).json({ message: 'ชุดราคาที่เลือกไม่มีรายการสินค้าที่จำหน่าย' });
    }

    // Check cost floor before activating directly
    const cleanFrom = effectiveFrom ? String(effectiveFrom).slice(0, 10) : (headers[0].BeginDate ? new Date(headers[0].BeginDate).toISOString().slice(0, 10) : null);
    const cleanTo = effectiveTo ? String(effectiveTo).slice(0, 10) : (headers[0].EndDate ? new Date(headers[0].EndDate).toISOString().slice(0, 10) : null);

    // 3. กำหนดวันที่และชื่อ PriceBook
    const minBegin = cleanFrom;
    const maxEnd = cleanTo;
    const effectiveMonth = minBegin ? minBegin.slice(0, 7) : getBangkokDateString().slice(0, 7);
    const docNos = headers.map(h => h.DocuNo).join(', ');
    const bookName = name || `ตารางราคา WinSpeed (${docNos}) ${minBegin || effectiveMonth}`;
    const initialStatus = status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT';
    const syncReady = await hasSyncColumns();
    await assertNoPriceOverlap({
      excludeSetIds: foundIds,
      effectiveFrom: minBegin,
      effectiveTo: maxEnd,
      goodIds: items.map(i => i.GoodId),
    });

    // 4. สร้าง PriceBook + Lines
    const insertBook = await wfQuery(`
      INSERT INTO wf.PriceBook (Name, EffectiveMonth, EffectiveFrom, EffectiveTo, Status, Note, CreatedBy, ApprovedBy, ApprovedAt, ActivatedBy, ActivatedAt${syncReady ? ', SourceSetPriceIds, WinSpeedSyncAt, LastSyncedBy' : ''})
      OUTPUT inserted.Id
      VALUES (@n, @m, @ef, @et, @st, @note, @u, @appBy, @appAt, @actBy, @actAt${syncReady ? ', @sids, SYSUTCDATETIME(), @u' : ''})
    `, {
      n: { type: sql.NVarChar(120), value: bookName.slice(0, 120) },
      m: { type: sql.Char(7), value: effectiveMonth },
      ef: { type: sql.Date, value: minBegin },
      et: { type: sql.Date, value: maxEnd },
      st: { type: sql.VarChar(20), value: initialStatus },
      note: { type: sql.NVarChar(500), value: note || `ซิงค์จาก WinSpeed: ${docNos}` },
      u: { type: sql.Int, value: req.user.sub },
      appBy: { type: sql.Int, value: initialStatus === 'ACTIVE' ? req.user.sub : null },
      appAt: { type: sql.DateTime2, value: initialStatus === 'ACTIVE' ? new Date() : null },
      actBy: { type: sql.Int, value: initialStatus === 'ACTIVE' ? req.user.sub : null },
      actAt: { type: sql.DateTime2, value: initialStatus === 'ACTIVE' ? new Date() : null },
      ...(syncReady ? { sids: { type: sql.NVarChar(200), value: foundIds.join(',') } } : {}),
    });
    const bookId = insertBook.recordset[0].Id;

    // 5. เพิ่ม wf.PriceBookLine พร้อมลิงก์ SetPriceID + ListNo ต้นทาง
    for (const item of items) {
      const hasStar = item.Remark && String(item.Remark).includes('***');
      await wfQuery(`
        INSERT INTO wf.PriceBookLine (
          PriceBookId, GoodId, GoodName, Unit, Price, LineStatus, Note
          ${syncReady ? ', GoodCode, GoodGroupId, GoodGroupName, WinSpeedSetPriceId, WinSpeedListNo' : ''}
        )
        VALUES (
          @b, @g, @gn, @u, @p, @ls, @note
          ${syncReady ? ', @gc, @ggId, @ggName, @wsSetId, @wsListNo' : ''}
        )
      `, {
        b: { type: sql.Int, value: bookId },
        g: { type: sql.NVarChar(20), value: String(item.GoodId) },
        gn: { type: sql.NVarChar(200), value: item.GoodName || '' },
        u: { type: sql.NVarChar(30), value: item.Unit || 'ตัน' },
        p: { type: sql.Decimal(12, 2), value: Number(item.Price) },
        ls: { type: sql.VarChar(20), value: hasStar ? 'DISCONTINUING' : 'ACTIVE' },
        note: { type: sql.NVarChar(255), value: item.Remark || null },
        ...(syncReady ? {
          gc: { type: sql.NVarChar(50), value: item.GoodCode || null },
          ggId: { type: sql.Int, value: item.GoodGroupId != null ? Number(item.GoodGroupId) : null },
          ggName: { type: sql.NVarChar(100), value: item.GoodGroupName || null },
          wsSetId: { type: sql.Int, value: Number(item.SetPriceID) },
          wsListNo: { type: sql.SmallInt, value: Number(item.ListNo) },
        } : {}),
      });
    }

    await audit(wfQuery, bookId, 'SYNC_FROM_WINSPEED', null, initialStatus, req.user.sub, `${docNos} (${items.length} รายการ)`);
    notifyPriceBookUpdated({ bookId, action: 'sync_from_winspeed' });
    res.json({ ok: true, priceBookId: bookId, lineCount: items.length, status: initialStatus, name: bookName });
  } catch (e) { console.error('[pricebook/sync-from-winspeed]', e); res.status(e.status || 500).json({ message: e.message, code: e.code, details: e.details }); }
});

// GET /api/pricebook/:id — book + lines + audit
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid id' });
    // The detail keeps active price master data, but its audit history is
    // bounded. Read the policy before the reconcile step, which may write.
    let window;
    try { window = await require('../services/global-data-window-store').readGlobalDataWindow(); }
    catch { return res.status(503).json({ code:'DATA_WINDOW_UNAVAILABLE', message:'ไม่สามารถตรวจวันเริ่มข้อมูลได้' }); }
    await reconcileFromWinSpeed({ bookId: id });
    const syncCols = await hasSyncColumns();
    const pbCols = syncCols ? ', SourceSetPriceIds, WinSpeedSyncAt' : '';
    const book = (await wfQuery(`
      SELECT Id, Name, EffectiveMonth,
             CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
             CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo,
             Status, Note, CreatedBy, ApprovedBy, ActivatedBy, CreatedAt, ApprovedAt, ActivatedAt${pbCols}
      FROM wf.PriceBook WHERE Id=@id
    `, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Price Book' });

    const lines = (await wfQuery(`
      SELECT l.Id, l.GoodId,
             COALESCE(${syncCols ? 'l.GoodCode,' : ''} g.GoodCode) AS GoodCode,
             COALESCE(NULLIF(l.GoodName, ''), g.GoodName1) AS GoodName,
             COALESCE(${syncCols ? 'l.GoodGroupId,' : ''} g.GoodGroupID) AS GoodGroupId,
             COALESCE(${syncCols ? 'l.GoodGroupName,' : ''} gg.GoodGroupName) AS GoodGroupName,
             l.Unit, l.Price, l.LineStatus, l.Note
             ${syncCols ? ', l.WinSpeedSetPriceId, l.WinSpeedListNo, l.UpdatedAt' : ''}
      FROM wf.PriceBookLine l
      LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON CAST(g.GoodID AS NVARCHAR(20)) = l.GoodId
      LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = g.GoodGroupID
      WHERE l.PriceBookId = @id
      ORDER BY COALESCE(${syncCols ? 'l.GoodGroupId,' : ''} g.GoodGroupID, 9999), COALESCE(NULLIF(l.GoodName, ''), g.GoodName1, l.GoodId)
    `, { id: { type: sql.Int, value: id } })).recordset;

    const auditRows = (await wfQuery(`
      SELECT a.Action, a.FromStatus, a.ToStatus, u.DisplayName AS ByName, a.Note, a.At
      FROM wf.PriceBookAudit a LEFT JOIN wf.AppUser u ON u.Id=a.ByUser
      WHERE a.PriceBookId=@id AND a.At >= @globalStartUtc ORDER BY a.At DESC`,
      { id: { type: sql.Int, value: id }, globalStartUtc: { type: sql.DateTime2, value: window.utcInstant } })).recordset;
    res.json({ ...book, lines, audit: auditRows });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/pricebook — สร้างชุดราคาใหม่ (DRAFT หรือ ACTIVE + Auto-Sync WinSpeed + ห้ามช่วงวันและสินค้าทับซ้อน)
router.post('/', requirePricingManage, async (req, res) => {
  try {
    const {
      name,
      effectiveMonth,
      effectiveFrom,
      effectiveTo,
      note,
      seedFromCurrent = true,
      status = 'DRAFT',
    } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ message: 'name จำเป็น' });
    const cleanFrom = parseDateOnly(effectiveFrom);
    const cleanTo = parseDateOnly(effectiveTo);
    if (!cleanFrom || !cleanTo) {
      return res.status(400).json({ message: 'กรุณาระบุวันที่เริ่มต้นและวันที่สิ้นสุด' });
    }
    if (cleanFrom > cleanTo) {
      return res.status(400).json({ message: 'วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด' });
    }
    const initialStatus = String(status || 'DRAFT').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'DRAFT';
    const monthStr = effectiveMonth || cleanFrom.slice(0, 7);
    const result = await wfTransaction(async tx => {
    const query = txQuery(tx);
    const syncReady = await hasSyncColumns(query);

    let seedLines = [];
    if (seedFromCurrent) {
      const cur = (await query(`
        SELECT TOP 1 Id
        FROM wf.PriceBook
        WHERE Status = 'ACTIVE'
        ORDER BY COALESCE(EffectiveTo, EffectiveFrom, CAST(EffectiveMonth + '-01' AS DATE)) DESC, Id DESC
      `)).recordset?.[0];
      if (cur) {
        seedLines = (await query(`
          SELECT GoodId, GoodName, Unit, Price, LineStatus, Note
                 ${syncReady ? ', GoodCode, GoodGroupId, GoodGroupName' : ''}
          FROM wf.PriceBookLine
          WHERE PriceBookId = @src
        `, { src: { type: sql.Int, value: cur.Id } })).recordset || [];
      }
    }

    const activeSeedLines = seedLines.filter(l => String(l.LineStatus || 'ACTIVE').toUpperCase() !== 'SUSPENDED');
    await assertNoPriceOverlap({
      effectiveFrom: cleanFrom,
      effectiveTo: cleanTo,
      goodIds: activeSeedLines.map(l => l.GoodId),
      queryFn: query,
    });

    if (initialStatus === 'ACTIVE' && activeSeedLines.length > 0) {
      await assertPricesAboveCost({
        lines: activeSeedLines.map(l => ({
          goodId: l.GoodId,
          goodCode: l.GoodCode,
          goodName: l.GoodName,
          pricePerTon: l.Price,
        })),
        asOfDate: cleanFrom,
        queryFn: query,
      });
    }

    const now = new Date();
    const r = await query(`
      INSERT INTO wf.PriceBook (Name, EffectiveMonth, EffectiveFrom, EffectiveTo, Status, Note, CreatedBy, ApprovedBy, ApprovedAt, ActivatedBy, ActivatedAt)
      OUTPUT inserted.Id
      VALUES (@n, @m, @ef, @et, @st, @note, @u, @appBy, @appAt, @actBy, @actAt)
    `, {
      n: { type: sql.NVarChar(120), value: String(name).trim().slice(0, 120) },
      m: { type: sql.Char(7), value: monthStr },
      ef: { type: sql.Date, value: cleanFrom },
      et: { type: sql.Date, value: cleanTo },
      st: { type: sql.VarChar(20), value: initialStatus },
      note: { type: sql.NVarChar(500), value: note || null },
      u: { type: sql.Int, value: req.user.sub },
      appBy: { type: sql.Int, value: initialStatus === 'ACTIVE' ? req.user.sub : null },
      appAt: { type: sql.DateTime2, value: initialStatus === 'ACTIVE' ? now : null },
      actBy: { type: sql.Int, value: initialStatus === 'ACTIVE' ? req.user.sub : null },
      actAt: { type: sql.DateTime2, value: initialStatus === 'ACTIVE' ? now : null },
    });
    const bookId = r.recordset[0].Id;

    for (const l of seedLines) {
      await query(`
        INSERT INTO wf.PriceBookLine (
          PriceBookId, GoodId, GoodName, Unit, Price, LineStatus, Note
          ${syncReady ? ', GoodCode, GoodGroupId, GoodGroupName' : ''}
        )
        VALUES (
          @newId, @g, @gn, @u, @p, @ls, @note
          ${syncReady ? ', @gc, @ggId, @ggName' : ''}
        )
      `, {
        newId: { type: sql.Int, value: bookId },
        g: { type: sql.NVarChar(20), value: String(l.GoodId) },
        gn: { type: sql.NVarChar(200), value: l.GoodName || '' },
        u: { type: sql.NVarChar(30), value: l.Unit || 'ตัน' },
        p: { type: sql.Decimal(12, 2), value: l.Price != null ? Number(l.Price) : null },
        ls: { type: sql.VarChar(20), value: l.LineStatus || 'ACTIVE' },
        note: { type: sql.NVarChar(255), value: l.Note || null },
        ...(syncReady ? {
          gc: { type: sql.NVarChar(50), value: l.GoodCode || null },
          ggId: { type: sql.Int, value: l.GoodGroupId != null ? Number(l.GoodGroupId) : null },
          ggName: { type: sql.NVarChar(100), value: l.GoodGroupName || null },
        } : {}),
      });
    }

    let syncResult = { synced: false };
    if (initialStatus === 'ACTIVE') {
      syncResult = await syncBookToWinSpeed(bookId, req.user.sub, null, tx);
    }

    await audit(query, bookId, 'CREATE', null, initialStatus, req.user.sub, `${note || name}${syncResult.docuNo ? ` · WinSpeed: ${syncResult.docuNo}` : ''}`);
    return {
      id: bookId,
      status: initialStatus,
      winSpeedSynced: Boolean(syncResult.synced),
      docuNo: syncResult.docuNo || null,
    };
    });
    notifyPriceBookUpdated({ bookId: result.id, action: 'create', status: initialStatus });
    res.json(result);
  } catch (e) {
    console.error('[pricebook/create]', e);
    res.status(e.status || 500).json({ message: e.message, code: e.code, details: e.details });
  }
});

// PUT /api/pricebook/:id — แก้ไขหัวตารางราคา (DRAFT/APPROVED/ACTIVE) + ตรวจไม่ทับซ้อน + sync WinSpeed dates if ACTIVE
router.put('/:id', requirePricingManage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, effectiveFrom, effectiveTo, note } = req.body || {};
    const result = await wfTransaction(async tx => {
    const query = txQuery(tx);
    const book = (await query(`
      SELECT Id, Name, Status, EffectiveMonth, SourceSetPriceIds, Note,
             CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
             CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo
      FROM wf.PriceBook WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id
    `, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) throw Object.assign(new Error('ไม่พบ Price Book'), { status: 404 });
    if (book.Status === 'ARCHIVED') throw Object.assign(new Error('ไม่สามารถแก้ไข Price Book ที่เก็บเข้าคลังแล้ว'), { status: 400 });

    const cleanFrom = effectiveFrom ? parseDateOnly(effectiveFrom) : book.EffectiveFrom;
    const cleanTo = effectiveTo ? parseDateOnly(effectiveTo) : (book.EffectiveTo || cleanFrom);
    if (cleanFrom && cleanTo && cleanFrom > cleanTo) {
      throw Object.assign(new Error('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด'), { status: 400 });
    }
    const cleanName = name != null && String(name).trim() ? String(name).trim() : book.Name;
    const nextMonth = cleanFrom ? cleanFrom.slice(0, 7) : book.EffectiveMonth;

    if (cleanFrom && cleanTo) {
      const activeLines = (await query(`
        SELECT GoodId FROM wf.PriceBookLine
        WHERE PriceBookId = @id AND ISNULL(LineStatus, 'ACTIVE') <> 'SUSPENDED'
      `, { id: { type: sql.Int, value: id } })).recordset || [];
      await assertNoPriceOverlap({
        excludeBookId: id,
        excludeSetIds: await resolveBookWinSpeedSetIds(book, query, { strict: true }),
        effectiveFrom: cleanFrom,
        effectiveTo: cleanTo,
        goodIds: activeLines.map(l => l.GoodId),
        queryFn: query,
      });
    }

    await query(`
      UPDATE wf.PriceBook
      SET Name = @n,
          EffectiveMonth = @m,
          EffectiveFrom = COALESCE(@ef, EffectiveFrom),
          EffectiveTo = COALESCE(@et, EffectiveTo),
          Note = @note
      WHERE Id = @id
    `, {
      id: { type: sql.Int, value: id },
      n: { type: sql.NVarChar(120), value: cleanName },
      m: { type: sql.Char(7), value: nextMonth },
      ef: { type: sql.Date, value: cleanFrom },
      et: { type: sql.Date, value: cleanTo },
      note: { type: sql.NVarChar(500), value: note ?? book.Note ?? null },
    });

    let syncResult = { synced: false };
    if (book.Status === 'ACTIVE') {
      syncResult = await syncBookToWinSpeed(id, req.user.sub, null, tx);
    }
    await audit(query, id, 'UPDATE_HEADER', book.Status, book.Status, req.user.sub, `${cleanName}${syncResult.synced ? ' (Auto-Synced WinSpeed)' : ''}`);
    return { ok: true, winSpeedSynced: Boolean(syncResult.synced) };
    });
    notifyPriceBookUpdated({ bookId: id, action: 'update_header' });
    res.json(result);
  } catch (e) {
    console.error('[pricebook/update-header]', e);
    res.status(e.status || 500).json({ message: e.message, code: e.code, details: e.details });
  }
});

// POST /api/pricebook/:id/lines — แทนที่รายการทั้งเล่ม (อนุญาต DRAFT, APPROVED, ACTIVE + Sync กลับ WinSpeed!)
router.post('/:id/lines', requirePricingManage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { lines } = req.body || {};
    if (!Array.isArray(lines)) return res.status(400).json({ message: 'lines (array) จำเป็น' });
    const result = await wfTransaction(async tx => {
    const query = txQuery(tx);
    const syncReady = await hasSyncColumns(query);

    const book = (await query(`
      SELECT Id, Name, Status, EffectiveMonth,
             CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
             CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo
             ${syncReady ? ', SourceSetPriceIds' : ''}
      FROM wf.PriceBook WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id
    `, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) throw Object.assign(new Error('ไม่พบ Price Book'), { status: 404 });
    if (book.Status === 'ARCHIVED') throw Object.assign(new Error('ไม่สามารถแก้ไข Price Book ที่เก็บเข้าคลังแล้ว'), { status: 409 });

    const validatedLines = [];
    for (const l of lines) {
      if (!l.goodId) throw Object.assign(new Error('ทุก line ต้องมี goodId'), { status: 400 });
      const lineStatus = ['ACTIVE', 'DISCONTINUING', 'SUSPENDED'].includes(String(l.lineStatus || '').toUpperCase())
        ? String(l.lineStatus).toUpperCase()
        : 'ACTIVE';
      const linePrice = lineStatus === 'SUSPENDED' ? null : Number(l.price);
      if (lineStatus !== 'SUSPENDED' && (!Number.isFinite(linePrice) || linePrice <= 0)) {
        throw Object.assign(new Error(`สินค้า ${l.goodName || l.goodId}: ต้องระบุราคาขายมากกว่า 0`), { status: 400 });
      }
      validatedLines.push({
        goodId: String(l.goodId),
        goodCode: l.goodCode || null,
        goodName: l.goodName || '',
        unit: l.unit || 'ตัน',
        price: linePrice,
        lineStatus,
        note: l.note || null,
        winSpeedSetPriceId: l.winSpeedSetPriceId || null,
        winSpeedListNo: l.winSpeedListNo || null,
      });
    }
    if (new Set(validatedLines.map(line => line.goodId)).size !== validatedLines.length) {
      throw Object.assign(new Error('สินค้าในตารางราคาซ้ำกัน'), { status: 400, code: 'DUPLICATE_PRICE_PRODUCT' });
    }

    // Check confidential Cost Floor on all active priced items!
    const activeValidated = validatedLines.filter(v => v.lineStatus !== 'SUSPENDED');
    await assertPricesAboveCost({
      lines: activeValidated,
      asOfDate: book.EffectiveFrom || getBangkokDateString(),
      queryFn: query,
    });

    if (book.EffectiveFrom || book.EffectiveTo) {
      await assertNoPriceOverlap({
        excludeBookId: id,
        excludeSetIds: await resolveBookWinSpeedSetIds(book, query, { strict: true }),
        effectiveFrom: book.EffectiveFrom || `${book.EffectiveMonth}-01`,
        effectiveTo: book.EffectiveTo || book.EffectiveFrom || `${book.EffectiveMonth}-01`,
        goodIds: activeValidated.map(v => v.goodId),
        queryFn: query,
      });
    }

    // Preserve existing WinSpeed links when replacing rows
    const prevMap = new Map();
    if (syncReady) {
      const prevRows = (await query(`SELECT GoodId, WinSpeedSetPriceId, WinSpeedListNo, GoodCode, GoodGroupId, GoodGroupName FROM wf.PriceBookLine WITH (UPDLOCK,HOLDLOCK) WHERE PriceBookId=@id`, { id: { type: sql.Int, value: id } })).recordset || [];
      for (const pr of prevRows) prevMap.set(String(pr.GoodId), pr);
      if (book.Status === 'ACTIVE' && prevRows.some(pr => !validatedLines.some(line => line.goodId === String(pr.GoodId)))) {
        throw Object.assign(new Error('กรุณาเปลี่ยนสถานะสินค้าที่นำออกเป็นงดขายก่อน'), { status: 409, code: 'PRICE_LINE_REMOVAL_REQUIRES_SUSPEND' });
      }
    }

    await query(`DELETE FROM wf.PriceBookLine WHERE PriceBookId=@id`, { id: { type: sql.Int, value: id } });
    for (const v of validatedLines) {
      const prev = prevMap.get(v.goodId);
      await query(`
        INSERT INTO wf.PriceBookLine (
          PriceBookId, GoodId, GoodName, Unit, Price, LineStatus, Note
          ${syncReady ? ', GoodCode, GoodGroupId, GoodGroupName, WinSpeedSetPriceId, WinSpeedListNo' : ''}
        )
        SELECT @b, @g, COALESCE(NULLIF(@n, ''), gm.GoodName1, ''), @u, @p, @ls, @note
               ${syncReady ? ', COALESCE(@gc, gm.GoodCode), gm.GoodGroupID, gg.GoodGroupName, @wsSid, @wsLno' : ''}
        FROM (SELECT 1 AS dummy) d
        LEFT JOIN dbo.EMGood gm WITH (NOLOCK) ON CAST(gm.GoodID AS NVARCHAR(20)) = @g
        LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = gm.GoodGroupID
      `, {
        b: { type: sql.Int, value: id },
        g: { type: sql.NVarChar(20), value: v.goodId },
        n: { type: sql.NVarChar(200), value: v.goodName || '' },
        u: { type: sql.NVarChar(30), value: v.unit },
        p: { type: sql.Decimal(12, 2), value: v.price },
        ls: { type: sql.VarChar(20), value: v.lineStatus },
        note: { type: sql.NVarChar(255), value: v.note },
        ...(syncReady ? {
          gc: { type: sql.NVarChar(50), value: v.goodCode || prev?.GoodCode || null },
          wsSid: { type: sql.Int, value: prev?.WinSpeedSetPriceId ?? null },
          wsLno: { type: sql.SmallInt, value: prev?.WinSpeedListNo ?? null },
        } : {}),
      });
    }

    let syncResult = { synced: false };
    if (book.Status === 'ACTIVE') {
      syncResult = await syncBookToWinSpeed(id, req.user.sub, null, tx);
    }

    await audit(query, id, 'EDIT_LINES', book.Status, book.Status, req.user.sub, `${lines.length} รายการ${syncResult.synced ? ` · Auto-Sync WinSpeed (${syncResult.upserted} อัปเดต)` : ''}`);
    return { ok: true, count: lines.length, winSpeedSynced: Boolean(syncResult.synced), syncSummary: syncResult };
    });
    notifyPriceBookUpdated({ bookId: id, action: 'edit_lines' });
    res.json(result);
  } catch (e) {
    console.error('[pricebook/lines]', e);
    res.status(e.status || 500).json({ message: e.message, code: e.code, details: e.details });
  }
});

// PATCH /api/pricebook/:id/lines/:lineId — แก้ไขราคา/สถานะรายบรรทัด + Sync กลับ WinSpeed ทันที
router.patch('/:id/lines/:lineId', requirePricingManage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    const { price, lineStatus, note, syncToWinSpeed = true } = req.body || {};
    const result = await wfTransaction(async tx => {
    const query = txQuery(tx);
    const syncReady = await hasSyncColumns(query);
    const book = (await query(`
      SELECT Id, Name, Status, EffectiveMonth,
             CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
             CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo
             ${syncReady ? ', SourceSetPriceIds' : ''}
      FROM wf.PriceBook WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id
    `, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) throw Object.assign(new Error('ไม่พบ Price Book'), { status: 404 });
    if (book.Status === 'ARCHIVED') throw Object.assign(new Error('ไม่สามารถแก้ไข Price Book ที่เก็บเข้าคลังแล้ว'), { status: 409 });
    if (book.Status === 'ACTIVE' && !syncToWinSpeed) throw Object.assign(new Error('ตารางราคาที่ใช้งานต้อง sync กับ WinSpeed'), { status: 409, code: 'PRICE_SYNC_REQUIRED' });

    const existingLine = (await query(`
      SELECT Id, GoodId, GoodName, Unit, Price, LineStatus, Note
             ${syncReady ? ', GoodCode, GoodGroupId, WinSpeedSetPriceId, WinSpeedListNo' : ''}
      FROM wf.PriceBookLine WITH (UPDLOCK,HOLDLOCK) WHERE Id=@lid AND PriceBookId=@id
    `, { lid: { type: sql.Int, value: lineId }, id: { type: sql.Int, value: id } })).recordset[0];
    if (!existingLine) throw Object.assign(new Error('ไม่พบรายการสินค้าในตารางราคา'), { status: 404 });

    const nextStatus = lineStatus !== undefined
      ? (['ACTIVE', 'DISCONTINUING', 'SUSPENDED'].includes(String(lineStatus).toUpperCase()) ? String(lineStatus).toUpperCase() : existingLine.LineStatus)
      : existingLine.LineStatus;
    const nextPrice = nextStatus === 'SUSPENDED'
      ? null
      : (price !== undefined ? Number(price) : Number(existingLine.Price));

    if (nextStatus !== 'SUSPENDED' && (!Number.isFinite(nextPrice) || nextPrice <= 0)) {
      throw Object.assign(new Error('ราคาขายต้องมากกว่า 0'), { status: 400 });
    }

    if (nextStatus !== 'SUSPENDED') {
      await assertPricesAboveCost({
        lines: [{ goodId: existingLine.GoodId, goodCode: existingLine.GoodCode, goodName: existingLine.GoodName, pricePerTon: nextPrice }],
        asOfDate: book.EffectiveFrom || getBangkokDateString(),
        queryFn: query,
      });
      if (book.EffectiveFrom || book.EffectiveTo) {
        await assertNoPriceOverlap({
          excludeBookId: id,
          excludeSetIds: await resolveBookWinSpeedSetIds(book, query, { strict: true }),
          effectiveFrom: book.EffectiveFrom || `${book.EffectiveMonth}-01`,
          effectiveTo: book.EffectiveTo || book.EffectiveFrom || `${book.EffectiveMonth}-01`,
          goodIds: [existingLine.GoodId],
          queryFn: query,
        });
      }
    }

    await query(`
      UPDATE wf.PriceBookLine
      SET Price = @p,
          LineStatus = @ls,
          Note = @note
          ${syncReady ? ', UpdatedAt = GETUTCDATE()' : ''}
      WHERE Id = @lid AND PriceBookId = @id
    `, {
      p: { type: sql.Decimal(12, 2), value: nextPrice },
      ls: { type: sql.VarChar(20), value: nextStatus },
      note: { type: sql.NVarChar(255), value: note !== undefined ? (note || null) : existingLine.Note },
      lid: { type: sql.Int, value: lineId },
      id: { type: sql.Int, value: id },
    });

    let syncResult = { synced: false };
    if (syncToWinSpeed && book.Status === 'ACTIVE') {
      syncResult = await syncBookToWinSpeed(id, req.user.sub, new Set([String(existingLine.GoodId)]), tx);
    }

    await audit(query, id, 'EDIT_LINE', book.Status, book.Status, req.user.sub,
      `${existingLine.GoodName}: ${existingLine.Price ?? 'งดขาย'} -> ${nextStatus === 'SUSPENDED' ? 'งดขาย' : nextPrice}${syncResult.synced ? ' (Auto-Sync WinSpeed)' : ''}`);
    return { ok: true, lineId, price: nextPrice, lineStatus: nextStatus, winSpeedSynced: Boolean(syncResult.synced) };
    });
    notifyPriceBookUpdated({ bookId: id, action: 'edit_line', lineId });
    res.json(result);
  } catch (e) {
    console.error('[pricebook/edit-line]', e);
    res.status(e.status || 500).json({ message: e.message, code: e.code, details: e.details });
  }
});

// POST /api/pricebook/:id/lines/item — เพิ่มหรืออัปเดตสินค้า 1 สูตร + Sync กลับ WinSpeed
router.post('/:id/lines/item', requirePricingManage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { goodId, goodCode, goodName, unit = 'ตัน', price, lineStatus = 'ACTIVE', note } = req.body || {};
    if (!goodId) return res.status(400).json({ message: 'กรุณาเลือกสูตรสินค้า' });
    const result = await wfTransaction(async tx => {
    const query = txQuery(tx);
    const syncReady = await hasSyncColumns(query);
    const book = (await query(`
      SELECT Id, Name, Status, EffectiveMonth, Note,
             CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
             CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo
             ${syncReady ? ', SourceSetPriceIds' : ''}
      FROM wf.PriceBook WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id
    `, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) throw Object.assign(new Error('ไม่พบ Price Book'), { status: 404 });
    if (book.Status === 'ARCHIVED') throw Object.assign(new Error('ไม่สามารถแก้ไข Price Book ที่เก็บเข้าคลังแล้ว'), { status: 409 });

    const nextStatus = ['ACTIVE', 'DISCONTINUING', 'SUSPENDED'].includes(String(lineStatus).toUpperCase())
      ? String(lineStatus).toUpperCase()
      : 'ACTIVE';
    const nextPrice = nextStatus === 'SUSPENDED' ? null : Number(price);
    if (nextStatus !== 'SUSPENDED' && (!Number.isFinite(nextPrice) || nextPrice <= 0)) {
      throw Object.assign(new Error('ราคาขายต้องมากกว่า 0'), { status: 400 });
    }

    if (nextStatus !== 'SUSPENDED') {
      await assertPricesAboveCost({
        lines: [{ goodId, goodCode, goodName, pricePerTon: nextPrice }],
        asOfDate: book.EffectiveFrom || getBangkokDateString(),
        queryFn: query,
      });
      if (book.EffectiveFrom || book.EffectiveTo) {
        await assertNoPriceOverlap({
          excludeBookId: id,
          excludeSetIds: await resolveBookWinSpeedSetIds(book, query, { strict: true }),
          effectiveFrom: book.EffectiveFrom || `${book.EffectiveMonth}-01`,
          effectiveTo: book.EffectiveTo || book.EffectiveFrom || `${book.EffectiveMonth}-01`,
          goodIds: [goodId],
          queryFn: query,
        });
      }
    }

    const existing = (await query(`SELECT Id FROM wf.PriceBookLine WITH (UPDLOCK,HOLDLOCK) WHERE PriceBookId=@id AND GoodId=@g`, {
      id: { type: sql.Int, value: id },
      g: { type: sql.NVarChar(20), value: String(goodId) },
    })).recordset[0];

    if (existing) {
      await query(`
        UPDATE wf.PriceBookLine SET Price=@p, LineStatus=@ls, Note=@note${syncReady ? ', UpdatedAt=GETUTCDATE()' : ''} WHERE Id=@lid
      `, {
        p: { type: sql.Decimal(12, 2), value: nextPrice },
        ls: { type: sql.VarChar(20), value: nextStatus },
        note: { type: sql.NVarChar(255), value: note || null },
        lid: { type: sql.Int, value: existing.Id },
      });
    } else {
      await query(`
        INSERT INTO wf.PriceBookLine (PriceBookId, GoodId, GoodName, Unit, Price, LineStatus, Note${syncReady ? ', GoodCode, GoodGroupId, GoodGroupName' : ''})
        SELECT @b, @g, COALESCE(NULLIF(@n, ''), gm.GoodName1, ''), @u, @p, @ls, @note${syncReady ? ', COALESCE(@gc, gm.GoodCode), gm.GoodGroupID, gg.GoodGroupName' : ''}
        FROM (SELECT 1 AS dummy) d
        LEFT JOIN dbo.EMGood gm WITH (NOLOCK) ON CAST(gm.GoodID AS NVARCHAR(20)) = @g
        LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = gm.GoodGroupID
      `, {
        b: { type: sql.Int, value: id },
        g: { type: sql.NVarChar(20), value: String(goodId) },
        n: { type: sql.NVarChar(200), value: goodName || '' },
        u: { type: sql.NVarChar(30), value: unit },
        p: { type: sql.Decimal(12, 2), value: nextPrice },
        ls: { type: sql.VarChar(20), value: nextStatus },
        note: { type: sql.NVarChar(255), value: note || null },
        ...(syncReady ? { gc: { type: sql.NVarChar(50), value: goodCode || null } } : {}),
      });
    }

    let syncResult = { synced: false };
    if (book.Status === 'ACTIVE') {
      syncResult = await syncBookToWinSpeed(id, req.user.sub, new Set([String(goodId)]), tx);
    }

    await audit(query, id, existing ? 'EDIT_LINE' : 'ADD_LINE', book.Status, book.Status, req.user.sub,
      `${goodName || goodId}: ${nextStatus === 'SUSPENDED' ? 'งดขาย' : nextPrice}${syncResult.synced ? ' (Auto-Sync WinSpeed)' : ''}`);
    return { response: { ok: true, winSpeedSynced: Boolean(syncResult.synced) }, action: existing ? 'edit_line' : 'add_line' };
    });
    notifyPriceBookUpdated({ bookId: id, action: result.action });
    res.json(result.response);
  } catch (e) {
    console.error('[pricebook/add-item]', e);
    res.status(e.status || 500).json({ message: e.message, code: e.code, details: e.details });
  }
});

// POST /api/pricebook/:id/sync-to-winspeed — บังคับ Sync ตารางราคาทั้งหมดจาก PriceBook ไปยัง WinSpeed
router.post('/:id/sync-to-winspeed', requirePricingManage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await syncBookToWinSpeed(id, req.user.sub);
    if (!result.synced) {
      return res.status(400).json({ message: 'ไม่สามารถ Sync ไปยัง WinSpeed ได้ (โปรดตรวจ Migration 186)' });
    }
    // syncBookToWinSpeed commits its audit together with the native updates.
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[pricebook/sync-to-winspeed]', e);
    res.status(e.status || 500).json({ message: e.message });
  }
});

// approve | activate | archive
for (const [action, fromStatuses, toStatus, col] of [
  ['approve',  ['DRAFT'],            'APPROVED', 'ApprovedBy'],
  ['activate', ['APPROVED', 'DRAFT'],'ACTIVE',   'ActivatedBy'],
  ['archive',  ['ACTIVE','APPROVED','DRAFT'], 'ARCHIVED', null],
]) {
  router.post(`/:id/${action}`, requirePricingManage, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const result = await wfTransaction(async tx => {
      const query = txQuery(tx);
      const syncReady = await hasSyncColumns(query);
      const book = (await query(`
        SELECT Id, Name, Status, EffectiveMonth, Note,
               CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
               CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo
               ${syncReady ? ', SourceSetPriceIds' : ''}
        FROM wf.PriceBook WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id
      `, { id: { type: sql.Int, value: id } })).recordset[0];
      if (!book) throw Object.assign(new Error('ไม่พบ Price Book'), { status: 404 });
      if (!fromStatuses.includes(book.Status)) {
        throw Object.assign(new Error(`ต้องเป็น ${fromStatuses.join(' หรือ ')} (ปัจจุบัน: ${book.Status})`), { status: 409 });
      }
      if (toStatus === 'ACTIVE') {
        const lines = (await query(`SELECT GoodId, GoodName, Price, LineStatus FROM wf.PriceBookLine WITH (UPDLOCK,HOLDLOCK) WHERE PriceBookId=@id`, { id: { type: sql.Int, value: id } })).recordset || [];
        const activeLines = lines.filter(l => l.LineStatus !== 'SUSPENDED');
        await assertPricesAboveCost({
          lines: activeLines.map(l => ({ goodId: l.GoodId, goodName: l.GoodName, pricePerTon: l.Price })),
          asOfDate: book.EffectiveFrom || getBangkokDateString(),
          queryFn: query,
        });
        await assertNoPriceOverlap({
          excludeBookId: id,
          excludeSetIds: await resolveBookWinSpeedSetIds(book, query, { strict: true }),
          effectiveFrom: book.EffectiveFrom || `${book.EffectiveMonth}-01`,
          effectiveTo: book.EffectiveTo || book.EffectiveFrom || `${book.EffectiveMonth}-01`,
          goodIds: activeLines.map(l => l.GoodId),
          queryFn: query,
        });
      }
      const setCol = col ? `, ${col}=@uid, ${col.replace('By','At')}=GETUTCDATE()` : '';
      const __r = await query(`UPDATE wf.PriceBook SET Status=@s ${setCol} WHERE Id=@id`, {
        s: { type: sql.VarChar(20), value: toStatus },
        uid: { type: sql.Int, value: req.user.sub },
        id: { type: sql.Int, value: id },
      });
      if (!__r.rowsAffected[0]) throw Object.assign(new Error('ไม่พบรายการที่ระบุ'), { status: 404 });

      let syncResult = { synced: false };
      if (toStatus === 'ACTIVE') {
        syncResult = await syncBookToWinSpeed(id, req.user.sub, null, tx);
      }

      await audit(query, id, action.toUpperCase(), book.Status, toStatus, req.user.sub, req.body?.note || (syncResult.synced ? 'Auto-Synced WinSpeed' : null));
      return { ok: true, status: toStatus, winSpeedSynced: Boolean(syncResult.synced), docuNo: syncResult.docuNo || null };
      });
      notifyPriceBookUpdated({ bookId: id, action, status: toStatus });
      res.json(result);
    } catch (e) {
      console.error(e);
      res.status(e.status || 500).json({ message: e.message, code: e.code, details: e.details });
    }
  });
}

// ── Special Price Per Customer ───────────────────────────────────────────────

// GET /api/pricebook/:id/special
router.get('/:id/special', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = (await wfQuery(`
      SELECT sp.*, ru.DisplayName AS RequestedByName, au.DisplayName AS ApprovedByName
      FROM wf.PriceBookSpecialPrice sp
      LEFT JOIN wf.AppUser ru ON ru.Id = sp.RequestedBy
      LEFT JOIN wf.AppUser au ON au.Id = sp.ApprovedBy
      WHERE sp.PriceBookId = @id
      ORDER BY CASE WHEN sp.ApprovedPrice IS NULL THEN 0 ELSE 1 END, sp.Id DESC`,
      { id: { type: sql.Int, value: id } })).recordset;
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/pricebook/:id/special — บันทึกคำขอราคาพิเศษ (ตรวจเส้นขั้นต่ำ + ไม่แจ้งว่าเป็นราคาทุน)
router.post('/:id/special', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { custId, custName, goodId, goodName, requestedPrice, note } = req.body || {};
    if (!custId) return res.status(400).json({ message: 'ต้องระบุ custId (รหัสลูกค้า)' });
    const book = (await wfQuery(`SELECT Id, CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom FROM wf.PriceBook WHERE Id=@id`, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Price Book' });

    if (requestedPrice != null && requestedPrice !== '' && goodId) {
      const rp = Number(requestedPrice);
      if (!Number.isFinite(rp) || rp <= 0) {
        return res.status(400).json({ message: 'ราคาขอพิเศษต้องมากกว่า 0' });
      }
      await assertPricesAboveCost({
        lines: [{ goodId, goodName, pricePerTon: rp }],
        asOfDate: book.EffectiveFrom || getBangkokDateString(),
      });
    }

    const r = await wfQuery(`
      INSERT INTO wf.PriceBookSpecialPrice (PriceBookId, CustId, CustName, GoodId, GoodName, RequestedPrice, Note, RequestedBy)
      OUTPUT inserted.Id
      VALUES (@pb, @cid, @cnm, @gid, @gnm, @rp, @note, @uid)`, {
      pb: { type: sql.Int, value: id },
      cid: { type: sql.NVarChar(20), value: String(custId) },
      cnm: { type: sql.NVarChar(200), value: custName || null },
      gid: { type: sql.NVarChar(20), value: goodId ? String(goodId) : null },
      gnm: { type: sql.NVarChar(200), value: goodName || null },
      rp: { type: sql.Decimal(12, 2), value: requestedPrice != null && requestedPrice !== '' ? Number(requestedPrice) : null },
      note: { type: sql.NVarChar(300), value: note || null },
      uid: { type: sql.Int, value: req.user.sub },
    });
    res.json({ id: r.recordset[0].Id });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message, code: e.code, details: e.details }); }
});

// PATCH /api/pricebook/special/:spId — อนุมัติราคาพิเศษ + Sync กลับ WinSpeed + บล็อกหากต่ำกว่า Cost
router.patch('/special/:spId', requireRole(...SPECIAL_APPROVE_ROLES), async (req, res) => {
  try {
    const spId = Number(req.params.spId);
    const { approvedPrice } = req.body || {};
    if (approvedPrice == null || !Number.isFinite(Number(approvedPrice)) || Number(approvedPrice) <= 0) {
      return res.status(400).json({ message: 'ต้องระบุราคาอนุมัติ (approvedPrice > 0)' });
    }
    const result = await wfTransaction(async tx => {
      const query = txQuery(tx);
      const sp = (await query(`
      SELECT sp.Id, sp.RequestedBy, sp.GoodId, sp.GoodName, sp.PriceBookId,
             pb.Status AS BookStatus, CONVERT(VARCHAR(10), pb.EffectiveFrom, 23) AS EffectiveFrom
      FROM wf.PriceBookSpecialPrice sp WITH (UPDLOCK,HOLDLOCK)
      JOIN wf.PriceBook pb WITH (UPDLOCK,HOLDLOCK) ON pb.Id = sp.PriceBookId
      WHERE sp.Id=@id
    `, { id: { type: sql.Int, value: spId } })).recordset[0];
    if (!sp) throw Object.assign(new Error('ไม่พบคำขอราคาพิเศษ'), { status: 404 });
    if ([Number(req.user.sub), Number(req.user.actorSub || req.user.sub)].includes(Number(sp.RequestedBy)) && req.user.role !== 'ADMIN') {
      throw Object.assign(new Error('ไม่อนุญาตให้อนุมัติคำขอของตัวเอง (ใช้บัญชีผู้อนุมัติคนอื่น)'), { status: 403 });
    }

    if (sp.GoodId) {
      await assertPricesAboveCost({
        lines: [{ goodId: sp.GoodId, goodName: sp.GoodName, pricePerTon: Number(approvedPrice) }],
        asOfDate: sp.EffectiveFrom || getBangkokDateString(),
        queryFn: query,
      });
    }

    const __r = await query(`
      UPDATE wf.PriceBookSpecialPrice SET ApprovedPrice=@p, ApprovedBy=@uid, ApprovedAt=GETUTCDATE() WHERE Id=@id`, {
      id: { type: sql.Int, value: spId },
      p: { type: sql.Decimal(12, 2), value: Number(approvedPrice) },
      uid: { type: sql.Int, value: req.user.sub },
    });
    if (!__r.rowsAffected[0]) throw Object.assign(new Error('ไม่พบรายการที่ระบุ'), { status: 404 });

    const syncResult = sp.BookStatus === 'ACTIVE' ? await syncSpecialPriceToWinSpeed(spId, null, tx) : { synced: false };
    if (sp.BookStatus === 'ACTIVE' && !syncResult.synced) throw Object.assign(new Error('WinSpeed special price was not synced'), { status: 409, code: 'PRICE_SYNC_INCOMPLETE' });
    await audit(query, sp.PriceBookId, 'SPECIAL_APPROVE', sp.BookStatus, sp.BookStatus, req.user.sub, `specialId=${spId}`);
    return { id: spId, approvedPrice: Number(approvedPrice), winSpeedSynced: Boolean(syncResult.synced) };
    });
    res.json(result);
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message, code: e.code, details: e.details }); }
});

// GET /api/pricebook/:id/effective?custId= — ราคาที่ใช้จริง รวมราคาพิเศษแล้ว
router.get('/:id/effective', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isInteger(id) && id > 0) await reconcileFromWinSpeed({ bookId: id });
    const custId = req.query.custId ? String(req.query.custId) : null;
    const rows = (await wfQuery(`
      SELECT GoodId, GoodName, Unit, LineStatus, StandardPrice, SpecialPrice, EffectivePrice, Sellable
      FROM wf.v_PriceBookEffective
      WHERE PriceBookId = @id AND (@cust IS NULL OR CustId = @cust OR CustId IS NULL)
      ORDER BY GoodId`, {
      id: { type: sql.Int, value: id },
      cust: { type: sql.NVarChar(20), value: custId },
    })).recordset;
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
module.exports.__testing = {
  parseSetIds,
  syncBookToWinSpeed,
  syncSpecialPriceToWinSpeed,
  reconcileFromWinSpeed,
  assertNoPriceOverlap,
};
