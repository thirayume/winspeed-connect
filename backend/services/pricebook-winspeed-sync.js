'use strict';

/**
 * pricebook-winspeed-sync.js — Two-way Auto-Sync between Sale-App wf.PriceBook
 * and WinSpeed dbo.EMSetPriceHD / dbo.EMSetPriceDT, plus non-overlapping date &
 * product enforcement (one product on any date has at most one announced price).
 */
const { sql, wfQuery, wfTransaction, getDbName } = require('../db');
const { getBangkokDateString } = require('./so-pickup-policy');

const RECONCILE_TTL_MS = 5000;
const lastReconcileByDb = new Map();
const inFlightByDb = new Map();

function dbCacheKey() {
  return String(getDbName() || 'default').toLowerCase();
}

function invalidateReconcileCache() {
  lastReconcileByDb.delete(dbCacheKey());
}

function formatThaiDateShort(isoDate) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(isoDate || '');
  return `${m[3]}/${m[2]}/${Number(m[1]) + 543}`;
}

function parseDateOnly(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return raw.toISOString().slice(0, 10);
  }
  const m = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseSetIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map(s => Number(String(s).trim()))
    .filter(n => Number.isInteger(n) && n > 0);
}

function extractDocNos(book) {
  const text = `${book?.Name || ''} ${book?.Note || ''}`;
  return [...new Set((text.match(/(?:SPL\d{4}-\d{5}|WEB-\d{8}-\d{4})/g) || []).map(s => s.trim()))];
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
    const row = r?.recordset?.[0] || {};
    return Boolean(row.HasPb && row.HasLine && row.HasSpProc);
  } catch {
    return false;
  }
}

/**
 * Resolves linked WinSpeed SetPriceIDs for a PriceBook.
 * Matches existing SourceSetPriceIds first, then falls back to DocuNo tokens in Name/Note.
 */
async function resolveBookWinSpeedSetIds(book, queryFn = wfQuery, { strict = false } = {}) {
  const existing = parseSetIds(book?.SourceSetPriceIds);
  if (existing.length > 0) return existing;

  const docNos = extractDocNos(book);
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
    const found = (r?.recordset || []).map(x => Number(x.SetPriceID)).filter(n => Number.isInteger(n) && n > 0);
    if (found.length > 0 && book?.Id && (await hasSyncColumns(queryFn))) {
      await queryFn(`UPDATE wf.PriceBook SET SourceSetPriceIds = @s WHERE Id = @id`, {
        s: { type: sql.NVarChar(200), value: found.join(',') },
        id: { type: sql.Int, value: book.Id },
      });
    }
    return found;
  } catch (error) {
    if (strict) throw error;
    return [];
  }
}

/**
 * Enforces that no two non-archived PriceBooks or WinSpeed general price sets overlap
 * on the same calendar date for the same product ("วันเดียวกัน สินค้าเดียวกัน ต้องมีเพียงราคาเดียวเท่านั้น").
 */
