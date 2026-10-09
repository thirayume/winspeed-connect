'use strict';

/**
 * Rebate requester codes on WINSpeed RB documents: RB<code><BE year 2 digits>-<seq>, e.g. RBT69-110.
 *
 * dbo.SOInvHD Docutype 106 carries no EmpID, so the letters in the number are the only trace of who asked
 * (migration 079). Owner 2026-10-09: every salesperson and sales manager gets a code automatically, and an admin
 * changes any code in Master data → regional approvers. Codes are given in this order:
 *  1. history: a one-letter series used since 1 January two years back goes to the active user whose customers it
 *     served most, one series per user, the largest counts first. The user keeps the numbering WINSpeed already runs.
 *  2. otherwise two letters from the name: first name + surname, or the first two consonants of a single name, then
 *     the first letter + A…Z. A code WINSpeed has ever used is never given, so nobody continues another person's numbers.
 */
const { sql, wfQuery } = require('../db');

const THAI_INITIAL = {
  'ก':'K','ข':'K','ฃ':'K','ค':'K','ฅ':'K','ฆ':'K','ง':'N','จ':'C','ฉ':'C','ช':'C',
  'ซ':'S','ฌ':'C','ญ':'Y','ฎ':'D','ฏ':'T','ฐ':'T','ฑ':'T','ฒ':'T','ณ':'N','ด':'D',
  'ต':'T','ถ':'T','ท':'T','ธ':'T','น':'N','บ':'B','ป':'P','ผ':'P','ฝ':'F','พ':'P',
  'ฟ':'F','ภ':'P','ม':'M','ย':'Y','ร':'R','ล':'L','ว':'W','ศ':'S','ษ':'S','ส':'S',
  'ห':'H','ฬ':'L','อ':'A','ฮ':'H',
};
const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const HISTORY_MIN_DOCS = 20;

/** roman letters of the consonants in a word, in order (vowels written before a consonant, เ แ โ ใ ไ, are skipped) */
function lettersOf(word) {
  const out = [];
  for (const ch of String(word || '')) {
    if (/[A-Za-z]/.test(ch)) out.push(ch.toUpperCase());
    else if (THAI_INITIAL[ch]) out.push(THAI_INITIAL[ch]);
  }
  return out;
}

/** two-letter candidates for a name, best first */
function nameCodes(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const first = lettersOf(parts[0]);
  if (!first.length) return [];
  const out = [];
  if (parts[1] && lettersOf(parts[1])[0]) out.push(first[0] + lettersOf(parts[1])[0]);
  // a single name (or as a fallback): first consonant + the next consonant of the name, e.g. รุ่งพล → RN
  const second = first.slice(1).find(Boolean);
  if (second) out.push(first[0] + second);
  for (const c of AZ) out.push(first[0] + c);
  return [...new Set(out)];
}

/**
 * Pure planner: which code each user without one gets.
 * users    [{ Id, DisplayName, Username, EmpId, RebateDocCode }] active SALES/MANAGER users
 * evidence [{ SeriesCode, EmpId, DocCount }] one-letter series by the customers' main salesperson
 * reserved codes WINSpeed has used on RB documents (any year)
 * existing codes already held in wf.AppUser (any user, active or not)
 */
function planRebateDocCodes({ users, evidence = [], reserved = [], existing = [] }) {
  const taken = new Set(existing.filter(Boolean));
  const blocked = new Set(reserved.filter(Boolean));
  const waiting = users.filter(u => !u.RebateDocCode);
  const done = new Set();
  const plan = [];
  const byEmp = new Map(waiting.filter(u => u.EmpId != null).map(u => [String(u.EmpId).trim(), u]));

  const ranked = [...evidence].filter(e => Number(e.DocCount) >= HISTORY_MIN_DOCS)
    .sort((a, b) => Number(b.DocCount) - Number(a.DocCount) || String(a.SeriesCode).localeCompare(String(b.SeriesCode)));
  for (const e of ranked) {
    const u = byEmp.get(String(e.EmpId).trim());
    const code = String(e.SeriesCode || '').trim().toUpperCase();
    if (!u || done.has(u.Id) || !/^[A-Z]$/.test(code) || taken.has(code)) continue;
    taken.add(code); done.add(u.Id);
    plan.push({ userId: Number(u.Id), code, source: 'HISTORY', docCount: Number(e.DocCount) });
  }

  for (const u of [...waiting].sort((a, b) => Number(a.Id) - Number(b.Id))) {
    if (done.has(u.Id)) continue;
    const code = nameCodes(u.DisplayName || u.Username).find(c => !taken.has(c) && !blocked.has(c));
    if (!code) continue;
    taken.add(code); done.add(u.Id);
    plan.push({ userId: Number(u.Id), code, source: 'NAME', docCount: 0 });
  }
  return plan;
}

