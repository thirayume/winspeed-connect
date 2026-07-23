/**
 * make-test-dataset.js — สร้างชุดข้อมูลทดสอบ (SO ↔ ใบชั่ง) จาก dbwins_worldfert9 + db_truckscale
 *
 * 3 profile:
 *   1  full     2022-01..2026-02  (~27,454 SO) — สมจริง มี unmatched ~9% ไว้เทสต์ manual match
 *   2  recent   2024-08..2026-02  (~10,747 SO) — ใหม่กว่า ตรง workflow ปัจจุบัน
 *   3  matched  2022-01..2026-02  เฉพาะที่ match ได้ (~25,000 SO) — match 100% by construction
 *
 * ใช้กติกาจับคู่เดียวกับ production: ทะเบียนรถ (แตกทะเบียนรวม/ย่อด้วย expandPlates) + วันที่ ±N วัน
 *
 * USAGE:
 *   node scripts/make-test-dataset.js --profile 1
 *   node scripts/make-test-dataset.js --profile 2 --tol 3 --out C:\wssale-exports\ds2
 *   node scripts/make-test-dataset.js --profile 3
 *
 * OUTPUT (CSV, UTF-8 BOM เปิดใน Excel ได้):
 *   matched-pairs.csv · so-list.csv · weigh-list.csv · unmatched-so.csv · summary.json
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { query, sql } = require('../db');
const { tsQuery } = require('../services/truckscale-db');
const { expandPlates, normPlate } = require('../services/truckscale-sync');

// ── args ───────────────────────────────────────────────────────
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const PROFILE = String(arg('profile', '1'));
const TOL = Number(arg('tol', 3));
const PROFILES = {
  '1': { from: '2022-01-01', to: '2026-03-01', label: 'full',    matchedOnly: false },
  '2': { from: '2024-08-01', to: '2026-03-01', label: 'recent',  matchedOnly: false },
  '3': { from: '2022-01-01', to: '2026-03-01', label: 'matched', matchedOnly: true  },
};
const P = PROFILES[PROFILE];
if (!P) { console.error('ERR: --profile ต้องเป็น 1, 2 หรือ 3'); process.exit(2); }
const OUT = arg('out', path.join(process.env.EXPORT_OUTPUT_PATH || path.resolve(__dirname, '..', 'exports'),
  'test-dataset', `profile-${PROFILE}-${P.label}`));

// ── csv helper (BOM + quoting) ─────────────────────────────────
const esc = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function writeCsv(file, headers, rows) {
  const out = [headers.join(',')].concat(rows.map(r => headers.map(h => esc(r[h])).join(','))).join('\r\n');
  fs.writeFileSync(file, '﻿' + out, 'utf8');
  return rows.length;
}
const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const fromDayNum = n => new Date(n * 86400000).toISOString().slice(0, 10);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`== Test dataset · profile ${PROFILE} (${P.label}) ==`);
  console.log(`window: ${P.from} .. ${P.to} (exclusive) · tolerance ±${TOL}d`);
  console.log(`out: ${OUT}\n`);

  // 1) weigh records
  console.log('[1/4] loading weigh records (db_truckscale)...');
  const weighs = await tsQuery(`
    SELECT sequence AS Sequence, s_id AS Sid, movebill AS Movebill, one_car_regis AS Plate,
           one_cus_name AS CustName, weight_in AS WeightIn, weight_out AS WeightOut,
           weight_net AS WeightNet, Date_In AS DateIn, Date_Out AS DateOut, Computer_w AS ScaleNo
    FROM tblscale
    WHERE weight_out > 0 AND LENGTH(Date_Out)=10
      AND Date_Out REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
      AND CAST(SUBSTRING(Date_Out,7,4) AS UNSIGNED) >= 2564`);
  const wIndex = new Map();            // normPlate -> [{dn, row}]
  for (const r of weighs) {
    const dn = dayNum(+r.DateOut.slice(6, 10) - 543, +r.DateOut.slice(3, 5), +r.DateOut.slice(0, 2));
    r._dn = dn;
    for (const k of expandPlates(r.Plate)) {
      if (!wIndex.has(k)) wIndex.set(k, []);
      wIndex.get(k).push(r);
    }
  }
  console.log(`   weigh rows: ${weighs.length} · distinct plates: ${wIndex.size}`);

  // 2) SOs in window
  console.log('[2/4] loading SOs (dbwins_worldfert9)...');
  const sos = await query(`
    SELECT hd.SOID, hd.DocuNo, CONVERT(VARCHAR(10), hd.DocuDate, 120) AS DocuDate,
           hd.DocuType, hd.CustID, hd.CustName, hd.TransRegistration AS Plate, hd.EmpID,
           (SELECT SUM(dt.GoodQty2) FROM dbo.SODT dt WITH (NOLOCK) WHERE dt.SOID = hd.SOID) AS QtyTon
    FROM dbo.SOHD hd WITH (NOLOCK)
    WHERE hd.DocuType IN (103,104)
      AND ISNULL(hd.TransRegistration,'') <> ''
      AND ISNULL(hd.DocuStatus,'') <> 'C'
      AND hd.DocuDate >= @f AND hd.DocuDate < @t
    ORDER BY hd.DocuDate, hd.SOID`,
    { f: { type: sql.Date, value: P.from }, t: { type: sql.Date, value: P.to } });
  console.log(`   SO rows: ${sos.length}`);

  // 3) match
  console.log('[3/4] matching...');
  const matched = [], unmatched = [], usedWeigh = new Map();
  for (const s of sos) {
    const raw = String(s.Plate || '').trim();
    const [Y, M, D] = s.DocuDate.split('-').map(Number);
    const dn = dayNum(Y, M, D);
    const base = {
      SOID: s.SOID, DocuNo: s.DocuNo, DocuDate: s.DocuDate, DocuType: s.DocuType,
      CustID: s.CustID, CustName: s.CustName, SoPlate: raw, QtyTon: s.QtyTon,
    };
    if (/ตั๋วคุม/.test(raw)) { unmatched.push({ ...base, Reason: 'CONTROL_TICKET', Detail: 'ตั๋วคุม — ไม่ใช่รถจริง' }); continue; }
    const cand = expandPlates(raw);
    if (!cand.length || !/\d/.test(raw)) { unmatched.push({ ...base, Reason: 'INVALID_PLATE', Detail: 'แปลงเป็นทะเบียนไม่ได้' }); continue; }

    let best = null, plateSeen = false;
    for (const k of cand) {
      const list = wIndex.get(k); if (!list) continue;
      plateSeen = true;
      for (const w of list) {
        const diff = Math.abs(w._dn - dn);
        if (diff <= TOL && (!best || diff < best.diff)) best = { w, diff, key: k };
      }
    }
    if (best) {
      usedWeigh.set(best.w.Sequence, best.w);
      matched.push({
        ...base, MatchedPlate: best.key, DayDiff: best.diff,
        WeighSequence: best.w.Sequence, WeighSid: best.w.Sid, WeighPlate: best.w.Plate,
        WeighDateOut: best.w.DateOut, WeighDateISO: fromDayNum(best.w._dn),
        WeightIn: best.w.WeightIn, WeightOut: best.w.WeightOut, WeightNetKg: best.w.WeightNet,
        WeightNetTon: best.w.WeightNet ? (Number(best.w.WeightNet) / 1000).toFixed(3) : '',
        WeighCustName: best.w.CustName, ScaleNo: best.w.ScaleNo, Movebill: best.w.Movebill,
      });
    } else {
      unmatched.push({
        ...base,
        Reason: plateSeen ? 'DATE_MISMATCH' : 'NO_PLATE_IN_SCALE',
        Detail: plateSeen ? `พบทะเบียนในตาชั่ง แต่ไม่มีใบชั่งภายใน ±${TOL} วัน` : 'ทะเบียนนี้ไม่เคยปรากฏใน tblscale',
      });
    }
  }

  // 4) write
  console.log('[4/4] writing CSV...');
  const soRows = P.matchedOnly ? matched : matched.concat(unmatched.map(u => ({ ...u })));
  const nPairs = writeCsv(path.join(OUT, 'matched-pairs.csv'),
    ['SOID','DocuNo','DocuDate','DocuType','CustID','CustName','SoPlate','MatchedPlate','QtyTon',
     'WeighSequence','WeighSid','WeighPlate','WeighDateOut','WeighDateISO','DayDiff',
     'WeightIn','WeightOut','WeightNetKg','WeightNetTon','WeighCustName','ScaleNo','Movebill'], matched);
  const nSo = writeCsv(path.join(OUT, 'so-list.csv'),
    ['SOID','DocuNo','DocuDate','DocuType','CustID','CustName','SoPlate','QtyTon'],
    soRows.map(r => ({ SOID:r.SOID, DocuNo:r.DocuNo, DocuDate:r.DocuDate, DocuType:r.DocuType,
      CustID:r.CustID, CustName:r.CustName, SoPlate:r.SoPlate, QtyTon:r.QtyTon })));
  const nW = writeCsv(path.join(OUT, 'weigh-list.csv'),
    ['Sequence','Sid','Movebill','Plate','CustName','WeightIn','WeightOut','WeightNet','DateIn','DateOut','ScaleNo'],
    [...usedWeigh.values()]);
  const nU = writeCsv(path.join(OUT, 'unmatched-so.csv'),
    ['SOID','DocuNo','DocuDate','DocuType','CustID','CustName','SoPlate','QtyTon','Reason','Detail'], unmatched);

  const byReason = unmatched.reduce((a, u) => (a[u.Reason] = (a[u.Reason] || 0) + 1, a), {});
  const summary = {
    profile: PROFILE, label: P.label, window: { from: P.from, toExclusive: P.to }, toleranceDays: TOL,
    soInWindow: sos.length, matched: matched.length, unmatched: unmatched.length,
    matchRatePct: +(matched.length * 100 / sos.length).toFixed(2),
    matchRateExclControlTicketPct: +(matched.length * 100 / (sos.length - (byReason.CONTROL_TICKET || 0))).toFixed(2),
    unmatchedByReason: byReason, weighRowsUsed: usedWeigh.size,
    exportedRows: { matchedPairs: nPairs, soList: nSo, weighList: nW, unmatched: nU },
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log('\n== SUMMARY ==');
  console.log(`SO in window      : ${sos.length}`);
  console.log(`matched           : ${matched.length}  (${summary.matchRatePct}%)`);
  console.log(`unmatched         : ${unmatched.length}`);
  Object.entries(byReason).forEach(([k, v]) => console.log(`   - ${k.padEnd(18)}: ${v}`));
  console.log(`weigh rows used   : ${usedWeigh.size}`);
  console.log(`\nfiles -> ${OUT}`);
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