async function assertNoPriceOverlap({
  excludeBookId = null,
  excludeSetIds = [],
  effectiveFrom,
  effectiveTo,
  goodIds = [],
  queryFn = wfQuery,
} = {}) {
  const fromStr = parseDateOnly(effectiveFrom);
  const toStr = parseDateOnly(effectiveTo);
  if (!fromStr || !toStr) {
    throw Object.assign(new Error('กรุณาระบุวันเริ่มต้นและวันสิ้นสุดของตารางราคา'), {
      status: 400,
      code: 'PRICE_PERIOD_REQUIRED',
    });
  }
  if (fromStr > toStr) {
    throw Object.assign(new Error('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด'), {
      status: 400,
      code: 'INVALID_DATE_RANGE',
    });
  }

  const candidateGoodIds = [...new Set((goodIds || []).map(g => String(g || '').trim()).filter(Boolean))];
  const candidateSet = new Set(candidateGoodIds);
  const excludedSets = new Set((excludeSetIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0));

  // 1. Check against non-archived wf.PriceBook entries
  let pbOverlaps = [];
  try {
    const r = await queryFn(`
      SELECT Id, Name, Status, SourceSetPriceIds, Note,
             CONVERT(VARCHAR(10), COALESCE(EffectiveFrom, CAST(EffectiveMonth + '-01' AS DATE)), 23) AS StartDate,
             CONVERT(VARCHAR(10), COALESCE(EffectiveTo, DATEADD(DAY, -1, DATEADD(MONTH, 1, CAST(EffectiveMonth + '-01' AS DATE)))), 23) AS EndDate
      FROM wf.PriceBook WITH (UPDLOCK,HOLDLOCK)
      WHERE Status IN ('DRAFT', 'APPROVED', 'ACTIVE')
        ${excludeBookId ? 'AND Id <> @exId' : ''}
        AND COALESCE(EffectiveFrom, CAST(EffectiveMonth + '-01' AS DATE)) <= @to
        AND COALESCE(EffectiveTo, DATEADD(DAY, -1, DATEADD(MONTH, 1, CAST(EffectiveMonth + '-01' AS DATE)))) >= @from
      ORDER BY StartDate ASC, Id ASC
    `, {
      ...(excludeBookId ? { exId: { type: sql.Int, value: Number(excludeBookId) } } : {}),
      from: { type: sql.Date, value: fromStr },
      to: { type: sql.Date, value: toStr },
    });
    pbOverlaps = r?.recordset || [];
  } catch (err) { throw err; }

  for (const other of pbOverlaps) {
    for (const sid of parseSetIds(other.SourceSetPriceIds)) excludedSets.add(sid);
    const otherLinesRes = await queryFn(`
      SELECT GoodId, GoodName, LineStatus
      FROM wf.PriceBookLine WITH (UPDLOCK,HOLDLOCK)
      WHERE PriceBookId = @bid AND ISNULL(LineStatus, 'ACTIVE') <> 'SUSPENDED'
    `, { bid: { type: sql.Int, value: other.Id } });
    const otherLines = otherLinesRes?.recordset || [];

    if (candidateSet.size > 0 && otherLines.length > 0) {
      const shared = otherLines.filter(l => candidateSet.has(String(l.GoodId || '').trim()));
      if (shared.length > 0) {
        const sample = shared.slice(0, 4).map(l => l.GoodName || l.GoodId).join(', ');
        const more = shared.length > 4 ? ` และอีก ${shared.length - 4} รายการ` : '';
        throw Object.assign(
          new Error(
            `ช่วงวันที่ ${formatThaiDateShort(fromStr)} – ${formatThaiDateShort(toStr)} ทับซ้อนกับ "${other.Name}" (${formatThaiDateShort(other.StartDate)} – ${formatThaiDateShort(other.EndDate)}) ในสินค้าเดียวกัน: ${sample}${more} (วันเดียวกัน สินค้าเดียวกัน ต้องมีเพียงราคาเดียวเท่านั้น)`
          ),
          {
            status: 409,
            code: 'PRICE_PERIOD_OVERLAP',
            details: { conflictingBookId: other.Id, conflictingBookName: other.Name, overlapCount: shared.length },
          }
        );
      }
    } else {
      throw Object.assign(
        new Error(
          `ช่วงวันที่ ${formatThaiDateShort(fromStr)} – ${formatThaiDateShort(toStr)} ทับซ้อนกับ "${other.Name}" (${formatThaiDateShort(other.StartDate)} – ${formatThaiDateShort(other.EndDate)}) ที่มีบันทึกไว้แล้ว`
        ),
        {
          status: 409,
          code: 'PRICE_PERIOD_OVERLAP',
          details: { conflictingBookId: other.Id, conflictingBookName: other.Name },
        }
      );
    }
  }

  // 2. Check against WinSpeed general sets (dbo.EMSetPriceHD where CustID IS NULL)
  let wsOverlaps = [];
  try {
    const r = await queryFn(`
      SELECT hd.SetPriceID, RTRIM(hd.DocuNo) AS DocuNo,
             CONVERT(VARCHAR(10), hd.BeginDate, 23) AS BeginDate,
             CONVERT(VARCHAR(10), COALESCE(hd.EndDate, '2099-12-31'), 23) AS EndDate,
             (SELECT COUNT(*) FROM dbo.EMSetPriceDT dt WITH (UPDLOCK,HOLDLOCK) WHERE dt.SetPriceID = hd.SetPriceID AND dt.GoodPriceNet > 0) AS LineCount
      FROM dbo.EMSetPriceHD hd WITH (UPDLOCK,HOLDLOCK)
      WHERE hd.CustID IS NULL
        AND CAST(hd.BeginDate AS DATE) <= @to
        AND (hd.EndDate IS NULL OR CAST(hd.EndDate AS DATE) >= @from)
    `, {
      from: { type: sql.Date, value: fromStr },
      to: { type: sql.Date, value: toStr },
    });
    wsOverlaps = (r?.recordset || []).filter(
      row => !excludedSets.has(Number(row.SetPriceID)) && Number(row.LineCount) > 0
    );
  } catch (err) { throw err; }

  if (wsOverlaps.length > 0) {
    for (const ws of wsOverlaps) {
      if (candidateSet.size > 0) {
        const dtRes = await queryFn(`
          SELECT CAST(dt.ListID AS NVARCHAR(20)) AS GoodId, g.GoodName1 AS GoodName
          FROM dbo.EMSetPriceDT dt WITH (UPDLOCK,HOLDLOCK)
          LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.ListID
          WHERE dt.SetPriceID = @sid AND dt.GoodPriceNet > 0
        `, { sid: { type: sql.Int, value: Number(ws.SetPriceID) } });
        const shared = (dtRes?.recordset || []).filter(l => candidateSet.has(String(l.GoodId || '').trim()));
        if (shared.length > 0) {
          const sample = shared.slice(0, 4).map(l => l.GoodName || l.GoodId).join(', ');
          const more = shared.length > 4 ? ` และอีก ${shared.length - 4} รายการ` : '';
          throw Object.assign(
            new Error(
              `ช่วงวันที่ ${formatThaiDateShort(fromStr)} – ${formatThaiDateShort(toStr)} ทับซ้อนกับชุดราคา WinSpeed ${ws.DocuNo} (${formatThaiDateShort(ws.BeginDate)} – ${formatThaiDateShort(ws.EndDate)}) ในสินค้าเดียวกัน: ${sample}${more}`
            ),
            {
              status: 409,
              code: 'PRICE_PERIOD_OVERLAP',
              details: { conflictingSetPriceId: ws.SetPriceID, conflictingDocuNo: ws.DocuNo, overlapCount: shared.length },
            }
          );
        }
      } else {
        throw Object.assign(
          new Error(
            `ช่วงวันที่ ${formatThaiDateShort(fromStr)} – ${formatThaiDateShort(toStr)} ทับซ้อนกับชุดราคา WinSpeed ${ws.DocuNo} (${formatThaiDateShort(ws.BeginDate)} – ${formatThaiDateShort(ws.EndDate)})`
          ),
          {
            status: 409,
            code: 'PRICE_PERIOD_OVERLAP',
            details: { conflictingSetPriceId: ws.SetPriceID, conflictingDocuNo: ws.DocuNo },
          }
        );
      }
    }
  }
}