async function loadContext() {
  const since = `${new Date().getFullYear() - 2}-01-01`;
  const [users, evidence, reserved, existing] = await Promise.all([
    wfQuery(`SELECT Id, Username, DisplayName, Role, EmpId, RebateDocCode
             FROM wf.AppUser WHERE IsActive = 1 AND Role IN ('SALES', 'MANAGER')`),
    // the customer's main salesperson over the same window: customers move between salespeople over the years
    wfQuery(`
      WITH CustEmp AS (
        SELECT CustID, EmpID, ROW_NUMBER() OVER (PARTITION BY CustID ORDER BY COUNT(*) DESC, EmpID) AS rn
        FROM dbo.SOHD WITH (NOLOCK)
        WHERE DocuType = 104 AND EmpID IS NOT NULL AND DocuDate >= @since
        GROUP BY CustID, EmpID)
      SELECT SUBSTRING(h.DocuNo, 3, 1) AS SeriesCode, CAST(ce.EmpID AS NVARCHAR(20)) AS EmpId, COUNT(*) AS DocCount
      FROM dbo.SOInvHD h WITH (NOLOCK)
      JOIN CustEmp ce ON ce.CustID = h.CustID AND ce.rn = 1
      WHERE h.Docutype = 106 AND h.DocuNo LIKE 'RB[A-Z][0-9]%' AND h.DocuDate >= @since
      GROUP BY SUBSTRING(h.DocuNo, 3, 1), ce.EmpID`, { since: { type: sql.Date, value: since } }),
    wfQuery(`
      SELECT DISTINCT SUBSTRING(DocuNo, 3, PATINDEX('%[0-9]%', SUBSTRING(DocuNo, 3, 20)) - 1) AS Code
      FROM dbo.SOInvHD WITH (NOLOCK)
      WHERE Docutype = 106 AND DocuNo LIKE 'RB[A-Z]%' AND PATINDEX('%[0-9]%', SUBSTRING(DocuNo, 3, 20)) BETWEEN 2 AND 3`),
    wfQuery(`SELECT RebateDocCode FROM wf.AppUser WHERE RebateDocCode IS NOT NULL`),
  ]);
  return {
    users: users.recordset || [],
    evidence: evidence.recordset || [],
    reserved: (reserved.recordset || []).map(r => String(r.Code || '').trim().toUpperCase()),
    existing: (existing.recordset || []).map(r => String(r.RebateDocCode).trim().toUpperCase()),
  };
}

/** plans for everyone (the history order is global) and writes the codes of userIds, or of everyone */
async function autoAssignRebateDocCodes({ userIds = null, dryRun = false } = {}) {
  const ctx = await loadContext();
  const plan = planRebateDocCodes(ctx).filter(p => !userIds || userIds.map(Number).includes(p.userId));
  if (dryRun) return plan;
  const written = [];
  for (const p of plan) {
    try {
      const r = await wfQuery(
        `UPDATE wf.AppUser SET RebateDocCode = @c WHERE Id = @id AND RebateDocCode IS NULL`,
        { c: { type: sql.NVarChar(2), value: p.code }, id: { type: sql.Int, value: p.userId } });
      if (r.rowsAffected?.[0]) written.push(p);
    } catch (e) {
      // another request took the code a moment ago (unique index): the next call plans again
      if (e.number !== 2601 && e.number !== 2627) throw e;
    }
  }
  return written;
}

/** the user's code, given automatically when an active salesperson or sales manager has none */
async function ensureRebateDocCode(userId) {
  const u = (await wfQuery(
    `SELECT Id, Role, IsActive, RebateDocCode FROM wf.AppUser WHERE Id = @id`,
    { id: { type: sql.Int, value: Number(userId) } })).recordset?.[0];
  if (!u) return null;
  if (u.RebateDocCode) return String(u.RebateDocCode).trim();
  if (!u.IsActive || !['SALES', 'MANAGER'].includes(String(u.Role))) return null;
  const [p] = await autoAssignRebateDocCodes({ userIds: [Number(userId)] });
  return p ? p.code : null;
}

module.exports = { planRebateDocCodes, nameCodes, lettersOf, autoAssignRebateDocCodes, ensureRebateDocCode };
