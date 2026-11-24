'use strict';

/**
 * pricelist-report.js — Pricelist & Costlist periodic / comparison report + Excel export.
 *
 * Layout modeled after pricelist.xlsx:
 *   - Side-by-side panels for ปุ๋ยสูตร (compound fertilizers) and ปุ๋ยเดี่ยว/แม่ปุ๋ย (single/base)
 *   - *** marker on DISCONTINUING lines, "งดขาย" on SUSPENDED lines
 *   - Signature block ("ฝ่ายขาย" / "ผู้อนุมัติ") + footnote
 *   - Customer special price table (Pricelist only)
 *   - Strict contiguous -2 .. +2 period window for both weekly (per book) and monthly comparisons
 *   - Strict SQL Server 2008 R2 compatibility (CONVERT, COALESCE, CASE — no FORMAT/STRING_AGG/TRY_CAST)
 */

const XLSX = require('xlsx');
const { sql, wfQuery } = require('../db');
const { getBangkokDateString } = require('./so-pickup-policy');

const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const THAI_MONTHS_LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function toBangkokParts(input) {
  if (!input) return null;
  if (typeof input === 'string') {
    const s = input.trim();
    const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      return { y: Number(dateOnly[1]), m: Number(dateOnly[2]), d: Number(dateOnly[3]), hh: 0, mm: 0 };
    }
    const isoMidnight = s.match(/^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?Z?$/);
    if (isoMidnight) {
      return { y: Number(isoMidnight[1]), m: Number(isoMidnight[2]), d: Number(isoMidnight[3]), hh: 0, mm: 0 };
    }
  }
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return null;
  const bkk = new Date(dt.getTime() + 7 * 60 * 60 * 1000);
  return {
    y: bkk.getUTCFullYear(),
    m: bkk.getUTCMonth() + 1,
    d: bkk.getUTCDate(),
    hh: bkk.getUTCHours(),
    mm: bkk.getUTCMinutes(),
  };
}