async function execProc(requestSource, procName, configureFn) {
  const req = typeof requestSource.request === 'function' ? requestSource.request() : await requestSource;
  if (configureFn) configureFn(req);
  return req.execute(procName);
}

function transactionQuery(tx) {
  return async (text, inputs = {}) => {
    const req = tx.request();
    for (const [name, { type, value }] of Object.entries(inputs)) req.input(name, type, value);
    return req.query(text);
  };
}

/**
 * Picks target WinSpeed SetPriceID for a PriceBook line (handles split sets such as compound + raw materials).
 */
async function pickTargetWinSpeedSetId(queryFn, line, setIds) {
  if (line.WinSpeedSetPriceId) {
    const id = Number(line.WinSpeedSetPriceId);
    if (!Number.isSafeInteger(id) || !setIds.includes(id)) throw Object.assign(new Error('สินค้าเชื่อมกับชุดราคาอื่น'), { status: 409, code: 'PRICE_TARGET_MISMATCH' });
    return id;
  }
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
    if (existingMatch?.recordset?.[0]?.SetPriceID) {
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
      if (groupSetMatch?.recordset?.[0]?.SetPriceID) {
        return Number(groupSetMatch.recordset[0].SetPriceID);
      }
    }
  } catch (error) {
    throw error;
  }
  throw Object.assign(new Error('ไม่สามารถระบุชุดราคา WinSpeed ของสินค้านี้ได้'), { status: 409, code: 'PRICE_TARGET_AMBIGUOUS' });
}

async function syncSpecialPriceToWinSpeed(spId, knownBook = null, tx = null) {
  if (!tx) return wfTransaction(inner => syncSpecialPriceToWinSpeed(spId, knownBook, inner));
  const wfQuery = transactionQuery(tx);
  const syncReady = await hasSyncColumns(wfQuery);
  if (!syncReady) throw Object.assign(new Error('PriceBook sync schema unavailable'), { status: 503, code: 'PRICE_SYNC_UNAVAILABLE' });

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
  const canonicalCustId = Number(custRow?.CustID || 0);
  const goodNum = Number(sp.GoodId);
  if (!canonicalCustId || !Number.isInteger(goodNum)) return { synced: false };

  const beginStr = parseDateOnly(sp.EffectiveFrom) || `${sp.EffectiveMonth}-01`;
  const endStr = parseDateOnly(sp.EffectiveTo) || beginStr;
  const req = tx.request();
  req.input('CustID', sql.Int, canonicalCustId);
  req.input('GoodID', sql.Int, goodNum);
  req.input('ApprovedPrice', sql.Decimal(18, 4), Number(sp.ApprovedPrice));
  req.input('BeginDate', sql.Date, new Date(`${beginStr}T00:00:00Z`));
  req.input('EndDate', sql.Date, new Date(`${endStr}T00:00:00Z`));
  req.input('Remark', sql.VarChar(255), sp.Note ? String(sp.Note).slice(0, 255) : 'ราคาพิเศษรายร้านค้า (Sale-App)');
  req.output('SetPriceID', sql.Int, sp.WinSpeedSetPriceId != null ? Number(sp.WinSpeedSetPriceId) : null);
  const r = await req.execute('wf.sp_PriceBookUpsertSpecialWinSpeedPrice');
  const syncedId = Number(r.output?.SetPriceID || 0);
  if (!(syncedId > 0)) throw Object.assign(new Error('WinSpeed special price did not return an ID'), { status: 409, code: 'PRICE_SYNC_INCOMPLETE' });
  if (syncedId > 0) {
    await wfQuery(`UPDATE wf.PriceBookSpecialPrice SET WinSpeedSetPriceId = @sid WHERE Id = @id`, {
      sid: { type: sql.Int, value: syncedId },
      id: { type: sql.Int, value: spId },
    });
  }
  return { synced: true, setPriceId: syncedId };
}

/**
 * Syncs an ACTIVE PriceBook (header dates, lines, approved special prices) to WinSpeed (dbo.EMSetPriceHD / DT).
 */
