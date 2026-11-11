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

async function hasSyncColumns(queryFn = wfQuery) {
  try {
    const r = await queryFn(`
      SELECT
        COL_LENGTH('wf.PriceBook', 'SourceSetPriceIds') AS HasPb,
        COL_LENGTH('wf.PriceBookLine', 'WinSpeedSetPriceId') AS HasLine,
        COL_LENGTH('wf.PriceBookSpecialPrice', 'WinSpeedSetPriceId') AS HasSp,
        OBJECT_ID('wf.sp_PriceBookUpsertWinSpeedLine', 'P') AS HasSpProc
    `);
    const row = r.recordset?.[0] || {};
    return Boolean(row.HasPb && row.HasLine && row.HasSpProc);
  } catch {
    return false;
  }
}

function parseSetIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map(s => Number(String(s).trim()))
    .filter(n => Number.isInteger(n) && n > 0);
}

/**
 * Resolves linked WinSpeed SetPriceIDs for a PriceBook.
 * If SourceSetPriceIds is empty (e.g. imported before Migration 186), matches DocuNo patterns from Name/Note.
 */
async function resolveBookWinSpeedSetIds(book, queryFn = wfQuery) {
  const existing = parseSetIds(book.SourceSetPriceIds);
  if (existing.length > 0) return existing;

  const text = `${book.Name || ''} ${book.Note || ''}`;
  const docNos = [...new Set((text.match(/(?:SPL\d{4}-\d{5}|WEB-\d{8}-\d{4})/g) || []).map(s => s.trim()))];
  if (!docNos.length) return [];

  try {
    const inParams = {};
    const ph = docNos.map((d, i) => {
      const k = `dn${i}`;
      inParams[k] = { type: sql.VarChar(25), value: d };
      return `@${k}`;
    });
    const r = await queryFn(
      `SELECT SetPriceID FROM dbo.EMSetPriceHD WITH (NOLOCK) WHERE DocuNo IN (${ph.join(',')}) ORDER BY SetPriceID`,
      inParams
    );
    const found = (r.recordset || []).map(x => Number(x.SetPriceID)).filter(n => Number.isInteger(n) && n > 0);
    if (found.length > 0 && (await hasSyncColumns(queryFn))) {
      await queryFn(`UPDATE wf.PriceBook SET SourceSetPriceIds = @s WHERE Id = @id`, {
        s: { type: sql.NVarChar(200), value: found.join(',') },
        id: { type: sql.Int, value: book.Id },
      }).catch(() => {});
    }
    return found;
  } catch {
    return [];
  }
}

async function execProc(requestSource, procName, configureFn) {
  const req = typeof requestSource.request === 'function' ? requestSource.request() : await requestSource;
  if (configureFn) configureFn(req);
  return req.execute(procName);
}

/**
 * Determines which WinSpeed SetPriceID should receive a given PriceBookLine (supporting split sets
 * such as SPL-Compound + SPL-MaePui for the same period).
 */
async function pickTargetWinSpeedSetId(queryFn, book, line, setIds) {
  if (line.WinSpeedSetPriceId) return Number(line.WinSpeedSetPriceId);
  if (!setIds || !setIds.length) return null;
  if (setIds.length === 1) return setIds[0];

  try {
    const gid = Number(line.GoodId);
    const ggRes = Number.isInteger(gid)
      ? await queryFn(`SELECT GoodGroupID FROM dbo.EMGood WITH (NOLOCK) WHERE GoodID = @gid`, { gid: { type: sql.Int, value: gid } })
      : null;
    const goodGroupId = ggRes?.recordset?.[0]?.GoodGroupID ?? line.GoodGroupId ?? null;

    const existingMatch = await queryFn(`
      SELECT TOP 1 d.SetPriceID
      FROM dbo.EMSetPriceDT d WITH (NOLOCK)
      WHERE d.SetPriceID IN (${setIds.join(',')}) AND d.ListID = @gid
    `, { gid: { type: sql.Int, value: Number.isInteger(gid) ? gid : 0 } });
    if (existingMatch.recordset?.[0]?.SetPriceID) {
      return Number(existingMatch.recordset[0].SetPriceID);
    }

    if (goodGroupId != null) {
      const groupSetMatch = await queryFn(`
        SELECT TOP 1 d.SetPriceID, COUNT(*) AS Cnt
        FROM dbo.EMSetPriceDT d WITH (NOLOCK)
        JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = d.ListID
        WHERE d.SetPriceID IN (${setIds.join(',')}) AND g.GoodGroupID = @gg
        GROUP BY d.SetPriceID
        ORDER BY Cnt DESC, d.SetPriceID ASC
      `, { gg: { type: sql.Int, value: Number(goodGroupId) } });
      if (groupSetMatch.recordset?.[0]?.SetPriceID) {
        return Number(groupSetMatch.recordset[0].SetPriceID);
      }
    }
  } catch {
    // Fallback cleanly to primary set id
  }
  return setIds[0];
}

