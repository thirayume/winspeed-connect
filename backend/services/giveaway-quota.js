/**
 * giveaway-quota.js — server-side giveaway quota check (R11 U-7 / U-8)
 *
 * A giveaway line asks for pieces of one budget line: region (the bill's sales
 * user) × brand × item. The same matcher decides the budget line for the quota
 * display, this check and the withdrawal written at confirm (giveaway-matcher.js).
 *
 * available = RemainingQty (budget − withdrawn) − pieces already on the user's
 * other open drafts for the same budget line. Withdrawals are written only at
 * confirm, so open drafts must be counted or two drafts could both pass.
 */
const { sql } = require('../db');
const { matchGiveawayItem, findMatchingQuota } = require('./giveaway-matcher');

function currentBuddhistYear(date = new Date()) {
  const y = date.getFullYear();
  return y < 2500 ? y + 543 : y;
}

/**
 * Pieces on a giveaway line, one rule for every caller (U-5):
 *  - an explicit pieceQty wins;
 *  - the bill editor and pre-U-5 rows keep the piece count in the ton field;
 *  - rows saved since U-5 keep QtyTon = 0 and the pieces in QtyBag.
 */
function linePieces(line = {}) {
  const explicit = Number(line.pieceQty ?? line.QtyPiece ?? line.qtyPiece);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const ton = Number(line.qtyTon ?? line.QtyTon);
  if (Number.isFinite(ton) && ton > 0) return ton;
  const bag = Number(line.qtyBag ?? line.QtyBag);
  return Number.isFinite(bag) && bag > 0 ? bag : 0;
}

