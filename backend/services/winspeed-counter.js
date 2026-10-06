'use strict';
const { sql, dboWrite } = require('../db');

// Booking (103) numbers for both books: I = account 1, K = account 2 (R12 K-F1).
// WINSpeed keeps the active book in dbo.EMRunBrch and both books in dbo.EMRunChar
// (ListNo 1 = I/C/J, ListNo 2 = K/D/N); staff switch the active book during the day.
const RUN_CODE_BY_PREFIX = Object.freeze({ I: '103', K: '103' });

const resultRows = r => r?.recordset || [];

/**
 * Current LastNo of the row that holds `prefix` for `runCode`: EMRunBrch when the
 * active book has that prefix, otherwise the EMRunChar row of that prefix
 * (the EMRunChar row of the ACTIVE book is stale and is never used). Read only.
 */
async function readBookCounter(queryFn, runCode, prefix, brchId = 1) {
  const p = String(prefix || '').slice(0, 1).toUpperCase();
  const rows = resultRows(await queryFn(`
    SELECT 'EMRunBrch' AS Source, RTRIM(RunFormat) AS Fmt, RTRIM(LastNo) AS LastNo, 0 AS ListNo
    FROM dbo.EMRunBrch WITH (NOLOCK) WHERE RunCode = @rc AND BrchID = @br
    UNION ALL
    SELECT 'EMRunChar', RTRIM(Prefix), RTRIM(Lastno), ListNo
    FROM dbo.EMRunChar WITH (NOLOCK) WHERE RunCode = @rc AND BrchID = @br`, {
    rc: { type: sql.VarChar(30), value: String(runCode) },
    br: { type: sql.Int, value: Number(brchId) },
  }));
  const brch = rows.find(r => r.Source === 'EMRunBrch');
  if (brch && String(brch.Fmt || '').startsWith(p)) return { lastNo: brch.LastNo || null, location: 'EMRunBrch' };
  const ch = rows.filter(r => r.Source === 'EMRunChar' && String(r.Fmt || '').startsWith(p))
    .sort((a, b) => Number(a.ListNo) - Number(b.ListNo))[0];
  return ch ? { lastNo: ch.LastNo || null, location: 'EMRunChar' } : { lastNo: null, location: null };
}

let advanceProcAvailable = null;
async function hasAdvanceProc(queryFn) {
  if (advanceProcAvailable !== null) return advanceProcAvailable;
  try {
    const r = await queryFn(`SELECT CASE WHEN OBJECT_ID('wf.sp_AdvanceDocuCounter', 'P') IS NULL THEN 0 ELSE 1 END AS HasProc`);
    advanceProcAvailable = Number(resultRows(r)[0]?.HasProc || 0) === 1;
  } catch {
    advanceProcAvailable = false;
  }
  return advanceProcAvailable;
}

/**
 * Advance WINSpeed's booking counter to `docuNo` (forward-only, format-guarded).
 * With migration 145: wf.sp_AdvanceDocuCounter locks the RunCode's rows in both
 * tables and advances whichever row holds the prefix (I or K). Without it only the
 * I book in EMRunBrch can be advanced (the app login cannot UPDATE dbo.EMRunChar).
 */