/**
 * Syncs an ACTIVE PriceBook's lines and header dates to WinSpeed (dbo.EMSetPriceHD / DT).
 * Uses ownership-chained wf.sp_PriceBook* procedures cleanly.
 */
async function syncBookToWinSpeed(bookId, userId, onlyGoodIds = null) {
  const syncReady = await hasSyncColumns();
  if (!syncReady) return { synced: false, reason: 'SYNC_PROCS_NOT_MIGRATED' };

  const book = (await wfQuery(`
    SELECT Id, Name, EffectiveMonth, Status, SourceSetPriceIds, Note,
           CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
           CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo
    FROM wf.PriceBook WHERE Id = @id
  `, { id: { type: sql.Int, value: bookId } })).recordset[0];
  if (!book) throw Object.assign(new Error('ไม่พบ PriceBook'), { status: 404 });

  let setIds = await resolveBookWinSpeedSetIds(book);
  const beginStr = book.EffectiveFrom || `${book.EffectiveMonth}-01`;
  const endStr = book.EffectiveTo || beginStr;
  const beginDate = new Date(`${beginStr}T00:00:00`);
  const endDate = new Date(`${endStr}T00:00:00`);

  const allLines = (await wfQuery(`
    SELECT Id, GoodId, GoodCode, GoodName, GoodGroupId, Price, LineStatus, Note, WinSpeedSetPriceId, WinSpeedListNo
    FROM wf.PriceBookLine
    WHERE PriceBookId = @id
    ORDER BY Id
  `, { id: { type: sql.Int, value: bookId } })).recordset || [];

  const targetLines = onlyGoodIds
    ? allLines.filter(l => onlyGoodIds.has(String(l.GoodId)))
    : allLines;

  const { getPool } = require('../db');
  const pool = await getPool();

  // Create a new WinSpeed SetPriceHD if ACTIVE book has no linked WinSpeed sets yet
  if (setIds.length === 0) {
    const cr = await execProc(pool, 'wf.sp_PriceBookCreateWinSpeedSet', r => {
      r.input('BeginDate', sql.Date, beginDate);
      r.input('EndDate', sql.Date, endDate);
      r.input('CustID', sql.Int, null);
      r.input('Remark1', sql.VarChar(255), String(book.Name || 'Sale-App PriceBook').slice(0, 255));
      r.output('NewSetPriceID', sql.Int);
      r.output('DocuNo', sql.VarChar(25));
    });
    const newSetId = Number(cr.output?.NewSetPriceID || 0);
    if (newSetId > 0) {
      setIds = [newSetId];
      await wfQuery(`UPDATE wf.PriceBook SET SourceSetPriceIds = @s WHERE Id = @id`, {
        s: { type: sql.NVarChar(200), value: setIds.join(',') },
        id: { type: sql.Int, value: bookId },
      });
    }
  } else {
    // Sync header effective dates across linked WinSpeed sets
    for (const sid of setIds) {
      await execProc(pool, 'wf.sp_PriceBookSyncHeaderDatesToWinSpeed', r => {
        r.input('SetPriceID', sql.Int, sid);
        r.input('BeginDate', sql.Date, beginDate);
        r.input('EndDate', sql.Date, endDate);
        r.input('Remark1', sql.VarChar(255), null);
      });
    }
  }

  let upserted = 0;
  let removed = 0;

  for (const line of targetLines) {
    const gidNum = Number(line.GoodId);
    if (!Number.isInteger(gidNum) || gidNum <= 0) continue;

    const targetSetId = await pickTargetWinSpeedSetId(wfQuery, book, line, setIds);
    if (!targetSetId) continue;

    if (String(line.LineStatus || 'ACTIVE').toUpperCase() === 'SUSPENDED') {
      if (line.WinSpeedSetPriceId || setIds.length > 0) {
        const delSetId = line.WinSpeedSetPriceId ? Number(line.WinSpeedSetPriceId) : targetSetId;
        await execProc(pool, 'wf.sp_PriceBookDeleteWinSpeedLine', r => {
          r.input('SetPriceID', sql.Int, delSetId);
          r.input('ListNo', sql.SmallInt, line.WinSpeedListNo != null ? Number(line.WinSpeedListNo) : null);
          r.input('GoodID', sql.Int, gidNum);
        });
        await wfQuery(`UPDATE wf.PriceBookLine SET WinSpeedListNo = NULL, UpdatedAt = GETUTCDATE() WHERE Id = @lid`, {
          lid: { type: sql.Int, value: line.Id },
        });
        removed += 1;
      }
      continue;
    }

    if (line.Price == null || !(Number(line.Price) > 0)) continue;

    const noteMarker = line.LineStatus === 'DISCONTINUING'
      ? (line.Note ? (String(line.Note).includes('***') ? line.Note : `*** ${line.Note}`) : '***')
      : (line.Note || null);

    const up = await execProc(pool, 'wf.sp_PriceBookUpsertWinSpeedLine', r => {
      r.input('SetPriceID', sql.Int, targetSetId);
      r.input('GoodID', sql.Int, gidNum);
      r.input('GoodPriceNet', sql.Decimal(18, 4), Number(line.Price));
      r.input('BeginDate', sql.Date, beginDate);
      r.input('EndDate', sql.Date, endDate);
      r.input('Remark', sql.VarChar(255), noteMarker ? String(noteMarker).slice(0, 255) : null);
      r.input('ListNo', sql.SmallInt, line.WinSpeedListNo != null ? Number(line.WinSpeedListNo) : null);
      r.output('ListNo', sql.SmallInt);
    }).catch(async () => {
      // Handle stored proc OUTPUT parameter cleanly in mssql (output-only param definition)
      const r2 = pool.request();
      r2.input('SetPriceID', sql.Int, targetSetId);
      r2.input('GoodID', sql.Int, gidNum);
      r2.input('GoodPriceNet', sql.Decimal(18, 4), Number(line.Price));
      r2.input('BeginDate', sql.Date, beginDate);
      r2.input('EndDate', sql.Date, endDate);
      r2.input('Remark', sql.VarChar(255), noteMarker ? String(noteMarker).slice(0, 255) : null);
      r2.output('ListNo', sql.SmallInt, line.WinSpeedListNo != null ? Number(line.WinSpeedListNo) : null);
      return r2.execute('wf.sp_PriceBookUpsertWinSpeedLine');
    });

    const syncedListNo = up?.output?.ListNo ?? line.WinSpeedListNo ?? null;
    await wfQuery(`
      UPDATE wf.PriceBookLine
      SET WinSpeedSetPriceId = @sid,
          WinSpeedListNo = @lno,
          UpdatedAt = GETUTCDATE()
      WHERE Id = @lid
    `, {
      sid: { type: sql.Int, value: targetSetId },
      lno: { type: sql.SmallInt, value: syncedListNo != null ? Number(syncedListNo) : null },
      lid: { type: sql.Int, value: line.Id },
    });
    upserted += 1;
  }

  // Also sync any already-approved customer Special Prices on full sync / activate
  if (!onlyGoodIds) {
    const sps = (await wfQuery(`
      SELECT Id, CustId, GoodId, ApprovedPrice, Note, WinSpeedSetPriceId
      FROM wf.PriceBookSpecialPrice
      WHERE PriceBookId = @id AND ApprovedPrice IS NOT NULL AND ApprovedPrice > 0 AND GoodId IS NOT NULL
    `, { id: { type: sql.Int, value: bookId } })).recordset || [];
    for (const sp of sps) {
      await syncSpecialPriceToWinSpeed(sp.Id, book).catch(err => {
        console.warn('[pricebook/sync-special-warn]', err.message);
      });
    }
  }

  await wfQuery(`
    UPDATE wf.PriceBook
    SET WinSpeedSyncAt = SYSUTCDATETIME(),
        LastSyncedBy = @uid
    WHERE Id = @id
  `, { uid: { type: sql.Int, value: userId || null }, id: { type: sql.Int, value: bookId } });

  return { synced: true, setIds, upserted, removed };
}