function formatThaiBeDate(input, includeTime = false) {
  const p = toBangkokParts(input);
  if (!p) return '-';
  const dd = String(p.d).padStart(2, '0');
  const mm = String(p.m).padStart(2, '0');
  const yyyy = String(p.y + 543);
  if (includeTime) {
    return `${dd}/${mm}/${yyyy} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
  }
  return `${dd}/${mm}/${yyyy}`;
}

function formatMonthLabel(monthKey) {
  const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthKey || '-';
  const yr = Number(m[1]) + 543;
  const mo = Number(m[2]);
  return `${THAI_MONTHS_SHORT[mo - 1] || m[2]} ${yr}`;
}

function classifyProductGroup(row) {
  const gid = Number(row.GoodGroupId ?? row.GoodGroupID ?? 0);
  const gname = String(row.GoodGroupName || '');
  const gnameFull = `${gname} ${String(row.GoodName || '')}`;
  if (gid === 1004 || /แม่ปุ๋ย|ปุ๋ยเดี่ยว|ยูเรีย|ฟอสเฟต|โพแทส/i.test(gname) || /แม่ปุ๋ย|ปุ๋ยเดี่ยว/.test(gnameFull)) {
    return 'SINGLE';
  }
  return 'COMPOUND';
}

function formatStatusMarker(status) {
  if (status === 'DISCONTINUING') return '***';
  if (status === 'SUSPENDED') return 'งดขาย';
  return '';
}

function formatDisplayCellPrice(line) {
  if (!line) return '';
  if (line.LineStatus === 'SUSPENDED') return 'งดขาย';
  if (line.Price == null && line.CostPrice == null) return '';
  const val = line.CostPrice != null ? Number(line.CostPrice) : Number(line.Price);
  return Number.isFinite(val) ? val : '';
}

function deriveMonthKey(book) {
  const em = String(book.EffectiveMonth || '').trim();
  if (/^\d{4}-\d{2}$/.test(em)) return em;
  const ef = String(book.EffectiveFrom || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(ef)) return ef.slice(0, 7);
  return '0000-00';
}

const STATUS_PRIORITY = { ACTIVE: 4, APPROVED: 3, DRAFT: 2, ARCHIVED: 1 };

async function loadBooks(kind, queryFn = wfQuery) {
  const isCost = kind === 'costlist';
  const table = isCost ? 'wf.CostBook' : 'wf.PriceBook';
  const r = await queryFn(`
    SELECT Id, Name, EffectiveMonth,
           CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
           CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo,
           Status
    FROM ${table} WITH (NOLOCK)
    WHERE Status IN ('ACTIVE', 'APPROVED', 'DRAFT', 'ARCHIVED')
    ORDER BY COALESCE(EffectiveFrom, '1900-01-01') ASC, Id ASC
  `);
  const books = [...(r?.recordset || [])];
  if (isCost) return books;
  // Read native history without importing/reconciling master data. One period can
  // have separate compound/base documents; combine only identical date ranges.
  const native = await queryFn(`
    SELECT hd.SetPriceID, RTRIM(hd.DocuNo) AS DocuNo,
           CONVERT(VARCHAR(10), hd.BeginDate, 23) AS EffectiveFrom,
           CONVERT(VARCHAR(10), hd.EndDate, 23) AS EffectiveTo
    FROM dbo.EMSetPriceHD hd
    WHERE hd.CustID IS NULL AND hd.BeginDate IS NOT NULL
      AND EXISTS (SELECT 1 FROM dbo.EMSetPriceDT dt WHERE dt.SetPriceID=hd.SetPriceID AND dt.GoodPriceNet>0)
    ORDER BY hd.BeginDate, hd.SetPriceID
  `);
  const represented = new Set(books.map(b => `${b.EffectiveFrom || ''}|${b.EffectiveTo || ''}`));
  const groups = new Map();
  for (const row of native?.recordset || []) {
    const key = `${row.EffectiveFrom || ''}|${row.EffectiveTo || ''}`;
    if (represented.has(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const today = getBangkokDateString();
  for (const rows of groups.values()) {
    const first = rows[0];
    books.push({ Id: -Number(first.SetPriceID), Name: rows.map(r => r.DocuNo).join(', '),
      EffectiveFrom: first.EffectiveFrom, EffectiveTo: first.EffectiveTo,
      EffectiveMonth: first.EffectiveFrom.slice(0,7),
      Status: first.EffectiveFrom > today ? 'APPROVED' : 'ARCHIVED',
      nativeSetIds: rows.map(r => Number(r.SetPriceID)) });
  }
  return books.sort((a,b) => String(a.EffectiveFrom || '').localeCompare(String(b.EffectiveFrom || '')) || Number(a.Id)-Number(b.Id));
}

function chooseCurrentIndex(items, todayStr) {
  if (!items.length) return -1;
  // 1. Active period covering today
  let idx = items.findIndex(p =>
    p.status === 'ACTIVE' &&
    (!p.effectiveFrom || p.effectiveFrom <= todayStr) &&
    (!p.effectiveTo || p.effectiveTo >= todayStr)
  );
  if (idx >= 0) return idx;
  // 2. Any period covering today (prefer highest status)
  let bestCoveredIdx = -1;
  let bestScore = -1;
  items.forEach((p, i) => {
    if ((!p.effectiveFrom || p.effectiveFrom <= todayStr) && (!p.effectiveTo || p.effectiveTo >= todayStr)) {
      const s = STATUS_PRIORITY[p.status] || 0;
      if (s >= bestScore) { bestScore = s; bestCoveredIdx = i; }
    }
  });
  if (bestCoveredIdx >= 0) return bestCoveredIdx;
  // 3. Latest ACTIVE period
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].status === 'ACTIVE') return i;
  }
  // 4. Nearest by EffectiveFrom
  let nearestIdx = items.length - 1;
  let minDiff = Infinity;
  const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
  items.forEach((p, i) => {
    if (!p.effectiveFrom) return;
    const diff = Math.abs(new Date(`${p.effectiveFrom}T00:00:00Z`).getTime() - todayMs);
    if (diff <= minDiff) { minDiff = diff; nearestIdx = i; }
  });
  return nearestIdx;
}

/**
 * Returns selectable period candidates strictly bounded to [-2, +2] relative to the current period.
 */
async function listSelectablePeriods({ kind = 'pricelist', granularity = 'week', queryFn = wfQuery } = {}) {
  const normKind = kind === 'costlist' ? 'costlist' : 'pricelist';
  const normGranularity = granularity === 'month' ? 'month' : 'week';
  const todayStr = getBangkokDateString();
  const books = await loadBooks(normKind, queryFn);

  if (!books.length) {
    return { kind: normKind, granularity: normGranularity, currentKey: null, periods: [] };
  }

  let items = [];
  if (normGranularity === 'month') {
    const byMonth = new Map();
    for (const b of books) {
      const mKey = deriveMonthKey(b);
      const prev = byMonth.get(mKey);
      const curPri = STATUS_PRIORITY[b.Status] || 0;
      const prevPri = prev ? (STATUS_PRIORITY[prev.status] || 0) : -1;
      if (!prev || curPri > prevPri || (curPri === prevPri && (String(b.EffectiveFrom || '') > String(prev.effectiveFrom || '') || (String(b.EffectiveFrom || '') === String(prev.effectiveFrom || '') && Number(b.Id) > Number(prev.id))))) {
        byMonth.set(mKey, {
          key: mKey,
          id: Number(b.Id),
          nativeSetIds: b.nativeSetIds,
          bookIds: prev ? [...prev.bookIds, Number(b.Id)] : [Number(b.Id)],
          name: b.Name,
          effectiveMonth: mKey,
          effectiveFrom: b.EffectiveFrom || (mKey !== '0000-00' ? `${mKey}-01` : null),
          effectiveTo: b.EffectiveTo || null,
          status: b.Status,
          label: formatMonthLabel(mKey),
          shortLabel: formatMonthLabel(mKey),
        });
      } else if (prev) {
        prev.bookIds.push(Number(b.Id));
      }
    }
    items = [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key));
  } else {
    items = books.map(b => {
      const fromStr = formatThaiBeDate(b.EffectiveFrom || b.EffectiveMonth);
      const toStr = b.EffectiveTo ? formatThaiBeDate(b.EffectiveTo) : '';
      const rangeLabel = toStr && toStr !== '-' ? `${fromStr} – ${toStr}` : fromStr;
      return {
        key: String(b.Id),
        id: Number(b.Id),
        bookIds: [Number(b.Id)],
        nativeSetIds: b.nativeSetIds,
        name: b.Name,
        effectiveMonth: deriveMonthKey(b),
        effectiveFrom: b.EffectiveFrom || null,
        effectiveTo: b.EffectiveTo || null,
        status: b.Status,
        label: rangeLabel,
        shortLabel: b.EffectiveFrom && b.EffectiveTo
          ? `${formatThaiBeDate(b.EffectiveFrom).slice(0, 5)}-${formatThaiBeDate(b.EffectiveTo).slice(0, 5)}`
          : fromStr,
      };
    });
  }

  const currentIdx = chooseCurrentIndex(items, todayStr);
  const currentKey = currentIdx >= 0 ? items[currentIdx].key : null;

  const periods = items
    .map((item, idx) => {
      const offset = idx - currentIdx;
      return {
        ...item,
        offset,
        isCurrent: offset === 0,
        offsetLabel: offset === 0 ? 'รอบปัจจุบัน' : (offset > 0 ? `+${offset}` : `${offset}`),
      };
    })
    .filter(p => p.offset >= -2 && p.offset <= 2);

  return {
    kind: normKind,
    granularity: normGranularity,
    currentKey,
    periods,
  };
}

function parseSelectionList(val) {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.flatMap(v => String(v).split(',')).map(s => s.trim()).filter(Boolean);
  }
  return String(val).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Validates that requested comparison periods are strictly within [-2, +2] and form a contiguous sequence.
 */
function assertContiguousWindow(periods, { periodIds = [], offsets = [] } = {}) {
  const keys = parseSelectionList(periodIds);
  const offsetStrs = parseSelectionList(offsets);

  let selected = [];
  if (keys.length > 0) {
    const byKey = new Map(periods.map(p => [String(p.key), p]));
    const byId = new Map(periods.map(p => [String(p.id), p]));
    for (const k of keys) {
      const hit = byKey.get(k) || byId.get(k);
      if (!hit) {
        const err = new Error('เลือกรอบเปรียบเทียบได้เฉพาะช่วง -2 ถึง +2 รอบจากรอบปัจจุบันเท่านั้น');
        err.status = 400;
        err.code = 'PERIOD_OUT_OF_RANGE';
        throw err;
      }
      selected.push(hit);
    }
  } else if (offsetStrs.length > 0) {
    const byOffset = new Map(periods.map(p => [p.offset, p]));
    for (const raw of offsetStrs) {
      const num = Number(raw);
      if (!Number.isInteger(num) || num < -2 || num > 2) {
        const err = new Error('เลือกรอบเปรียบเทียบได้เฉพาะช่วง -2 ถึง +2 รอบจากรอบปัจจุบันเท่านั้น');
        err.status = 400;
        err.code = 'PERIOD_OUT_OF_RANGE';
        throw err;
      }
      const hit = byOffset.get(num);
      if (!hit) {
        const err = new Error(`ไม่พบข้อมูลรอบที่ ${num > 0 ? `+${num}` : num} ในช่วงที่สามารถเปรียบเทียบได้`);
        err.status = 400;
        err.code = 'PERIOD_OUT_OF_RANGE';
        throw err;
      }
      selected.push(hit);
    }
  } else {
    selected = [...periods];
  }

  // Deduplicate and sort chronologically by offset
  const dedup = [...new Map(selected.map(p => [p.key, p])).values()].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < dedup.length; i++) {
    if (dedup[i].offset - dedup[i - 1].offset !== 1) {
      const err = new Error('กรุณาเลือกรอบเปรียบเทียบที่เรียงต่อเนื่องกัน (ห้ามข้ามรอบ เช่น -1 แล้วไป +1)');
      err.status = 400;
      err.code = 'PERIOD_NOT_CONTIGUOUS';
      throw err;
    }
  }
  return dedup;
}

async function fetchLinesForBooks(kind, bookIds, queryFn = wfQuery) {
  if (!bookIds.length) return [];
  const isCost = kind === 'costlist';
  const cleanIds = [...new Set(bookIds.map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!cleanIds.length) return [];

  const inputs = {};
  const idPlaceholders = cleanIds.map((id, i) => {
    const k = `bid${i}`;
    inputs[k] = { type: sql.Int, value: id };
    return `@${k}`;
  }).join(',');

  if (isCost) {
    const res = await queryFn(`
      SELECT l.Id, l.CostBookId AS BookId, l.GoodId, l.GoodCode, l.GoodName,
             l.GoodGroupId, l.GoodGroupName, l.CostPrice, l.Note AS Remark,
             g.GoodGroupID AS EmGoodGroupID, gg.GoodGroupName AS EmGoodGroupName
      FROM wf.CostBookLine l WITH (NOLOCK)
      LEFT JOIN dbo.EMGood g WITH (NOLOCK)
        ON (ISNUMERIC(CONVERT(VARCHAR(50), l.GoodId)) = 1 AND g.GoodID = CAST(l.GoodId AS INT))
        OR (l.GoodCode IS NOT NULL AND g.GoodCode = l.GoodCode)
      LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = g.GoodGroupID
      WHERE l.CostBookId IN (${idPlaceholders})
      ORDER BY l.CostBookId ASC, l.GoodName ASC, l.Id ASC
    `, inputs);
    return (res?.recordset || []).map(r => ({
      ...r,
      GoodGroupId: r.GoodGroupId ?? r.EmGoodGroupID ?? null,
      GoodGroupName: r.GoodGroupName || r.EmGoodGroupName || null,
      LineStatus: 'NORMAL',
    }));
  }

  const res = await queryFn(`
    SELECT l.Id, l.PriceBookId AS BookId, l.GoodId, l.GoodCode, l.GoodName,
           l.GoodGroupId, l.GoodGroupName, l.Price, l.LineStatus, l.Note AS Remark,
           g.GoodGroupID AS EmGoodGroupID, gg.GoodGroupName AS EmGoodGroupName
    FROM wf.PriceBookLine l WITH (NOLOCK)
    LEFT JOIN dbo.EMGood g WITH (NOLOCK)
      ON (ISNUMERIC(CONVERT(VARCHAR(50), l.GoodId)) = 1 AND g.GoodID = CAST(l.GoodId AS INT))
      OR (l.GoodCode IS NOT NULL AND g.GoodCode = l.GoodCode)
    LEFT JOIN dbo.EMGoodGroup gg WITH (NOLOCK) ON gg.GoodGroupID = g.GoodGroupID
    WHERE l.PriceBookId IN (${idPlaceholders})
    ORDER BY l.PriceBookId ASC, l.GoodName ASC, l.Id ASC
  `, inputs);
  return (res?.recordset || []).map(r => ({
    ...r,
    GoodGroupId: r.GoodGroupId ?? r.EmGoodGroupID ?? null,
    GoodGroupName: r.GoodGroupName || r.EmGoodGroupName || null,
  }));
}

async function fetchSpecialPricesForBooks(bookIds, queryFn = wfQuery) {
  if (!bookIds.length) return [];
  const cleanIds = [...new Set(bookIds.map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!cleanIds.length) return [];
  const inputs = {};
  const idPlaceholders = cleanIds.map((id, i) => {
    const k = `spb${i}`;
    inputs[k] = { type: sql.Int, value: id };
    return `@${k}`;
  }).join(',');

  const res = await queryFn(`
    SELECT sp.Id, sp.PriceBookId, sp.CustId,
           COALESCE(sp.CustName, cu.CustName, sp.CustId) AS CustName,
           sp.GoodId, sp.GoodName, sp.RequestedPrice, sp.ApprovedPrice,
           CASE WHEN sp.ApprovedPrice IS NOT NULL AND sp.ApprovedAt IS NOT NULL THEN 'APPROVED' ELSE 'PENDING' END AS Status,
           sp.Note AS ReasonText,
           CONVERT(VARCHAR(10), sp.CreatedAt, 23) AS RequestedDate
    FROM wf.PriceBookSpecialPrice sp WITH (NOLOCK)
    LEFT JOIN dbo.EMCust cu WITH (NOLOCK) ON cu.CustCode = sp.CustId
    WHERE sp.PriceBookId IN (${idPlaceholders})
    ORDER BY sp.PriceBookId DESC, sp.Id DESC
  `, inputs);
  return res?.recordset || [];
}

async function fetchCurrentSaleStatuses(queryFn) {
  const r = await queryFn(`SELECT l.GoodId,l.GoodCode,l.GoodName,l.LineStatus
    FROM wf.PriceBookLine l JOIN wf.PriceBook b ON b.Id=l.PriceBookId
    WHERE b.Status IN ('ACTIVE','APPROVED') AND l.LineStatus='SUSPENDED'
      AND (b.EffectiveFrom IS NULL OR b.EffectiveFrom<=@statusDate)
      AND (b.EffectiveTo IS NULL OR b.EffectiveTo>=@statusDate)`,
    {statusDate:{type:sql.Date,value:getBangkokDateString()}});
  return r?.recordset || [];
}

function canonicalProductKey(line) {
  const name = String(line.GoodName || '').trim().toLowerCase();
  const code = String(line.GoodCode || '').trim().toLowerCase();
  const gid = String(line.GoodId || '').trim();
  return gid ? `id:${gid}` : code ? `code:${code}` : `name:${name}`;
}

function buildSideBySidePairs(items) {
  const half = Math.ceil(items.length / 2);
  const left = items.slice(0, half);
  const right = items.slice(half);
  const pairs = [];
  for (let i = 0; i < half; i++) {
    pairs.push({
      left: left[i] ? { no: i + 1, ...left[i] } : null,
      right: right[i] ? { no: half + i + 1, ...right[i] } : null,
    });
  }
  return pairs;
}

/**
 * Generates report data (columns, rows, meta.sheetLayout) for pricelist_sheet or costlist_sheet.
 */
async function buildSheetReport({
  kind = 'pricelist',
  mode = 'current',
  granularity = 'week',
  periodIds,
  offsets,
  hideSuspended = true, sortBy = 'group-code', sortDirection = 'asc', groupId, search,
  queryFn = wfQuery,
} = {}) {
  const normKind = kind === 'costlist' ? 'costlist' : 'pricelist';
  const normMode = mode === 'compare' ? 'compare' : 'current';
  const selectable = await listSelectablePeriods({ kind: normKind, granularity, queryFn });

  let selectedPeriods = [];
  if (selectable.periods.length > 0) {
    if (normMode === 'current') {
      const cur = selectable.periods.find(p => p.isCurrent) || selectable.periods[selectable.periods.length - 1];
      if (periodIds || offsets) {
        const picked = assertContiguousWindow(selectable.periods, { periodIds, offsets });
        selectedPeriods = picked.length > 0 ? [picked[0]] : [cur];
      } else {
        selectedPeriods = [cur];
      }
    } else {
      selectedPeriods = assertContiguousWindow(selectable.periods, { periodIds, offsets });
    }
  }

  const bookIds = selectedPeriods.filter(p => !p.nativeSetIds).map(p => p.id);
  let allLines = await fetchLinesForBooks(normKind, bookIds, queryFn);
  const nativePeriods = selectedPeriods.filter(p => p.nativeSetIds?.length);
  const setIds = [...new Set(nativePeriods.flatMap(p => p.nativeSetIds))];
  if (setIds.length) {
    const inputs = {};
    const ids = setIds.map((id,i) => { inputs[`sid${i}`]={type:sql.Int,value:id}; return `@sid${i}`; });
    const r = await queryFn(`SELECT dt.ListID AS Id,dt.SetPriceID,CONVERT(VARCHAR(30),g.GoodID) AS GoodId,
      RTRIM(g.GoodCode) AS GoodCode,RTRIM(g.GoodName1) AS GoodName,g.GoodGroupID AS GoodGroupId,
      RTRIM(gg.GoodGroupName) AS GoodGroupName,dt.GoodPriceNet AS Price,RTRIM(dt.Remark) AS Remark,
      'ACTIVE' AS LineStatus FROM dbo.EMSetPriceDT dt
      JOIN dbo.EMGood g ON g.GoodID=dt.ListID
      LEFT JOIN dbo.EMGoodGroup gg ON gg.GoodGroupID=g.GoodGroupID
      WHERE dt.SetPriceID IN (${ids.join(',')}) AND dt.GoodPriceNet>0 ORDER BY dt.SetPriceID,dt.ListID`,inputs);
    for (const period of nativePeriods) {
      const lines = (r?.recordset || []).filter(l => period.nativeSetIds.includes(Number(l.SetPriceID)));
      const seen = new Set();
      for (const line of lines) {
        const key = canonicalProductKey(line);
        if (seen.has(key)) throw Object.assign(new Error('พบราคาสินค้าซ้ำในรอบตาราง WinSpeed กรุณาตรวจชุดราคาให้เหลือรายการเดียวต่อรหัสสินค้า'),{status:409,code:'AMBIGUOUS_NATIVE_PRICE'});
        seen.add(key);allLines.push({...line,BookId:period.id});
      }
    }
  }
  // Current sales suspension applies to both reports, even when comparing history.
  const current = selectable.periods.find(p => p.isCurrent);
  const statusLines = normKind === 'pricelist' && current && bookIds.includes(current.id)
    ? allLines.filter(l => Number(l.BookId)===current.id)
    : await fetchCurrentSaleStatuses(queryFn);
  const suspended = new Set(statusLines.filter(l => l.LineStatus==='SUSPENDED').map(canonicalProductKey));
  const groups = [...new Map(allLines.map(l => [String(l.GoodGroupId || ''),
    {id:String(l.GoodGroupId || ''),name:l.GoodGroupName || 'ไม่ระบุกลุ่ม'}])).values()].sort((a,b)=>Number(a.id)-Number(b.id));
  const hiding = hideSuspended !== false && hideSuspended !== 'false';
  const q = String(search || '').trim().toLowerCase();
  allLines = allLines.filter(l => (!hiding || (!suspended.has(canonicalProductKey(l)) && l.LineStatus!=='SUSPENDED'))
    && (!groupId || String(l.GoodGroupId)===String(groupId))
    && (!q || `${l.GoodId} ${l.GoodCode} ${l.GoodName}`.toLowerCase().includes(q)));
  const sort = ['group-code','group-id','group-name'].includes(sortBy) ? sortBy : 'group-code';
  const direction = sortDirection === 'desc' ? -1 : 1;
  const compareProducts = (a,b) => {
    const group = Number(a.GoodGroupId || 0)-Number(b.GoodGroupId || 0);
    const field = sort==='group-id' ? 'GoodId' : sort==='group-name' ? 'GoodName' : 'GoodCode';
    return group || direction * String(a[field] || '').localeCompare(String(b[field] || ''),'th',{numeric:field==='GoodId'})
      || String(a.GoodId || '').localeCompare(String(b.GoodId || ''),'en',{numeric:true});
  };
  allLines.sort(compareProducts);
  const selectionMeta = {groups,hideSuspended:hiding,sortBy:sort,sortDirection:direction===1?'asc':'desc',
    comparisonNotice:normMode==='compare' && selectedPeriods.length<2 ? 'มีข้อมูลเพียงรอบเดียว ยังไม่สามารถเปรียบเทียบกับรอบอื่นได้' : null};
  const specialPrices = normKind === 'pricelist'
    ? (await fetchSpecialPricesForBooks(bookIds, queryFn)).filter(sp =>
      (!hiding || !suspended.has(canonicalProductKey(sp))) &&
      ((!groupId && !q) || allLines.some(l => canonicalProductKey(l)===canonicalProductKey(sp))))
    : [];

  const linesByBook = new Map();
  for (const l of allLines) {
    const bid = Number(l.BookId);
    if (!linesByBook.has(bid)) linesByBook.set(bid, []);
    linesByBook.get(bid).push(l);
  }

  if(selectionMeta.comparisonNotice) selectionMeta.notes=[selectionMeta.comparisonNotice];

  const titlePrefix = normKind === 'costlist'
    ? 'ตารางราคาทุน (COST LIST) — เฉพาะผู้ได้รับสิทธิ์'
    : 'ตารางราคาขาย (PRICE LIST) — ราคา NET / ตัน';

  if (normMode === 'current') {
    const period = selectedPeriods[0] || null;
    const pLines = period ? (linesByBook.get(period.id) || []) : [];

    const compound = [];
    const single = [];
    for (const l of pLines) {
      const grp = classifyProductGroup(l);
      const entry = {
        goodId: l.GoodId ? String(l.GoodId) : '',
        goodCode: l.GoodCode ? String(l.GoodCode) : '',
        goodName: l.GoodName || '',
        price: normKind === 'costlist' ? Number(l.CostPrice ?? 0) : Number(l.Price ?? 0),
        displayPrice: formatDisplayCellPrice(l),
        lineStatus: l.LineStatus || 'NORMAL',
        marker: formatStatusMarker(l.LineStatus),
        remark: l.Remark || '',
        groupType: grp,
        goodGroupName:l.GoodGroupName || '',
      };
      if (grp === 'SINGLE') single.push(entry);
      else compound.push(entry);
    }

    const columns = [
      { key: 'SectionLabel', label: 'หมวดสินค้า', type: 'text' },
      { key: 'ItemNo', label: 'ลำดับ', type: 'integer' },
      { key: 'GoodCode', label: 'รหัสสินค้า', type: 'identifier' },
      { key: 'GoodName', label: 'รายการ / สูตรปุ๋ย', type: 'text' },
      {
        key: 'UnitPrice',
        label: normKind === 'costlist' ? 'ราคาทุน/ตัน (บาท)' : 'ราคาขาย NET/ตัน (บาท)',
        type: 'money',
        precision: 2,
      },
      { key: 'StatusMarker', label: 'สถานะ', type: 'text' },
      { key: 'Remark', label: 'หมายเหตุ', type: 'text' },
    ];

    const rows = [
      ...compound.map((it, idx) => ({
        SectionLabel: it.goodGroupName || 'ปุ๋ยสูตร',
        ItemNo: idx + 1,
        GoodCode: it.goodCode || it.goodId,
        GoodName: it.goodName,
        UnitPrice: it.lineStatus === 'SUSPENDED' ? 'งดขาย' : it.price,
        StatusMarker: it.marker || 'ปกติ',
        Remark: it.remark || '',
      })),
      ...single.map((it, idx) => ({
        SectionLabel: it.goodGroupName || 'ปุ๋ยเดี่ยว/แม่ปุ๋ย',
        ItemNo: compound.length + idx + 1,
        GoodCode: it.goodCode || it.goodId,
        GoodName: it.goodName,
        UnitPrice: it.lineStatus === 'SUSPENDED' ? 'งดขาย' : it.price,
        StatusMarker: it.marker || 'ปกติ',
        Remark: it.remark || '',
      })),
    ];

    const periodDateRange = period
      ? `รอบวันที่ ${period.label}${period.name ? ` (${period.name})` : ''}`
      : 'ยังไม่มีข้อมูลรอบราคา';

    return {
      columns,
      rows,
      meta: {
        ...selectionMeta,
        kind: normKind,
        mode: 'current',
        granularity: selectable.granularity,
        periods: selectable.periods.map(p => ({
          ...p,
          selected: selectedPeriods.some(sp => sp.key === p.key),
        })),
        selectedPeriods,
        sheetLayout: {
          mode: 'current',
          kind: normKind,
          title: titlePrefix,
          periodSubtitle: periodDateRange,
          generatedAt: formatThaiBeDate(new Date(), true),
          priceHeaderLabel: normKind === 'costlist' ? 'ราคาทุน/ตัน' : 'ราคา NET ',
          compoundPairs: buildSideBySidePairs(compound),
          singlePairs: buildSideBySidePairs(single).map((pair, idx) => ({
            left: pair.left ? { ...pair.left, no: compound.length + idx + 1 } : null,
            right: pair.right ? { ...pair.right, no: compound.length + Math.ceil(single.length / 2) + idx + 1 } : null,
          })),
          specialPrices: specialPrices.map(sp => ({
            custId: sp.CustId,
            custName: sp.CustName,
            goodName: sp.GoodName,
            price: Number(sp.ApprovedPrice ?? sp.RequestedPrice ?? 0),
            status: sp.Status,
            reasonText: sp.ReasonText || '',
          })),
          signatures: { leftLabel: 'ฝ่ายขาย', rightLabel: 'ผู้อนุมัติ' },
          footnote: normKind === 'costlist'
            ? 'เอกสารลับเฉพาะผู้ได้รับสิทธิ์ — ห้ามเผยแพร่ต่อบุคคลภายนอกและฝ่ายขาย'
            : 'หมายเหตุ: *** = สินค้ากำลังยกเลิกจำหน่าย | งดขาย = ระงับการขายชั่วคราว',
        },
      },
    };
  }

  // Compare mode across contiguous selectedPeriods (-2 .. +2)
  const productMap = new Map();
  for (const sp of selectedPeriods) {
    const pLines = linesByBook.get(sp.id) || [];
    for (const l of pLines) {
      const pk = canonicalProductKey(l);
      if (!productMap.has(pk)) {
        productMap.set(pk, {
          groupType: classifyProductGroup(l),
          GoodGroupId:l.GoodGroupId, GoodId:l.GoodId, GoodCode:l.GoodCode, GoodName:l.GoodName,
          goodGroupName:l.GoodGroupName || '',
          goodId: l.GoodId ? String(l.GoodId) : '',
          goodCode: l.GoodCode ? String(l.GoodCode) : '',
          goodName: l.GoodName || '',
          byPeriod: {},
        });
      }
      const rec = productMap.get(pk);
      rec.byPeriod[sp.key] = {
        price: normKind === 'costlist' ? Number(l.CostPrice ?? 0) : Number(l.Price ?? 0),
        displayPrice: formatDisplayCellPrice(l),
        lineStatus: l.LineStatus || 'NORMAL',
        marker: formatStatusMarker(l.LineStatus),
        remark: l.Remark || '',
      };
    }
  }

  const allProducts = [...productMap.values()].sort((a, b) => {
    if (a.groupType !== b.groupType) return a.groupType === 'COMPOUND' ? -1 : 1;
    return compareProducts(a,b);
  });

  const periodCols = selectedPeriods.map((sp, idx) => ({
    key: `p_${idx}`,
    periodKey: sp.key,
    label: `${sp.offsetLabel}: ${sp.shortLabel}`,
    type: 'money',
    precision: 2,
    isCurrent: sp.isCurrent,
  }));

  const columns = [
    { key: 'SectionLabel', label: 'หมวดสินค้า', type: 'text' },
    { key: 'ItemNo', label: 'ลำดับ', type: 'integer' },
    { key: 'GoodCode', label: 'รหัสสินค้า', type: 'identifier' },
    { key: 'GoodName', label: 'รายการ / สูตรปุ๋ย', type: 'text' },
    ...periodCols,
    { key: 'Delta', label: 'ส่วนต่าง (ล่าสุด-แรกสุด)', type: 'money', precision: 2 },
    { key: 'StatusMarker', label: 'สถานะล่าสุด', type: 'text' },
  ];

  const rows = allProducts.map((prod, idx) => {
    const row = {
      SectionLabel: prod.goodGroupName || (prod.groupType === 'SINGLE' ? 'ปุ๋ยเดี่ยว/แม่ปุ๋ย' : 'ปุ๋ยสูตร'),
      ItemNo: idx + 1,
      GoodCode: prod.goodCode || prod.goodId,
      GoodName: prod.goodName,
    };
    const numericPrices = [];
    selectedPeriods.forEach((sp, pIdx) => {
      const cell = prod.byPeriod[sp.key];
      if (!cell) {
        row[`p_${pIdx}`] = '';
      } else if (cell.lineStatus === 'SUSPENDED') {
        row[`p_${pIdx}`] = 'งดขาย';
      } else {
        row[`p_${pIdx}`] = cell.price;
        numericPrices.push(cell.price);
      }
    });
    const lastSp = selectedPeriods[selectedPeriods.length - 1];
    const lastCell = lastSp ? prod.byPeriod[lastSp.key] : null;
    const firstCell = selectedPeriods[0] ? prod.byPeriod[selectedPeriods[0].key] : null;
    if (firstCell && lastCell && firstCell.lineStatus !== 'SUSPENDED' && lastCell.lineStatus !== 'SUSPENDED') {
      row.Delta = Number((lastCell.price - firstCell.price).toFixed(2));
    } else {
      row.Delta = '';
    }
    row.StatusMarker = lastCell?.marker || 'ปกติ';
    return row;
  });

  return {
    columns,
    rows,
    meta: {
      ...selectionMeta,
      kind: normKind,
      mode: 'compare',
      granularity: selectable.granularity,
      periods: selectable.periods.map(p => ({
        ...p,
        selected: selectedPeriods.some(sp => sp.key === p.key),
      })),
      selectedPeriods,
      sheetLayout: {
        mode: 'compare',
        kind: normKind,
        title: `${titlePrefix} (เปรียบเทียบ ${selectedPeriods.length} รอบต่อเนื่อง)`,
        periodSubtitle: selectedPeriods.map(sp => `${sp.offsetLabel}: ${sp.label}`).join('  |  '),
        generatedAt: formatThaiBeDate(new Date(), true),
        selectedPeriods,
        products: allProducts,
        specialPrices: specialPrices.map(sp => ({
          custId: sp.CustId,
          custName: sp.CustName,
          goodName: sp.GoodName,
          price: Number(sp.ApprovedPrice ?? sp.RequestedPrice ?? 0),
          status: sp.Status,
          reasonText: sp.ReasonText || '',
        })),
        signatures: { leftLabel: 'ฝ่ายขาย', rightLabel: 'ผู้อนุมัติ' },
        footnote: normKind === 'costlist'
          ? 'เอกสารลับเฉพาะผู้ได้รับสิทธิ์ — ห้ามเผยแพร่ต่อบุคคลภายนอกและฝ่ายขาย'
          : 'หมายเหตุ: *** = สินค้ากำลังยกเลิกจำหน่าย | งดขาย = ระงับการขายชั่วคราว',
      },
    },
  };
}

/**
 * Generates a pricelist.xlsx-style Excel Workbook using SheetJS.
 */
function buildSheetWorkbook({ reportData }) {
  const layout = reportData?.meta?.sheetLayout;
  const wb = XLSX.utils.book_new();
  if (!layout) {
    const ws = XLSX.utils.json_to_sheet(reportData?.rows || []);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return wb;
  }

  const aoa = [];
  const merges = [];

  if (layout.mode === 'current') {
    // Columns A..N (14 columns matching pricelist.xlsx side-by-side panels)
    aoa.push([layout.title, ...Array(13).fill('')]);
    aoa.push([`พิมพ์เมื่อ: ${layout.generatedAt}`, ...Array(13).fill('')]);
    aoa.push(Array(14).fill(''));
    aoa.push(['', '', layout.priceHeaderLabel, '', '', '', '', '', '', layout.priceHeaderLabel, '', '', '', '']);
    aoa.push(['รอบราคา', '', layout.periodSubtitle, '', '', '', '', 'รอบราคา', '', layout.periodSubtitle, '', '', '', '']);
    aoa.push([
      'ที่', 'รหัส/สูตร (ซ้าย)', 'ราคา/ตัน', 'สถานะ', 'หมายเหตุ', '', '',
      'ที่', 'รหัส/สูตร (ขวา)', 'ราคา/ตัน', 'สถานะ', 'หมายเหตุ', '', '',
    ]);

    merges.push(
      { s: { r: 0, c: 0 }, e: { r: 1, c: 13 } },
      { s: { r: 3, c: 2 }, e: { r: 3, c: 5 } },
      { s: { r: 3, c: 9 }, e: { r: 3, c: 12 } },
      { s: { r: 4, c: 2 }, e: { r: 4, c: 6 } },
      { s: { r: 4, c: 9 }, e: { r: 4, c: 13 } },
    );

    const pushPairs = (sectionHeader, pairs) => {
      if (!pairs.length) return;
      const hr = aoa.length;
      aoa.push([sectionHeader, ...Array(13).fill('')]);
      merges.push({ s: { r: hr, c: 0 }, e: { r: hr, c: 13 } });
      for (const p of pairs) {
        const l = p.left;
        const r = p.right;
        aoa.push([
          l ? l.no : '',
          l ? `${l.goodCode ? `[${l.goodCode}] ` : ''}${l.goodName}` : '',
          l ? l.displayPrice : '',
          l ? l.marker : '',
          l ? (l.remark || '') : '',
          '',
          '',
          r ? r.no : '',
          r ? `${r.goodCode ? `[${r.goodCode}] ` : ''}${r.goodName}` : '',
          r ? r.displayPrice : '',
          r ? r.marker : '',
          r ? (r.remark || '') : '',
          '',
          '',
        ]);
      }
    };

    pushPairs('หมวด: ปุ๋ยสูตร', layout.compoundPairs || []);
    pushPairs('หมวด: ปุ๋ยเดี่ยว / แม่ปุ๋ย', layout.singlePairs || []);

    aoa.push(Array(14).fill(''));
    const sigRow = aoa.length;
    aoa.push([
      '', layout.signatures?.leftLabel || 'ฝ่ายขาย', '_____________________', '', '', '', '',
      '', layout.signatures?.rightLabel || 'ผู้อนุมัติ', '_____________________', '', '', '', '',
    ]);
    merges.push(
      { s: { r: sigRow, c: 2 }, e: { r: sigRow, c: 5 } },
      { s: { r: sigRow, c: 9 }, e: { r: sigRow, c: 12 } },
    );

    aoa.push(Array(14).fill(''));
    const footRow = aoa.length;
    aoa.push([[layout.footnote,reportData.meta?.comparisonNotice].filter(Boolean).join(' | '), ...Array(13).fill('')]);
    merges.push({ s: { r: footRow, c: 0 }, e: { r: footRow, c: 13 } });

    if (layout.specialPrices && layout.specialPrices.length > 0) {
      aoa.push(Array(14).fill(''));
      const spTitle = aoa.length;
      aoa.push(['รายการขอราคาพิเศษรายร้านค้า', ...Array(13).fill('')]);
      merges.push({ s: { r: spTitle, c: 0 }, e: { r: spTitle, c: 13 } });
      aoa.push(['รหัสลูกค้า', 'ชื่อร้านค้า', 'สูตรปุ๋ย', 'ราคาพิเศษ (บาท/ตัน)', 'สถานะ', 'หมายเหตุ', '', '', '', '', '', '', '', '']);
      for (const sp of layout.specialPrices) {
        aoa.push([sp.custId, sp.custName, sp.goodName, sp.price, sp.status, sp.reasonText, '', '', '', '', '', '', '', '']);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;
    ws['!cols'] = [
      { wch: 6 }, { wch: 30 }, { wch: 13 }, { wch: 10 }, { wch: 16 }, { wch: 4 }, { wch: 4 },
      { wch: 6 }, { wch: 30 }, { wch: 13 }, { wch: 10 }, { wch: 16 }, { wch: 4 }, { wch: 4 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return wb;
  }

  // Compare sheet
  const colsCount = Math.max(6, (reportData.columns || []).length);
  aoa.push([layout.title, ...Array(colsCount - 1).fill('')]);
  aoa.push([`${layout.periodSubtitle}  |  พิมพ์เมื่อ: ${layout.generatedAt}`, ...Array(colsCount - 1).fill('')]);
  aoa.push(Array(colsCount).fill(''));
  aoa.push((reportData.columns || []).map(c => c.label));
  merges.push(
    { s: { r: 0, c: 0 }, e: { r: 0, c: colsCount - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: colsCount - 1 } },
  );

  for (const row of reportData.rows || []) {
    aoa.push((reportData.columns || []).map(c => (row[c.key] ?? '')));
  }
  aoa.push(Array(colsCount).fill(''));
  aoa.push(['', layout.signatures?.leftLabel || 'ฝ่ายขาย', '___________________', layout.signatures?.rightLabel || 'ผู้อนุมัติ', '___________________', ...Array(Math.max(0, colsCount - 5)).fill('')]);
  aoa.push([[layout.footnote,reportData.meta?.comparisonNotice].filter(Boolean).join(' | '), ...Array(colsCount - 1).fill('')]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = (reportData.columns || []).map((c, idx) => ({ wch: idx === 3 ? 34 : 16 }));
  XLSX.utils.book_append_sheet(wb, ws, 'Comparison');
  return wb;
}

module.exports = {
  toBangkokParts,
  formatThaiBeDate,
  listSelectablePeriods,
  assertContiguousWindow,
  buildSheetReport,
  buildSheetWorkbook,
};