async function advanceDocuNoCounter(docuNo, options = {}) {
  const no = String(docuNo || '').trim();
  if (!/^[IK]\d{2}-\d{5}$/.test(no)) return { updated: false, reason: 'INVALID_DOCUMENT_NUMBER' };
  const runCode = RUN_CODE_BY_PREFIX[no[0]];
  const query = options.query || dboWrite;
  try {
    if (await hasAdvanceProc(query)) {
      const r = await query(`
        DECLARE @u INT, @l VARCHAR(20);
        EXEC wf.sp_AdvanceDocuCounter @RunCode = @rc, @DocuNo = @no, @BrchID = 1, @Updated = @u OUTPUT, @Location = @l OUTPUT;
        SELECT @u AS Updated, @l AS Location;`, {
        no: { type: sql.VarChar(30), value: no },
        rc: { type: sql.VarChar(30), value: runCode },
      });
      const row = resultRows(r)[0] || {};
      const updated = Number(row.Updated || 0) > 0;
      if (!updated) console.warn(`[booking-counter] ${no}: counter unchanged (already ahead or no row for prefix ${no[0]})`);
      return { updated, runCode, location: row.Location || null, ...(updated ? {} : { reason: 'NOT_BEHIND_OR_NO_ROW' }) };
    }

    if (no[0] !== 'I') {
      console.warn(`[booking-counter] ${no}: K counter lives in dbo.EMRunChar — apply migration 145 (wf.sp_AdvanceDocuCounter) to advance it`);
      return { updated: false, runCode, reason: 'K_COUNTER_NEEDS_MIGRATION_145' };
    }
    const r = await query(`
      UPDATE b SET LastNo = @no
      FROM dbo.EMRunBrch b
      INNER JOIN dbo.EMRun r ON r.RunCode = b.RunCode
      WHERE b.RunCode = @rc AND b.BrchID = 1
        AND r.RunFormat LIKE @format AND b.RunFormat LIKE @format
        AND (b.LastNo IS NULL OR RTRIM(b.LastNo) = '' OR
             (b.LastNo LIKE @format AND RTRIM(b.LastNo) < @no))`, {
      no: { type: sql.VarChar(30), value: no },
      rc: { type: sql.VarChar(30), value: runCode },
      format: { type: sql.VarChar(30), value: no[0] + '%' },
    });
    const updated = (r.rowsAffected?.[0] || 0) > 0;
    if (!updated) console.warn('[emrunbrch] Counter unchanged: format guard or current number is not behind');
    return { updated, runCode, ...(updated ? {} : { reason: 'FORMAT_MISMATCH_OR_NOT_BEHIND' }) };
  } catch (e) {
    if (options.strict) throw e;
    console.error('[booking-counter] Counter write failed:', e.message);
    return { updated: false, error: e.message };
  }
}

// Quotation documents (R12 live finding QT-F1): WINSpeed numbers them from EMRunBrch too —
// 102 ใบเสนอราคา (QUyymm-00000) and 113 อนุมัติใบเสนอราคา (QCyy-00000).
const RUN_CODE_BY_DOC_KIND = Object.freeze({ QU: '102', QC: '113' });

/**
 * Advance any WINSpeed document counter to `docuNo` through wf.sp_AdvanceDocuCounter
 * (forward-only, same prefix and length only). Needs migration 145; without it nothing
 * is written and the reason says so.
 */
async function advanceRunCounter(runCode, docuNo, options = {}) {
  const no = String(docuNo || '').trim();
  if (!runCode || !/^[A-Z]{1,3}\d{2,4}-\d{5}$/.test(no)) return { updated: false, reason: 'INVALID_DOCUMENT_NUMBER' };
  const query = options.query || dboWrite;
  try {
    if (!(await hasAdvanceProc(query))) {
      console.warn(`[doc-counter] ${no}: apply migration 145 (wf.sp_AdvanceDocuCounter) so WINSpeed's ${runCode} counter follows the app`);
      return { updated: false, runCode, reason: 'NEEDS_MIGRATION_145' };
    }
    const r = await query(`
      DECLARE @u INT, @l VARCHAR(20);
      EXEC wf.sp_AdvanceDocuCounter @RunCode = @rc, @DocuNo = @no, @BrchID = 1, @Updated = @u OUTPUT, @Location = @l OUTPUT;
      SELECT @u AS Updated, @l AS Location;`, {
      no: { type: sql.VarChar(30), value: no },
      rc: { type: sql.VarChar(30), value: String(runCode) },
    });
    const row = resultRows(r)[0] || {};
    const updated = Number(row.Updated || 0) > 0;
    return { updated, runCode, location: row.Location || null, ...(updated ? {} : { reason: 'NOT_BEHIND_OR_NO_ROW' }) };
  } catch (e) {
    if (options.strict) throw e;
    console.error(`[doc-counter] ${no}: counter write failed:`, e.message);
    return { updated: false, runCode, error: e.message };
  }
}

function _resetCounterProcCache() { advanceProcAvailable = null; }

module.exports = { advanceDocuNoCounter, advanceRunCounter, readBookCounter, RUN_CODE_BY_PREFIX, RUN_CODE_BY_DOC_KIND, _resetCounterProcCache };