async function syncBookToWinSpeed(bookId, userId, onlyGoodIds = null, tx = null) {
  if (!tx) return wfTransaction(inner => syncBookToWinSpeed(bookId, userId, onlyGoodIds, inner));
  const wfQuery = transactionQuery(tx);
  const syncReady = await hasSyncColumns(wfQuery);
  if (!syncReady) throw Object.assign(new Error('PriceBook sync schema unavailable'), { status: 503, code: 'PRICE_SYNC_UNAVAILABLE' });

  const book = (await wfQuery(`
    SELECT Id, Name, EffectiveMonth, Status, SourceSetPriceIds, Note,
           CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
           CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo
    FROM wf.PriceBook WHERE Id = @id
  `, { id: { type: sql.Int, value: bookId } })).recordset[0];
  if (!book) throw Object.assign(new Error('ไม่พบ PriceBook'), { status: 404 });
  if (book.Status !== 'ACTIVE') throw Object.assign(new Error('ตารางราคายังไม่ได้เปิดใช้งาน'), { status: 409, code: 'PRICE_BOOK_NOT_ACTIVE' });

  let setIds = await resolveBookWinSpeedSetIds(book, wfQuery, { strict: true });
  const beginStr = parseDateOnly(book.EffectiveFrom) || `${book.EffectiveMonth}-01`;
  const endStr = parseDateOnly(book.EffectiveTo) || beginStr;
  const beginDate = new Date(`${beginStr}T00:00:00Z`);
  const endDate = new Date(`${endStr}T00:00:00Z`);

  const allLines = (await wfQuery(`
    SELECT Id, GoodId, GoodCode, GoodName, GoodGroupId, Price, LineStatus, Note, WinSpeedSetPriceId, WinSpeedListNo
    FROM wf.PriceBookLine
    WHERE PriceBookId = @id
    ORDER BY Id
  `, { id: { type: sql.Int, value: bookId } })).recordset || [];

  const targetLines = onlyGoodIds
    ? allLines.filter(l => onlyGoodIds.has(String(l.GoodId)))
    : allLines;

  const pool = tx;
  let createdDocuNo = null;

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
    createdDocuNo = cr.output?.DocuNo ? String(cr.output.DocuNo).trim() : null;
    if (!(newSetId > 0) || !createdDocuNo) throw Object.assign(new Error('WinSpeed price set was not created'), { status: 409, code: 'PRICE_SYNC_INCOMPLETE' });
    if (newSetId > 0) {
      setIds = [newSetId];
      await wfQuery(`
        UPDATE wf.PriceBook
        SET SourceSetPriceIds = @s,
            Note = COALESCE(NULLIF(Note, ''), @note)
        WHERE Id = @id
      `, {
        s: { type: sql.NVarChar(200), value: setIds.join(',') },
        note: { type: sql.NVarChar(500), value: createdDocuNo ? `WinSpeed: ${createdDocuNo}` : null },
        id: { type: sql.Int, value: bookId },
      });
    }
  } else {
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
    if (!Number.isInteger(gidNum) || gidNum <= 0) throw Object.assign(new Error('Invalid product in price book'), { status: 409, code: 'PRICE_SYNC_INCOMPLETE' });

    const targetSetId = await pickTargetWinSpeedSetId(wfQuery, line, setIds);
    if (!targetSetId) throw Object.assign(new Error('Price set not found'), { status: 409, code: 'PRICE_SYNC_INCOMPLETE' });
    if (line.WinSpeedListNo != null) {
      const existing = (await wfQuery(`SELECT ListID FROM dbo.EMSetPriceDT WITH (UPDLOCK,HOLDLOCK)
        WHERE SetPriceID=@sid AND ListNo=@list`, {
        sid: { type: sql.Int, value: targetSetId }, list: { type: sql.SmallInt, value: Number(line.WinSpeedListNo) },
      })).recordset || [];
      if (existing.length !== 1 || Number(existing[0].ListID) !== gidNum) {
        throw Object.assign(new Error('รายการสินค้า WinSpeed เปลี่ยนแล้ว กรุณาตรวจการเชื่อมโยง'), { status: 409, code: 'PRICE_LINE_STALE' });
      }
    }

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

    if (line.Price == null || !(Number(line.Price) > 0)) throw Object.assign(new Error('Price must be greater than zero'), { status: 409, code: 'PRICE_SYNC_INCOMPLETE' });

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
      r.output('ListNo', sql.SmallInt, line.WinSpeedListNo != null ? Number(line.WinSpeedListNo) : null);
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

  if (!onlyGoodIds) {
    const sps = (await wfQuery(`
      SELECT Id
      FROM wf.PriceBookSpecialPrice
      WHERE PriceBookId = @id AND ApprovedPrice IS NOT NULL AND ApprovedPrice > 0 AND GoodId IS NOT NULL
    `, { id: { type: sql.Int, value: bookId } })).recordset || [];
    for (const sp of sps) {
      const special = await syncSpecialPriceToWinSpeed(sp.Id, book, tx);
      if (!special.synced) throw Object.assign(new Error('WinSpeed special price was not synced'), { status: 409, code: 'PRICE_SYNC_INCOMPLETE' });
    }
  }

  await wfQuery(`
    UPDATE wf.PriceBook
    SET WinSpeedSyncAt = SYSUTCDATETIME(),
        LastSyncedBy = @uid
    WHERE Id = @id
  `, { uid: { type: sql.Int, value: userId || null }, id: { type: sql.Int, value: bookId } });

  await wfQuery(`INSERT INTO wf.PriceBookAudit (PriceBookId,Action,FromStatus,ToStatus,ByUser,Note)
    VALUES (@id,'SYNC_WINSPEED',@status,@status,@uid,@note)`, {
    id: { type: sql.Int, value: bookId }, status: { type: sql.VarChar(20), value: book.Status },
    uid: { type: sql.Int, value: userId || null }, note: { type: sql.NVarChar(300), value: `upserted=${upserted};removed=${removed}` },
  });

  invalidateReconcileCache();
  return { synced: true, setIds, docuNo: createdDocuNo, upserted, removed };
}

/**
 * Reconciles linked active PriceBooks and newly published WinSpeed sets (dbo.EMSetPriceHD / DT)
 * into wf.PriceBook / wf.PriceBookLine automatically.
 */