async function syncSpecialPriceToWinSpeed(spId, knownBook = null) {
  const syncReady = await hasSyncColumns();
  if (!syncReady) return { synced: false };

  const sp = (await wfQuery(`
    SELECT sp.Id, sp.PriceBookId, sp.CustId, sp.GoodId, sp.ApprovedPrice, sp.Note, sp.WinSpeedSetPriceId,
           pb.Status AS BookStatus, pb.EffectiveMonth,
           CONVERT(VARCHAR(10), pb.EffectiveFrom, 23) AS EffectiveFrom,
           CONVERT(VARCHAR(10), pb.EffectiveTo, 23) AS EffectiveTo
    FROM wf.PriceBookSpecialPrice sp
    JOIN wf.PriceBook pb ON pb.Id = sp.PriceBookId
    WHERE sp.Id = @id
  `, { id: { type: sql.Int, value: spId } })).recordset[0];

  if (!sp || !sp.ApprovedPrice || !sp.GoodId || !sp.CustId) return { synced: false };
  const bookStatus = knownBook?.Status || sp.BookStatus;
  if (bookStatus !== 'ACTIVE') return { synced: false, reason: 'BOOK_NOT_ACTIVE' };

  const custStr = String(sp.CustId).trim();
  const isNumCust = /^\d+$/.test(custStr);
  const custRow = (await wfQuery(`
    SELECT TOP 1 CustID FROM dbo.EMCust WITH (NOLOCK)
    WHERE ${isNumCust ? 'CustID = @cid OR CustCode = @cc' : 'CustCode = @cc'}
  `, {
    cid: { type: sql.Int, value: isNumCust ? Number(custStr) : 0 },
    cc: { type: sql.VarChar(20), value: custStr },
  })).recordset?.[0];
  const canonicalCustId = Number(custRow?.CustID || (isNumCust ? Number(custStr) : 0));
  const goodNum = Number(sp.GoodId);
  if (!canonicalCustId || !Number.isInteger(goodNum)) return { synced: false };

  const beginStr = sp.EffectiveFrom || `${sp.EffectiveMonth}-01`;
  const endStr = sp.EffectiveTo || beginStr;
  const { getPool } = require('../db');
  const pool = await getPool();
  const req = pool.request();
  req.input('CustID', sql.Int, canonicalCustId);
  req.input('GoodID', sql.Int, goodNum);
  req.input('ApprovedPrice', sql.Decimal(18, 4), Number(sp.ApprovedPrice));
  req.input('BeginDate', sql.Date, new Date(`${beginStr}T00:00:00`));
  req.input('EndDate', sql.Date, new Date(`${endStr}T00:00:00`));
  req.input('Remark', sql.VarChar(255), sp.Note ? String(sp.Note).slice(0, 255) : 'ราคาพิเศษรายร้านค้า (Sale-App)');
  req.output('SetPriceID', sql.Int, sp.WinSpeedSetPriceId != null ? Number(sp.WinSpeedSetPriceId) : null);
  const r = await req.execute('wf.sp_PriceBookUpsertSpecialWinSpeedPrice');
  const syncedId = Number(r.output?.SetPriceID || 0);
  if (syncedId > 0) {
    await wfQuery(`UPDATE wf.PriceBookSpecialPrice SET WinSpeedSetPriceId = @sid WHERE Id = @id`, {
      sid: { type: sql.Int, value: syncedId },
      id: { type: sql.Int, value: spId },
    });
  }
  return { synced: true, setPriceId: syncedId };
}