/** Brand/item mapping rows for a good (same filter as draft-confirmation). */
async function loadMapping(queryFn, goodId) {
  if (!goodId) return null;
  try {
    const rows = (await queryFn(`
      SELECT Brand, ItemName FROM wf.GiveawayItemMapping
      WHERE GoodID = @g AND ISNUMERIC(Brand) = 0 AND ItemName NOT IN (N'รถเกษตร', N'ปุ๋ยเทพ')
      ORDER BY Id ASC
    `, { g: { type: sql.VarChar(50), value: String(goodId) } }))?.recordset || [];
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function describeLine(queryFn, line) {
  const goodId = line.goodId ?? line.GoodId;
  const goodName = line.goodName ?? line.GoodName;
  const map = await loadMapping(queryFn, goodId);
  return {
    goodId,
    goodName,
    brand: map?.Brand || null,
    itemName: map?.ItemName || null,
  };
}

/** Quota rows (budget lines) of a sales user for a year. */
async function loadQuotaRows(queryFn, salesUserId, periodYear = null) {
  if (!salesUserId) return [];
  return (await queryFn(`
    SELECT Region, Brand, ItemName, BudgetQty, WithdrawnQty, RemainingQty
    FROM wf.v_GiveawayBudgetStatus
    WHERE SalesUserId = @su AND PeriodYear = @y
  `, { su: { type: sql.Int, value: Number(salesUserId) }, y: { type: sql.Int, value: periodYear || currentBuddhistYear() } }))?.recordset || [];
}

const quotaKey = (q) => `${q.Region}|${q.Brand}|${q.ItemName}`;

/** Pieces already promised on the user's open drafts, per budget line (key = region|brand|item). */
async function committedOnOpenDrafts(queryFn, salesUserId, quotaRows, excludeSoId = null) {
  const committed = new Map();
  if (!salesUserId || !quotaRows.length) return committed;
  const others = (await queryFn(`
    SELECT CAST(s.Id AS VARCHAR(50)) AS SoId, l.GoodId, l.GoodName, l.QtyTon, l.QtyBag
    FROM wf.SalesOrderLine l
    JOIN wf.SalesOrder s ON s.Id = l.SoId
    WHERE s.Status = 'DRAFT' AND s.SalesUserId = @su AND l.IsGiveaway = 1
      AND (@ex IS NULL OR CAST(s.Id AS VARCHAR(50)) <> @ex)
  `, {
    su: { type: sql.Int, value: Number(salesUserId) },
    ex: { type: sql.VarChar(50), value: excludeSoId != null ? String(excludeSoId) : null },
  }))?.recordset || [];
  for (const o of others) {
    const q = findMatchingQuota(await describeLine(queryFn, o), quotaRows);
    if (!q) continue;
    committed.set(quotaKey(q), (committed.get(quotaKey(q)) || 0) + linePieces(o));
  }
  return committed;
}

/**
 * Check giveaway lines against the sales user's quota.
 * @param {object} p
 * @param {Function} p.queryFn  (sqlText, inputs) => { recordset } — use the open transaction
 * @param {number}   p.salesUserId  bill owner whose region budget applies
 * @param {Array}    p.lines        bill lines (only isGiveaway lines are checked)
 * @param {string}   [p.excludeSoId] draft being edited/approved (its own lines are not "other drafts")
 * @param {number}   [p.periodYear]
 * @returns {{ ok: boolean, checked: Array, problems: Array }}
 */
async function checkGiveawayQuota({ queryFn, salesUserId, lines = [], excludeSoId = null, periodYear = null }) {
  const gwLines = (lines || [])
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => Boolean(l.isGiveaway ?? l.IsGiveaway));
  if (gwLines.length === 0) return { ok: true, checked: [], problems: [] };

  const quotaRows = await loadQuotaRows(queryFn, salesUserId, periodYear);
  // Pieces already promised on the user's other open drafts, per budget line
  const committed = await committedOnOpenDrafts(queryFn, salesUserId, quotaRows, excludeSoId);

  // Sum this bill's requests per budget line, then compare
  const requested = new Map();
  const checked = [];
  const problems = [];
  for (const { l, idx } of gwLines) {
    const d = await describeLine(queryFn, l);
    const matched = matchGiveawayItem(d);
    const pieces = linePieces(l);
    const q = findMatchingQuota(d, quotaRows);
    if (!q) {
      problems.push({
        lineNum: idx + 1, goodName: d.goodName, brand: matched.brand, itemName: matched.itemName,
        requested: pieces, available: 0, reason: 'NO_BUDGET_LINE',
      });
      continue;
    }
    const key = `${q.Region}|${q.Brand}|${q.ItemName}`;
    const entry = requested.get(key) || { q, pieces: 0, lineNums: [], goodName: d.goodName };
    entry.pieces += pieces;
    entry.lineNums.push(idx + 1);
    requested.set(key, entry);
  }
  for (const [key, e] of requested) {
    const available = Number(e.q.RemainingQty || 0) - (committed.get(key) || 0);
    const row = {
      lineNums: e.lineNums, goodName: e.goodName, region: e.q.Region, brand: e.q.Brand, itemName: e.q.ItemName,
      requested: e.pieces, remaining: Number(e.q.RemainingQty || 0), committedOnOtherDrafts: committed.get(key) || 0, available,
    };
    checked.push(row);
    if (e.pieces > available) problems.push({ ...row, lineNum: e.lineNums[0], reason: 'OVER_QUOTA' });
  }
  return { ok: problems.length === 0, checked, problems };
}

/** Thai message for a failed check, pointing to the borrow path. */
function quotaErrorMessage(problems = []) {
  const parts = problems.map(p => p.reason === 'NO_BUDGET_LINE'
    ? `รายการที่ ${p.lineNum} ${p.goodName || ''} (${p.brand} ${p.itemName}) ไม่มีงบของแถมในภาคของผู้ขาย`
    : `${p.brand} ${p.itemName}: ขอ ${p.requested} ชิ้น เหลือใช้ได้ ${Math.max(0, p.available)} ชิ้น`);
  return `โควต้าของแถมไม่พอ — ${parts.join(' · ')} กรุณากด "ขอยืม" โควต้าจากภาคอื่นก่อน`;
}

module.exports = {
  checkGiveawayQuota, quotaErrorMessage, linePieces, currentBuddhistYear,
  loadQuotaRows, committedOnOpenDrafts, quotaKey,
};