async function runReconcileFromWinSpeed(bookIdFilter = null) {
  if (!(await hasSyncColumns())) return { changed: false, skipped: 'SYNC_COLS_MISSING' };

  const allBooks = (await wfQuery(`
    SELECT Id, Name, EffectiveMonth, Status, SourceSetPriceIds, Note,
           CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
           CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo
    FROM wf.PriceBook
    ORDER BY Id ASC
  `)).recordset || [];

  const allLinkedSetIds = new Set();
  for (const b of allBooks) {
    const ids = await resolveBookWinSpeedSetIds(b);
    b._resolvedSetIds = ids;
    for (const sid of ids) allLinkedSetIds.add(sid);
  }

  let totalChanged = false;
  let updatedBooks = 0;
  let importedBooks = 0;

  // 1. Reconcile existing linked ACTIVE books from WinSpeed -> Sale-App
  const booksToSync = allBooks.filter(
    b => b.Status === 'ACTIVE' && (!bookIdFilter || Number(b.Id) === Number(bookIdFilter)) && b._resolvedSetIds.length > 0
  );

  for (const book of booksToSync) {
    const setIds = book._resolvedSetIds;
    const headers = (await wfQuery(`
      SELECT SetPriceID, RTRIM(DocuNo) AS DocuNo,
             CONVERT(VARCHAR(10), BeginDate, 23) AS BeginDate,
             CONVERT(VARCHAR(10), EndDate, 23) AS EndDate
      FROM dbo.EMSetPriceHD WITH (NOLOCK)
      WHERE SetPriceID IN (${setIds.join(',')})
    `)).recordset || [];
    if (!headers.length) continue;

    const existingSetIdSet = new Set(headers.map(h => Number(h.SetPriceID)));
    const beginDates = headers.map(h => parseDateOnly(h.BeginDate)).filter(Boolean).sort();
    const endDates = headers.map(h => parseDateOnly(h.EndDate)).filter(Boolean).sort();
    const wsFrom = beginDates[0] || book.EffectiveFrom;
    const wsTo = endDates[endDates.length - 1] || book.EffectiveTo;

    let bookChanged = false;
    let changesSummary = [];

    if ((wsFrom && wsFrom !== book.EffectiveFrom) || (wsTo && wsTo !== book.EffectiveTo)) {
      await wfQuery(`
        UPDATE wf.PriceBook
        SET EffectiveFrom = @ef,
            EffectiveTo = @et,
            EffectiveMonth = @em
        WHERE Id = @id
      `, {
        ef: { type: sql.Date, value: wsFrom },
        et: { type: sql.Date, value: wsTo },
        em: { type: sql.Char(7), value: wsFrom ? wsFrom.slice(0, 7) : book.EffectiveMonth },
        id: { type: sql.Int, value: book.Id },
      });
      bookChanged = true;
      changesSummary.push(`ช่วงวันที่ ${wsFrom}..${wsTo}`);
    }

    const wsLines = (await wfQuery(`
      SELECT dt.SetPriceID, dt.ListNo, CAST(dt.ListID AS NVARCHAR(20)) AS GoodId,
             RTRIM(g.GoodCode) AS GoodCode, RTRIM(g.GoodName1) AS GoodName,
             g.GoodGroupID AS GoodGroupId, RTRIM(gg.GoodGroupName) AS GoodGroupName,
             ISNULL(RTRIM(u.GoodUnitName), N'ตัน') AS Unit,
             dt.GoodPriceNet AS Price, RTRIM(dt.Remark) AS Remark
      FROM dbo.EMSetPriceDT dt WITH (NOLOCK)
      JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.ListID
      LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = g.GoodGroupID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = ISNULL(dt.GoodUnitID, g.MainGoodUnitID)
      WHERE dt.SetPriceID IN (${setIds.join(',')})
        AND dt.GoodPriceNet > 0
      ORDER BY dt.SetPriceID DESC, dt.ListNo ASC
    `)).recordset || [];

    const wsByGood = new Map();
    for (const row of wsLines) {
      if (!wsByGood.has(String(row.GoodId))) wsByGood.set(String(row.GoodId), row);
    }

    const curLines = (await wfQuery(`
      SELECT Id, GoodId, GoodName, Price, LineStatus, Note, WinSpeedSetPriceId, WinSpeedListNo
      FROM wf.PriceBookLine
      WHERE PriceBookId = @id
    `, { id: { type: sql.Int, value: book.Id } })).recordset || [];
    const curByGood = new Map(curLines.map(l => [String(l.GoodId), l]));

    let upserted = 0;
    let suspended = 0;

    for (const [gid, ws] of wsByGood.entries()) {
      const wsNote = ws.Remark ? String(ws.Remark).trim() : null;
      const wsStatus = wsNote && wsNote.includes('***') ? 'DISCONTINUING' : 'ACTIVE';
      const wsPrice = Number(ws.Price);
      const cur = curByGood.get(gid);

      if (!cur) {
        await wfQuery(`
          INSERT INTO wf.PriceBookLine (
            PriceBookId, GoodId, GoodName, Unit, Price, LineStatus, Note,
            GoodCode, GoodGroupId, GoodGroupName, WinSpeedSetPriceId, WinSpeedListNo
          )
          VALUES (@b, @g, @gn, @u, @p, @ls, @note, @gc, @ggId, @ggName, @wsSid, @wsLno)
        `, {
          b: { type: sql.Int, value: book.Id },
          g: { type: sql.NVarChar(20), value: gid },
          gn: { type: sql.NVarChar(200), value: ws.GoodName || '' },
          u: { type: sql.NVarChar(30), value: ws.Unit || 'ตัน' },
          p: { type: sql.Decimal(12, 2), value: wsPrice },
          ls: { type: sql.VarChar(20), value: wsStatus },
          note: { type: sql.NVarChar(255), value: wsNote },
          gc: { type: sql.NVarChar(50), value: ws.GoodCode || null },
          ggId: { type: sql.Int, value: ws.GoodGroupId != null ? Number(ws.GoodGroupId) : null },
          ggName: { type: sql.NVarChar(100), value: ws.GoodGroupName || null },
          wsSid: { type: sql.Int, value: Number(ws.SetPriceID) },
          wsLno: { type: sql.SmallInt, value: Number(ws.ListNo) },
        });
        upserted += 1;
        bookChanged = true;
        continue;
      }

      const curPrice = cur.Price != null ? Number(cur.Price) : null;
      const curNote = cur.Note ? String(cur.Note).trim() : null;
      const diff =
        curPrice === null ||
        Math.abs(curPrice - wsPrice) > 0.005 ||
        cur.LineStatus !== wsStatus ||
        (curNote || '') !== (wsNote || '') ||
        Number(cur.WinSpeedSetPriceId || 0) !== Number(ws.SetPriceID) ||
        Number(cur.WinSpeedListNo || 0) !== Number(ws.ListNo);

      if (diff) {
        await wfQuery(`
          UPDATE wf.PriceBookLine
          SET Price = @p,
              LineStatus = @ls,
              Note = @note,
              GoodName = COALESCE(NULLIF(@gn, ''), GoodName),
              GoodCode = COALESCE(@gc, GoodCode),
              WinSpeedSetPriceId = @wsSid,
              WinSpeedListNo = @wsLno,
              UpdatedAt = GETUTCDATE()
          WHERE Id = @lid
        `, {
          p: { type: sql.Decimal(12, 2), value: wsPrice },
          ls: { type: sql.VarChar(20), value: wsStatus },
          note: { type: sql.NVarChar(255), value: wsNote },
          gn: { type: sql.NVarChar(200), value: ws.GoodName || '' },
          gc: { type: sql.NVarChar(50), value: ws.GoodCode || null },
          wsSid: { type: sql.Int, value: Number(ws.SetPriceID) },
          wsLno: { type: sql.SmallInt, value: Number(ws.ListNo) },
          lid: { type: sql.Int, value: cur.Id },
        });
        upserted += 1;
        bookChanged = true;
      }
    }

    // Items previously live in a still-existing WinSpeed set that were removed from EMSetPriceDT -> SUSPENDED
    for (const cur of curLines) {
      if (wsByGood.has(String(cur.GoodId))) continue;
      if (String(cur.LineStatus || '').toUpperCase() === 'SUSPENDED') continue;
      const linkedSetStillExists = !cur.WinSpeedSetPriceId || existingSetIdSet.has(Number(cur.WinSpeedSetPriceId));
      if (!linkedSetStillExists) continue;

      await wfQuery(`
        UPDATE wf.PriceBookLine
        SET LineStatus = 'SUSPENDED',
            Price = NULL,
            WinSpeedListNo = NULL,
            UpdatedAt = GETUTCDATE()
        WHERE Id = @lid
      `, { lid: { type: sql.Int, value: cur.Id } });
      suspended += 1;
      bookChanged = true;
    }

    if (bookChanged) {
      totalChanged = true;
      updatedBooks += 1;
      if (upserted > 0) changesSummary.push(`อัปเดต ${upserted} รายการ`);
      if (suspended > 0) changesSummary.push(`งดขาย ${suspended} รายการ`);
      await wfQuery(`UPDATE wf.PriceBook SET WinSpeedSyncAt = SYSUTCDATETIME() WHERE Id = @id`, {
        id: { type: sql.Int, value: book.Id },
      });
      await wfQuery(`
        INSERT INTO wf.PriceBookAudit (PriceBookId, Action, FromStatus, ToStatus, ByUser, Note)
        VALUES (@b, 'AUTO_SYNC_WINSPEED', @s, @s, NULL, @n)
      `, {
        b: { type: sql.Int, value: book.Id },
        s: { type: sql.VarChar(20), value: book.Status },
        n: { type: sql.NVarChar(500), value: `ซิงค์อัตโนมัติจาก WinSpeed: ${changesSummary.join(', ')}` },
      }).catch(() => {});
    }
  }

  // 2. Auto-import newly published WinSpeed general sets (active today OR recent/upcoming sets created since 2026-11-12)
  if (!bookIdFilter) {
    const todayStr = getBangkokDateString();
    const candidateSets = (await wfQuery(`
      SELECT hd.SetPriceID, RTRIM(hd.DocuNo) AS DocuNo,
             CONVERT(VARCHAR(10), hd.DocuDate, 23) AS DocuDate,
             CONVERT(VARCHAR(10), hd.BeginDate, 23) AS BeginDate,
             CONVERT(VARCHAR(10), hd.EndDate, 23) AS EndDate,
             RTRIM(hd.Remark1) AS Remark1,
             (SELECT COUNT(*) FROM dbo.EMSetPriceDT dt WITH (NOLOCK) WHERE dt.SetPriceID = hd.SetPriceID AND dt.GoodPriceNet > 0) AS LineCount
      FROM dbo.EMSetPriceHD hd WITH (NOLOCK)
      WHERE hd.CustID IS NULL
        AND hd.DocuDate >= '2026-01-01'
        AND (
          (CAST(hd.BeginDate AS DATE) <= @today AND (hd.EndDate IS NULL OR CAST(hd.EndDate AS DATE) >= @today))
          OR hd.ChangedDate >= '2026-11-12'
        )
      ORDER BY hd.BeginDate DESC, hd.SetPriceID ASC
    `, { today: { type: sql.Date, value: todayStr } })).recordset || [];

    const unlinked = candidateSets.filter(
      s => !allLinkedSetIds.has(Number(s.SetPriceID)) && Number(s.LineCount) > 0
    );

    if (unlinked.length > 0) {
      // Group unlinked WinSpeed sets by exact BeginDate + EndDate period (e.g. compound + raw material split sets)
      const byPeriod = new Map();
      for (const s of unlinked) {
        const key = `${s.BeginDate || ''}|${s.EndDate || ''}`;
        if (!byPeriod.has(key)) byPeriod.set(key, []);
        byPeriod.get(key).push(s);
      }

      for (const [, groupSets] of byPeriod.entries()) {
        const ef = parseDateOnly(groupSets[0].BeginDate);
        const et = parseDateOnly(groupSets[0].EndDate) || ef;
        const groupSetIds = groupSets.map(s => Number(s.SetPriceID));

        // If a non-archived wf.PriceBook already matches this exact date period, attach and merge lines
        const exactMatchBook = allBooks.find(
          b => b.Status !== 'ARCHIVED' && parseDateOnly(b.EffectiveFrom) === ef && parseDateOnly(b.EffectiveTo) === et
        );

        const groupLines = (await wfQuery(`
          SELECT dt.SetPriceID, dt.ListNo, CAST(dt.ListID AS NVARCHAR(20)) AS GoodId,
                 RTRIM(g.GoodCode) AS GoodCode, RTRIM(g.GoodName1) AS GoodName,
                 g.GoodGroupID AS GoodGroupId, RTRIM(gg.GoodGroupName) AS GoodGroupName,
                 ISNULL(RTRIM(u.GoodUnitName), N'ตัน') AS Unit,
                 dt.GoodPriceNet AS Price, RTRIM(dt.Remark) AS Remark
          FROM dbo.EMSetPriceDT dt WITH (NOLOCK)
          JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.ListID
          LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = g.GoodGroupID
          LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = ISNULL(dt.GoodUnitID, g.MainGoodUnitID)
          WHERE dt.SetPriceID IN (${groupSetIds.join(',')})
            AND dt.GoodPriceNet > 0
            AND ISNULL(g.Inactive, 'A') = 'A'
          ORDER BY dt.SetPriceID DESC, dt.ListNo ASC
        `)).recordset || [];

        const dedup = new Map();
        for (const l of groupLines) {
          if (!dedup.has(String(l.GoodId))) dedup.set(String(l.GoodId), l);
        }
        const items = [...dedup.values()];
        if (!items.length) continue;

        if (exactMatchBook) {
          const mergedIds = [...new Set([...(exactMatchBook._resolvedSetIds || []), ...groupSetIds])];
          await wfQuery(`UPDATE wf.PriceBook SET SourceSetPriceIds = @s, WinSpeedSyncAt = SYSUTCDATETIME() WHERE Id = @id`, {
            s: { type: sql.NVarChar(200), value: mergedIds.join(',') },
            id: { type: sql.Int, value: exactMatchBook.Id },
          });
          // Re-run line sync on this book cleanly via direct insert of missing items
          for (const item of items) {
            const exists = (await wfQuery(`SELECT Id FROM wf.PriceBookLine WHERE PriceBookId=@b AND GoodId=@g`, {
              b: { type: sql.Int, value: exactMatchBook.Id },
              g: { type: sql.NVarChar(20), value: String(item.GoodId) },
            })).recordset?.[0];
            if (!exists) {
              const hasStar = item.Remark && String(item.Remark).includes('***');
              await wfQuery(`
                INSERT INTO wf.PriceBookLine (
                  PriceBookId, GoodId, GoodName, Unit, Price, LineStatus, Note,
                  GoodCode, GoodGroupId, GoodGroupName, WinSpeedSetPriceId, WinSpeedListNo
                )
                VALUES (@b, @g, @gn, @u, @p, @ls, @note, @gc, @ggId, @ggName, @wsSid, @wsLno)
              `, {
                b: { type: sql.Int, value: exactMatchBook.Id },
                g: { type: sql.NVarChar(20), value: String(item.GoodId) },
                gn: { type: sql.NVarChar(200), value: item.GoodName || '' },
                u: { type: sql.NVarChar(30), value: item.Unit || 'ตัน' },
                p: { type: sql.Decimal(12, 2), value: Number(item.Price) },
                ls: { type: sql.VarChar(20), value: hasStar ? 'DISCONTINUING' : 'ACTIVE' },
                note: { type: sql.NVarChar(255), value: item.Remark || null },
                gc: { type: sql.NVarChar(50), value: item.GoodCode || null },
                ggId: { type: sql.Int, value: item.GoodGroupId != null ? Number(item.GoodGroupId) : null },
                ggName: { type: sql.NVarChar(100), value: item.GoodGroupName || null },
                wsSid: { type: sql.Int, value: Number(item.SetPriceID) },
                wsLno: { type: sql.SmallInt, value: Number(item.ListNo) },
              });
            }
          }
          totalChanged = true;
          updatedBooks += 1;
          continue;
        }

        // Skip auto-creating if it would collide with an existing non-archived book by date + product
        try {
          await assertNoPriceOverlap({
            excludeSetIds: groupSetIds,
            effectiveFrom: ef,
            effectiveTo: et,
            goodIds: items.map(i => i.GoodId),
            queryFn: wfQuery,
          });
        } catch {
          continue;
        }

        const docNos = groupSets.map(s => s.DocuNo).join(', ');
        const bookName = `ตารางราคา WinSpeed (${docNos}) ประจำวันที่ ${ef} ถึง ${et}`.slice(0, 120);
        const effMonth = ef ? ef.slice(0, 7) : todayStr.slice(0, 7);
        const inserted = (await wfQuery(`
          INSERT INTO wf.PriceBook (
            Name, EffectiveMonth, EffectiveFrom, EffectiveTo, Status, Note,
            SourceSetPriceIds, WinSpeedSyncAt, ActivatedAt
          )
          OUTPUT inserted.Id
          VALUES (@n, @m, @ef, @et, 'ACTIVE', @note, @sids, SYSUTCDATETIME(), GETUTCDATE())
        `, {
          n: { type: sql.NVarChar(120), value: bookName },
          m: { type: sql.Char(7), value: effMonth },
          ef: { type: sql.Date, value: ef },
          et: { type: sql.Date, value: et },
          note: { type: sql.NVarChar(500), value: `ซิงค์อัตโนมัติจาก WinSpeed: ${docNos}` },
          sids: { type: sql.NVarChar(200), value: groupSetIds.join(',') },
        })).recordset[0];

        const newBookId = inserted.Id;
        for (const item of items) {
          const hasStar = item.Remark && String(item.Remark).includes('***');
          await wfQuery(`
            INSERT INTO wf.PriceBookLine (
              PriceBookId, GoodId, GoodName, Unit, Price, LineStatus, Note,
              GoodCode, GoodGroupId, GoodGroupName, WinSpeedSetPriceId, WinSpeedListNo
            )
            VALUES (@b, @g, @gn, @u, @p, @ls, @note, @gc, @ggId, @ggName, @wsSid, @wsLno)
          `, {
            b: { type: sql.Int, value: newBookId },
            g: { type: sql.NVarChar(20), value: String(item.GoodId) },
            gn: { type: sql.NVarChar(200), value: item.GoodName || '' },
            u: { type: sql.NVarChar(30), value: item.Unit || 'ตัน' },
            p: { type: sql.Decimal(12, 2), value: Number(item.Price) },
            ls: { type: sql.VarChar(20), value: hasStar ? 'DISCONTINUING' : 'ACTIVE' },
            note: { type: sql.NVarChar(255), value: item.Remark || null },
            gc: { type: sql.NVarChar(50), value: item.GoodCode || null },
            ggId: { type: sql.Int, value: item.GoodGroupId != null ? Number(item.GoodGroupId) : null },
            ggName: { type: sql.NVarChar(100), value: item.GoodGroupName || null },
            wsSid: { type: sql.Int, value: Number(item.SetPriceID) },
            wsLno: { type: sql.SmallInt, value: Number(item.ListNo) },
          });
        }
        await wfQuery(`
          INSERT INTO wf.PriceBookAudit (PriceBookId, Action, FromStatus, ToStatus, ByUser, Note)
          VALUES (@b, 'AUTO_SYNC_WINSPEED', NULL, 'ACTIVE', NULL, @n)
        `, {
          b: { type: sql.Int, value: newBookId },
          n: { type: sql.NVarChar(500), value: `นำเข้าอัตโนมัติจาก WinSpeed: ${docNos} (${items.length} รายการ)` },
        }).catch(() => {});

        totalChanged = true;
        importedBooks += 1;
      }
    }
  }

  return { changed: totalChanged, updatedBooks, importedBooks };
}