// GET /api/pricebook — รายการ (used by CreateSODialog + PriceBookManager)
router.get('/', async (_req, res) => {
  try {
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

    // 5. ถ้า ACTIVE ให้ ARCHIVE เล่ม ACTIVE เดิมที่ช่วงเดือน/วันที่ทับซ้อนกัน
    if (initialStatus === 'ACTIVE') {
      await wfQuery(`
        UPDATE wf.PriceBook SET Status='ARCHIVED'
        WHERE Status='ACTIVE' AND EffectiveMonth=@m AND Id<>@id
      `, { m: { type: sql.Char(7), value: effectiveMonth }, id: { type: sql.Int, value: bookId } });
    }

    // 6. เพิ่ม wf.PriceBookLine พร้อมลิงก์ SetPriceID + ListNo ต้นทาง
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
    res.json({ ok: true, priceBookId: bookId, lineCount: items.length, status: initialStatus, name: bookName });
  } catch (e) { console.error('[pricebook/sync-from-winspeed]', e); res.status(e.status || 500).json({ message: e.message, code: e.code }); }
});

// GET /api/pricebook/:id — book + lines + audit
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid id' });
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
      WHERE a.PriceBookId=@id ORDER BY a.At DESC`, { id: { type: sql.Int, value: id } })).recordset;
    res.json({ ...book, lines, audit: auditRows });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/pricebook — สร้าง DRAFT (+ seedFromCurrent)
router.post('/', requirePricingManage, async (req, res) => {
  try {
    const { name, effectiveMonth, effectiveFrom, effectiveTo, note, seedFromCurrent = true } = req.body || {};
    if (!name) return res.status(400).json({ message: 'name จำเป็น' });
    const cleanFrom = effectiveFrom ? String(effectiveFrom).slice(0, 10) : null;
    const cleanTo = effectiveTo ? String(effectiveTo).slice(0, 10) : null;
    if (cleanFrom && cleanTo && cleanFrom > cleanTo) {
      return res.status(400).json({ message: 'วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด' });
    }
    const monthStr = effectiveMonth || (cleanFrom ? cleanFrom.slice(0, 7) : getBangkokDateString().slice(0, 7));

    const r = await wfQuery(`INSERT INTO wf.PriceBook (Name, EffectiveMonth, EffectiveFrom, EffectiveTo, Note, CreatedBy)
      OUTPUT inserted.Id VALUES (@n, @m, @ef, @et, @note, @u)`, {
      n: { type: sql.NVarChar(120), value: name },
      m: { type: sql.Char(7), value: monthStr },
      ef: { type: sql.Date, value: cleanFrom },
      et: { type: sql.Date, value: cleanTo },
      note: { type: sql.NVarChar(500), value: note || null },
      u: { type: sql.Int, value: req.user.sub },
    });
    const bookId = r.recordset[0].Id;

    if (seedFromCurrent) {
      const cur = (await wfQuery(`SELECT TOP 1 Id FROM wf.PriceBook WHERE Status='ACTIVE' AND Id<>@id ORDER BY Id DESC`, { id: { type: sql.Int, value: bookId } })).recordset[0];
      if (cur) {
        const syncReady = await hasSyncColumns();
        await wfQuery(`
          INSERT INTO wf.PriceBookLine (PriceBookId, GoodId, GoodName, Unit, Price, LineStatus, Note${syncReady ? ', GoodCode, GoodGroupId, GoodGroupName' : ''})
          SELECT @newId, GoodId, GoodName, Unit, Price, LineStatus, Note${syncReady ? ', GoodCode, GoodGroupId, GoodGroupName' : ''}
          FROM wf.PriceBookLine WHERE PriceBookId=@src`, {
          newId: { type: sql.Int, value: bookId },
          src: { type: sql.Int, value: cur.Id },
        });
      }
    }
    await audit(wfQuery, bookId, 'CREATE', null, 'DRAFT', req.user.sub, note || name);
    res.json({ id: bookId });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PUT /api/pricebook/:id — แก้ไขหัวตารางราคา (DRAFT/APPROVED/ACTIVE) + sync WinSpeed dates if ACTIVE
router.put('/:id', requirePricingManage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, effectiveFrom, effectiveTo, note } = req.body || {};
    const book = (await wfQuery(`SELECT Id, Name, Status, EffectiveMonth, SourceSetPriceIds FROM wf.PriceBook WHERE Id=@id`, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Price Book' });
    if (book.Status === 'ARCHIVED') return res.status(400).json({ message: 'ไม่สามารถแก้ไข Price Book ที่เก็บเข้าคลังแล้ว' });

    const cleanFrom = effectiveFrom ? String(effectiveFrom).slice(0, 10) : null;
    const cleanTo = effectiveTo ? String(effectiveTo).slice(0, 10) : null;
    if (cleanFrom && cleanTo && cleanFrom > cleanTo) {
      return res.status(400).json({ message: 'วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด' });
    }
    const cleanName = name != null && String(name).trim() ? String(name).trim() : book.Name;
    const nextMonth = cleanFrom ? cleanFrom.slice(0, 7) : book.EffectiveMonth;

    await wfQuery(`
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
      note: { type: sql.NVarChar(500), value: note ?? null },
    });

    let syncResult = { synced: false };
    if (book.Status === 'ACTIVE') {
      syncResult = await syncBookToWinSpeed(id, req.user.sub).catch(err => ({ synced: false, error: err.message }));
    }
    await audit(wfQuery, id, 'UPDATE_HEADER', book.Status, book.Status, req.user.sub, `${cleanName}${syncResult.synced ? ' (Synced WinSpeed)' : ''}`);
    res.json({ ok: true, winSpeedSynced: Boolean(syncResult.synced) });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/pricebook/:id/lines — แทนที่รายการทั้งเล่ม (อนุญาต DRAFT, APPROVED, ACTIVE + Sync กลับ WinSpeed!)
