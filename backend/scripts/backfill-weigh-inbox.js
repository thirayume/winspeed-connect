/**
 * backfill-weigh-inbox.js — เติมข้อมูลชั่งย้อนหลัง + ผลจับคู่ SO เข้า wf.WeighInbox
 *
 * ⚠ TruckScale (MySQL) = READ-ONLY เท่านั้น — สคริปต์นี้ไม่มีคำสั่งเขียน MySQL ใดๆ
 * ⚠ เขียนเฉพาะ wf.WeighInbox ใน SQL Server (dbwins_worldfert9)
 *
 * ใช้กติกาจับคู่เดียวกับ production (expandPlates: แตกทะเบียนรวม/ย่อ) + วันที่ ±N วัน
 *
 * USAGE:
 *   node scripts/backfill-weigh-inbox.js                       # dry-run (ไม่เขียน)
 *   node scripts/backfill-weigh-inbox.js --apply               # เขียนจริง
 *   node scripts/backfill-weigh-inbox.js --from 2024-08-01 --to 2026-03-01 --tol 3 --apply
 *   node scripts/backfill-weigh-inbox.js --apply --truncate    # ล้าง WeighInbox ก่อน (ระวัง)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { query, wfQuery, sql } = require('../db');
const { tsQuery } = require('../services/truckscale-db');
const { expandPlates } = require('../services/truckscale-sync');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes('--' + k);
const FROM = arg('from', '2022-01-01'), TO = arg('to', '2026-03-01');
const TOL = Number(arg('tol', 3));
const APPLY = has('apply'), TRUNCATE = has('truncate');
const CHUNK = 50;   // 50 × 14 = 700 params (msnodesqlv8 จำกัด ~2100; กันหลุด)

const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const beToDn = s => dayNum(+s.slice(6, 10) - 543, +s.slice(3, 5), +s.slice(0, 2));

(async () => {
  console.log('== Backfill wf.WeighInbox ==');
  console.log(`window ${FROM} .. ${TO} (exclusive) · tol ±${TOL}d · mode ${APPLY ? 'APPLY (เขียนจริง)' : 'DRY-RUN (ไม่เขียน)'}`);
  console.log('TruckScale: READ-ONLY · target: wf.WeighInbox @ ' + (process.env.DB_NAME || 'dbwins_worldfert9') + '\n');

  const fromDn = dayNum(...FROM.split('-').map(Number)), toDn = dayNum(...TO.split('-').map(Number));

  // 1) SO index (SQL Server) — READ
  console.log('[1/4] loading SO candidates...');
  const hd = await query(`
    SELECT CAST(hd.SOID AS VARCHAR(50)) AS Id, hd.TransRegistration AS Plate,
           CONVERT(VARCHAR(10), hd.DocuDate, 120) AS D
    FROM dbo.SOHD hd WITH (NOLOCK)
    WHERE hd.DocuType IN (103,104) AND ISNULL(hd.TransRegistration,'') <> ''
      AND ISNULL(hd.DocuStatus,'') <> 'C'
      AND hd.DocuDate >= @f AND hd.DocuDate < @t`,
    { f: { type: sql.Date, value: FROM }, t: { type: sql.Date, value: TO } });
  const draft = await wfQuery(`
    SELECT CAST(so.Id AS VARCHAR(50)) AS Id, so.TruckPlate AS Plate,
           CONVERT(VARCHAR(10), ISNULL(so.DeliveryDate, so.CreatedAt), 120) AS D
    FROM wf.SalesOrder so WHERE ISNULL(so.TruckPlate,'') <> ''`);
  const soIdx = new Map();
  const addSo = (r) => { const dn = r.D ? dayNum(...r.D.split('-').map(Number)) : null;
    for (const k of expandPlates(r.Plate)) { if (!soIdx.has(k)) soIdx.set(k, []); soIdx.get(k).push({ id: r.Id, dn }); } };
  hd.forEach(addSo); (draft.recordset || []).forEach(addSo);
  console.log(`   SOHD ${hd.length} · wf.SalesOrder ${(draft.recordset || []).length} · plate keys ${soIdx.size}`);

  // 2) weigh rows (MySQL) — READ ONLY · อ่านทีละช่วง s_id + retry กัน ECONNRESET
  console.log('[2/4] loading weigh rows (READ-ONLY, chunked)...');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const PAGE = 4000;
  const weighs = [];
  let last = 0, pages = 0;
  for (;;) {
    let rows = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        rows = await tsQuery(`
          SELECT s_id AS Sid, sequence AS Sequence, movebill AS Movebill, one_car_regis AS Plate,
                 one_cus_name AS CustName, weight_in AS WeightIn, weight_out AS WeightOut,
                 weight_net AS WeightNet, Date_In AS DateIn, Date_Out AS DateOut, Computer_w AS ScaleNo
          FROM tblscale
          WHERE s_id > ? AND LENGTH(Date_Out)=10 AND Date_Out REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
            AND CAST(SUBSTRING(Date_Out,7,4) AS UNSIGNED) >= 2564
          ORDER BY s_id LIMIT ?`, [last, PAGE]);
        break;
      } catch (e) {
        if (attempt === 5) throw e;
        console.log(`   (retry ${attempt} after ${e.code || e.message} at s_id>${last})`);
        await sleep(1500 * attempt);
      }
    }
    if (!rows.length) break;
    for (const r of rows) { const dn = beToDn(r.DateOut); if (dn >= fromDn && dn < toDn) weighs.push(r); }
    last = Number(rows[rows.length - 1].Sid);
    if (++pages % 10 === 0) console.log(`   ...s_id ${last} · in-window ${weighs.length}`);
  }
  console.log(`   weigh rows in window: ${weighs.length}`);

  // 3) match in memory (same rule as matchSo)
  console.log('[3/4] matching...');
  const stat = { MATCHED: 0, MULTI: 0, UNMATCHED: 0 };
  const rows = weighs.map(r => {
    const dn = beToDn(r.DateOut);
    const seen = new Map();
    for (const k of expandPlates(r.Plate)) for (const c of (soIdx.get(k) || [])) {
      const diff = c.dn == null ? 999 : Math.abs(c.dn - dn);
      if (!seen.has(c.id) || diff < seen.get(c.id)) seen.set(c.id, diff);
    }
    const cands = [...seen.entries()].map(([id, diff]) => ({ id, diff })).sort((a, b) => a.diff - b.diff);
    const near = cands.filter(c => c.diff <= TOL);
    let id = null, st = 'UNMATCHED';
    if (near.length === 1) { id = near[0].id; st = 'MATCHED'; }
    else if (near.length > 1) {
      if (near[0].diff < near[1].diff) { id = near[0].id; st = 'MATCHED'; } else st = 'MULTI';
    }
    stat[st]++;
    return { ...r, MatchedSoId: id, MatchStatus: st,
      Status: Number(r.WeightOut) > 0 ? 'COMPLETED' : 'OPEN' };
  });
  console.log(`   MATCHED ${stat.MATCHED} · MULTI ${stat.MULTI} · UNMATCHED ${stat.UNMATCHED}` +
    `  (match ${(stat.MATCHED * 100 / rows.length).toFixed(1)}%)`);

  // ── filter: ตาชั่งบันทึกงานอื่นด้วย (รับเข้า/ภายใน) ทำให้ UNMATCHED เยอะโดยธรรมชาติ
  //    ค่า default = linked (MATCHED+MULTI) + สุ่ม UNMATCHED ไว้เทสต์ noise พอประมาณ
  const ONLY = String(arg('only', 'linked')).toLowerCase();      // all | linked | matched
  const UNS  = Number(arg('unmatched', ONLY === 'all' ? -1 : 2000));
  let sel;
  if (ONLY === 'all') sel = rows.slice();   // ต้อง copy — เพราะด้านล่างจะ mutate rows
  else {
    const keep = ONLY === 'matched' ? rows.filter(r => r.MatchStatus === 'MATCHED')
                                    : rows.filter(r => r.MatchStatus !== 'UNMATCHED');
    const un = rows.filter(r => r.MatchStatus === 'UNMATCHED');
    const take = UNS > 0 ? un.filter((_, i) => i % Math.max(1, Math.ceil(un.length / UNS)) === 0).slice(0, UNS) : [];
    sel = keep.concat(take);
  }
  console.log(`   filter --only ${ONLY}${UNS > 0 ? ` --unmatched ${UNS}` : ''} → เลือก ${sel.length} / ${rows.length} แถว`);
  rows.length = 0; rows.push(...sel);

  if (!APPLY) {
    console.log('\n[4/4] DRY-RUN — ไม่เขียนอะไรทั้งสิ้น');
    console.log(`จะ MERGE เข้า wf.WeighInbox ทั้งหมด ${rows.length} แถว (idempotent by Sequence)`);
    console.log('ตัวอย่าง 3 แถวแรก:');
    rows.slice(0, 3).forEach(r => console.log(`   ${r.Sequence} ${r.DateOut} ${r.Plate} -> ${r.MatchStatus} ${r.MatchedSoId || ''}`));
    console.log('\nรันจริงด้วย:  node scripts/backfill-weigh-inbox.js --apply');
    process.exit(0);
  }

  // 4) write (SQL Server only) — ใช้ bulk insert (เลี่ยง msnodesqlv8 multi-row param quirk)
  const { pools } = require('../db');
  await pools().ready;
  const owner = pools().ownerPool;
  if (TRUNCATE) { await wfQuery('DELETE FROM wf.WeighInbox'); console.log('   (truncated wf.WeighInbox)'); }
  console.log('[4/4] writing wf.WeighInbox (bulk)...');

  // dedupe by Sequence (natural key) — เก็บแถวหลังสุด
  const bySeq = new Map();
  for (const r of rows) bySeq.set(String(r.Sequence), r);
  const uniq = [...bySeq.values()];

  const mkTable = () => {
    const t = new sql.Table('wf.WeighInbox');
    t.create = false;
    t.columns.add('Sequence',    sql.NVarChar(50),  { nullable: false });
    t.columns.add('Sid',         sql.BigInt,        { nullable: true });
    t.columns.add('Movebill',    sql.NVarChar(50),  { nullable: true });
    t.columns.add('Plate',       sql.NVarChar(50),  { nullable: true });
    t.columns.add('CustName',    sql.NVarChar(200), { nullable: true });
    t.columns.add('WeightIn',    sql.Decimal(18,2), { nullable: true });
    t.columns.add('WeightOut',   sql.Decimal(18,2), { nullable: true });
    t.columns.add('WeightNet',   sql.Decimal(18,2), { nullable: true });
    t.columns.add('DateIn',      sql.NVarChar(30),  { nullable: true });
    t.columns.add('DateOut',     sql.NVarChar(30),  { nullable: true });
    t.columns.add('ScaleNo',     sql.NVarChar(20),  { nullable: true });
    t.columns.add('Status',      sql.NVarChar(20),  { nullable: false });
    t.columns.add('MatchedSoId', sql.NVarChar(50),  { nullable: true });
    t.columns.add('MatchStatus', sql.NVarChar(20),  { nullable: true });
    t.columns.add('IngestedAt',  sql.DateTime2,     { nullable: false });  // bulk ไม่ apply DEFAULT
    t.columns.add('UpdatedAt',   sql.DateTime2,     { nullable: false });
    return t;
  };
  const NOW = new Date();
  const nOrNull = v => (v == null ? null : Number(v));
  const sOrNull = v => (v == null ? null : String(v));

  let done = 0;
  const BULK = 5000;
  for (let i = 0; i < uniq.length; i += BULK) {
    const t = mkTable();
    for (const r of uniq.slice(i, i + BULK)) {
      t.rows.add(String(r.Sequence), nOrNull(r.Sid), sOrNull(r.Movebill), sOrNull(r.Plate),
        sOrNull(r.CustName), nOrNull(r.WeightIn), nOrNull(r.WeightOut), nOrNull(r.WeightNet),
        sOrNull(r.DateIn), sOrNull(r.DateOut), sOrNull(r.ScaleNo), r.Status, sOrNull(r.MatchedSoId), r.MatchStatus, NOW, NOW);
    }
    const res = await owner.request().bulk(t);
    done += (res && res.rowsAffected) || t.rows.length;
    console.log(`   bulk ${Math.min(i + BULK, uniq.length)}/${uniq.length}`);
  }

  const chk = (await wfQuery(`SELECT MatchStatus, COUNT(*) n FROM wf.WeighInbox GROUP BY MatchStatus`)).recordset;
  const tot = (await wfQuery(`SELECT COUNT(*) n FROM wf.WeighInbox`)).recordset[0].n;
  console.log(`\n== DONE == wrote ${done} rows · wf.WeighInbox total = ${tot}`);
  chk.forEach(r => console.log(`   ${String(r.MatchStatus).padEnd(10)} ${r.n}`));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