/**
 * Throttled wrapper for automatic WinSpeed -> Sale-App reconciliation.
 */
async function reconcileFromWinSpeed({ force = false, bookId = null } = {}) {
  const key = `${dbCacheKey()}::${bookId || 'all'}`;
  const now = Date.now();
  if (!force) {
    const last = lastReconcileByDb.get(key) || 0;
    if (now - last < RECONCILE_TTL_MS) {
      return { changed: false, throttled: true };
    }
  }
  if (inFlightByDb.has(key)) {
    return inFlightByDb.get(key);
  }
  const p = runReconcileFromWinSpeed(bookId)
    .then(res => {
      lastReconcileByDb.set(key, Date.now());
      if (bookId && res?.changed) lastReconcileByDb.delete(`${dbCacheKey()}::all`);
      return res;
    })
    .catch(err => {
      // Never break read paths or unit tests without full WinSpeed mock tables
      console.warn('[pricebook/auto-reconcile-warn]', err.message);
      return { changed: false, error: err.message };
    })
    .finally(() => {
      inFlightByDb.delete(key);
    });
  inFlightByDb.set(key, p);
  return p;
}

module.exports = {
  parseDateOnly,
  parseSetIds,
  hasSyncColumns,
  resolveBookWinSpeedSetIds,
  assertNoPriceOverlap,
  syncBookToWinSpeed,
  syncSpecialPriceToWinSpeed,
  reconcileFromWinSpeed,
  invalidateReconcileCache,
};