router.post('/:id/lines', requirePricingManage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { lines } = req.body || {};
    if (!Array.isArray(lines)) return res.status(400).json({ message: 'lines (array) จำเป็น' });
    const syncReady = await hasSyncColumns();

    const book = (await wfQuery(`
      SELECT Id, Name, Status, EffectiveMonth,
             CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
             CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo
             ${syncReady ? ', SourceSetPriceIds' : ''}
      FROM wf.PriceBook WHERE Id=@id
    `, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Price Book' });
    if (book.Status === 'ARCHIVED') return res.status(409).json({ message: 'ไม่สามารถแก้ไข Price Book ที่เก็บเข้าคลังแล้ว' });

    const validatedLines = [];
    for (const l of lines) {
      if (!l.goodId) return res.status(400).json({ message: 'ทุก line ต้องมี goodId' });
      const lineStatus = ['ACTIVE', 'DISCONTINUING', 'SUSPENDED'].includes(String(l.lineStatus || '').toUpperCase())
        ? String(l.lineStatus).toUpperCase()
        : 'ACTIVE';
      const linePrice = lineStatus === 'SUSPENDED' ? null : Number(l.price);
      if (lineStatus !== 'SUSPENDED' && (!Number.isFinite(linePrice) || linePrice <= 0)) {
        return res.status(400).json({ message: `สินค้า ${l.goodName || l.goodId}: ต้องระบุราคาขายมากกว่า 0` });
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

    // Check confidential Cost Floor on all active priced items!
    await assertPricesAboveCost({
      lines: validatedLines.filter(v => v.lineStatus !== 'SUSPENDED'),
      asOfDate: book.EffectiveFrom || getBangkokDateString(),
    });

    // Preserve existing WinSpeed links when replacing rows
    const prevMap = new Map();
    if (syncReady) {
      const prevRows = (await wfQuery(`SELECT GoodId, WinSpeedSetPriceId, WinSpeedListNo, GoodCode, GoodGroupId, GoodGroupName FROM wf.PriceBookLine WHERE PriceBookId=@id`, { id: { type: sql.Int, value: id } })).recordset || [];
      for (const pr of prevRows) prevMap.set(String(pr.GoodId), pr);
    }

    await wfQuery(`DELETE FROM wf.PriceBookLine WHERE PriceBookId=@id`, { id: { type: sql.Int, value: id } });
    for (const v of validatedLines) {
      const prev = prevMap.get(v.goodId);
      await wfQuery(`
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
          wsSid: { type: sql.Int, value: v.winSpeedSetPriceId ?? prev?.WinSpeedSetPriceId ?? null },
          wsLno: { type: sql.SmallInt, value: v.winSpeedListNo ?? prev?.WinSpeedListNo ?? null },
        } : {}),
      });
    }

    let syncResult = { synced: false };
    if (book.Status === 'ACTIVE') {
      syncResult = await syncBookToWinSpeed(id, req.user.sub);
    }

    await audit(wfQuery, id, 'EDIT_LINES', book.Status, book.Status, req.user.sub, `${lines.length} รายการ${syncResult.synced ? ` · Sync WinSpeed (${syncResult.upserted} อัปเดต)` : ''}`);
    res.json({ ok: true, count: lines.length, winSpeedSynced: Boolean(syncResult.synced), syncSummary: syncResult });
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

    const syncReady = await hasSyncColumns();
    const book = (await wfQuery(`
      SELECT Id, Name, Status, EffectiveMonth,
             CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
             CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo
             ${syncReady ? ', SourceSetPriceIds' : ''}
      FROM wf.PriceBook WHERE Id=@id
    `, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Price Book' });
    if (book.Status === 'ARCHIVED') return res.status(409).json({ message: 'ไม่สามารถแก้ไข Price Book ที่เก็บเข้าคลังแล้ว' });

    const existingLine = (await wfQuery(`
      SELECT Id, GoodId, GoodName, Unit, Price, LineStatus, Note
             ${syncReady ? ', GoodCode, GoodGroupId, WinSpeedSetPriceId, WinSpeedListNo' : ''}
      FROM wf.PriceBookLine WHERE Id=@lid AND PriceBookId=@id
    `, { lid: { type: sql.Int, value: lineId }, id: { type: sql.Int, value: id } })).recordset[0];
    if (!existingLine) return res.status(404).json({ message: 'ไม่พบรายการสินค้าในตารางราคา' });

    const nextStatus = lineStatus !== undefined
      ? (['ACTIVE', 'DISCONTINUING', 'SUSPENDED'].includes(String(lineStatus).toUpperCase()) ? String(lineStatus).toUpperCase() : existingLine.LineStatus)
      : existingLine.LineStatus;
    const nextPrice = nextStatus === 'SUSPENDED'
      ? null
      : (price !== undefined ? Number(price) : Number(existingLine.Price));

    if (nextStatus !== 'SUSPENDED' && (!Number.isFinite(nextPrice) || nextPrice <= 0)) {
      return res.status(400).json({ message: 'ราคาขายต้องมากกว่า 0' });
    }

    if (nextStatus !== 'SUSPENDED') {
      await assertPricesAboveCost({
        lines: [{ goodId: existingLine.GoodId, goodCode: existingLine.GoodCode, goodName: existingLine.GoodName, pricePerTon: nextPrice }],
        asOfDate: book.EffectiveFrom || getBangkokDateString(),
      });
    }

    await wfQuery(`
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
      syncResult = await syncBookToWinSpeed(id, req.user.sub, new Set([String(existingLine.GoodId)]));
    }

    await audit(wfQuery, id, 'EDIT_LINE', book.Status, book.Status, req.user.sub,
      `${existingLine.GoodName}: ${existingLine.Price ?? 'งดขาย'} -> ${nextStatus === 'SUSPENDED' ? 'งดขาย' : nextPrice}${syncResult.synced ? ' (Sync WinSpeed)' : ''}`);
    res.json({ ok: true, lineId, price: nextPrice, lineStatus: nextStatus, winSpeedSynced: Boolean(syncResult.synced) });
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

    const syncReady = await hasSyncColumns();
    const book = (await wfQuery(`
      SELECT Id, Name, Status, EffectiveMonth,
             CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
             CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo
      FROM wf.PriceBook WHERE Id=@id
    `, { id: { type: sql.Int, value: id } })).recordset[0];
    if (!book) return res.status(404).json({ message: 'ไม่พบ Price Book' });
    if (book.Status === 'ARCHIVED') return res.status(409).json({ message: 'ไม่สามารถแก้ไข Price Book ที่เก็บเข้าคลังแล้ว' });

    const nextStatus = ['ACTIVE', 'DISCONTINUING', 'SUSPENDED'].includes(String(lineStatus).toUpperCase())
      ? String(lineStatus).toUpperCase()
      : 'ACTIVE';
    const nextPrice = nextStatus === 'SUSPENDED' ? null : Number(price);
    if (nextStatus !== 'SUSPENDED' && (!Number.isFinite(nextPrice) || nextPrice <= 0)) {
      return res.status(400).json({ message: 'ราคาขายต้องมากกว่า 0' });
    }

    if (nextStatus !== 'SUSPENDED') {
      await assertPricesAboveCost({
        lines: [{ goodId, goodCode, goodName, pricePerTon: nextPrice }],
        asOfDate: book.EffectiveFrom || getBangkokDateString(),
      });
    }

    const existing = (await wfQuery(`SELECT Id FROM wf.PriceBookLine WHERE PriceBookId=@id AND GoodId=@g`, {
      id: { type: sql.Int, value: id },
      g: { type: sql.NVarChar(20), value: String(goodId) },
    })).recordset[0];

    if (existing) {
      await wfQuery(`
        UPDATE wf.PriceBookLine SET Price=@p, LineStatus=@ls, Note=@note${syncReady ? ', UpdatedAt=GETUTCDATE()' : ''} WHERE Id=@lid
      `, {
        p: { type: sql.Decimal(12, 2), value: nextPrice },
        ls: { type: sql.VarChar(20), value: nextStatus },
        note: { type: sql.NVarChar(255), value: note || null },
        lid: { type: sql.Int, value: existing.Id },
      });
    } else {
      await wfQuery(`
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
      syncResult = await syncBookToWinSpeed(id, req.user.sub, new Set([String(goodId)]));
    }

    await audit(wfQuery, id, existing ? 'EDIT_LINE' : 'ADD_LINE', book.Status, book.Status, req.user.sub,
      `${goodName || goodId}: ${nextStatus === 'SUSPENDED' ? 'งดขาย' : nextPrice}${syncResult.synced ? ' (Sync WinSpeed)' : ''}`);
    res.json({ ok: true, winSpeedSynced: Boolean(syncResult.synced) });
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
    await audit(wfQuery, id, 'SYNC_TO_WINSPEED', null, null, req.user.sub, `อัปเดต ${result.upserted} รายการ / งดขาย ${result.removed} รายการ`);
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
      const book = (await wfQuery(`
        SELECT Id, Status, EffectiveMonth,
               CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom
        FROM wf.PriceBook WHERE Id=@id
      `, { id: { type: sql.Int, value: id } })).recordset[0];
      if (!book) return res.status(404).json({ message: 'ไม่พบ Price Book' });
      if (!fromStatuses.includes(book.Status)) {
        return res.status(409).json({ message: `ต้องเป็น ${fromStatuses.join(' หรือ ')} (ปัจจุบัน: ${book.Status})` });
      }
      if (toStatus === 'ACTIVE') {
        const lines = (await wfQuery(`SELECT GoodId, GoodName, Price, LineStatus FROM wf.PriceBookLine WHERE PriceBookId=@id`, { id: { type: sql.Int, value: id } })).recordset || [];
        await assertPricesAboveCost({
          lines: lines.filter(l => l.LineStatus !== 'SUSPENDED').map(l => ({ goodId: l.GoodId, goodName: l.GoodName, pricePerTon: l.Price })),
          asOfDate: book.EffectiveFrom || getBangkokDateString(),
        });

        await wfQuery(`UPDATE wf.PriceBook SET Status='ARCHIVED'
          WHERE Status='ACTIVE' AND EffectiveMonth=@em AND Id<>@id`,
          { em: { type: sql.Char(7), value: book.EffectiveMonth }, id: { type: sql.Int, value: id } });
      }
      const setCol = col ? `, ${col}=@uid, ${col.replace('By','At')}=GETUTCDATE()` : '';
      const __r = await wfQuery(`UPDATE wf.PriceBook SET Status=@s ${setCol} WHERE Id=@id`, {
        s: { type: sql.VarChar(20), value: toStatus },
        uid: { type: sql.Int, value: req.user.sub },
        id: { type: sql.Int, value: id },
      });
      if (!__r.rowsAffected[0]) return res.status(404).json({ message: 'ไม่พบรายการที่ระบุ' });

      let syncResult = { synced: false };
      if (toStatus === 'ACTIVE') {
        syncResult = await syncBookToWinSpeed(id, req.user.sub).catch(err => ({ synced: false, error: err.message }));
      }

      await audit(wfQuery, id, action.toUpperCase(), book.Status, toStatus, req.user.sub, req.body?.note || (syncResult.synced ? 'Synced WinSpeed' : null));
      res.json({ ok: true, status: toStatus, winSpeedSynced: Boolean(syncResult.synced) });
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
    const sp = (await wfQuery(`
      SELECT sp.Id, sp.RequestedBy, sp.GoodId, sp.GoodName, sp.PriceBookId,
             CONVERT(VARCHAR(10), pb.EffectiveFrom, 23) AS EffectiveFrom
      FROM wf.PriceBookSpecialPrice sp
      JOIN wf.PriceBook pb ON pb.Id = sp.PriceBookId
      WHERE sp.Id=@id
    `, { id: { type: sql.Int, value: spId } })).recordset[0];
    if (!sp) return res.status(404).json({ message: 'ไม่พบคำขอราคาพิเศษ' });
    if (Number(sp.RequestedBy) === Number(req.user.sub) && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'ไม่อนุญาตให้อนุมัติคำขอของตัวเอง (ใช้บัญชีผู้อนุมัติคนอื่น)' });
    }

    if (sp.GoodId) {
      await assertPricesAboveCost({
        lines: [{ goodId: sp.GoodId, goodName: sp.GoodName, pricePerTon: Number(approvedPrice) }],
        asOfDate: sp.EffectiveFrom || getBangkokDateString(),
      });
    }

    const __r = await wfQuery(`
      UPDATE wf.PriceBookSpecialPrice SET ApprovedPrice=@p, ApprovedBy=@uid, ApprovedAt=GETUTCDATE() WHERE Id=@id`, {
      id: { type: sql.Int, value: spId },
      p: { type: sql.Decimal(12, 2), value: Number(approvedPrice) },
      uid: { type: sql.Int, value: req.user.sub },
    });
    if (!__r.rowsAffected[0]) return res.status(404).json({ message: 'ไม่พบรายการที่ระบุ' });

    const syncResult = await syncSpecialPriceToWinSpeed(spId).catch(err => ({ synced: false, error: err.message }));
    res.json({ id: spId, approvedPrice: Number(approvedPrice), winSpeedSynced: Boolean(syncResult.synced) });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message, code: e.code, details: e.details }); }
});

// GET /api/pricebook/:id/effective?custId= — ราคาที่ใช้จริง รวมราคาพิเศษแล้ว
router.get('/:id/effective', async (req, res) => {
  try {
    const id = Number(req.params.id);
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
};
