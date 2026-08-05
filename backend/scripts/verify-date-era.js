#!/usr/bin/env node
/**
 * verify-date-era.js — ตรวจว่าวันที่ทุกแหล่งถูกตีความเป็นศักราชที่ถูกต้อง
 *
 * ระบบมีวันที่สองศักราชปนกันอยู่จริง และเคยแสดงผลผิดมาแล้ว (ขึ้นปี 3112 บนหน้าจอ)
 *
 *   ฐานเครื่องชั่ง MySQL   Date_In / Date_Out    varchar 'DD/MM/BBBB'  → พ.ศ.
 *                        Date_In2 / Date_Out2  int OLE serial        → ค.ศ.
 *   wf.WeighInbox        DateIn / DateOut      nvarchar (สำเนาจากข้างบน) → พ.ศ.
 *   dbo และ wf ที่เหลือ    datetime / datetime2                        → ค.ศ.
 *
 * ตรวจสามอย่าง
 *   1. ค่าที่อยู่ในฐานจริงยังเป็นศักราชที่เราคิดไว้ (ถ้าโรงงานเปลี่ยนรูปแบบ เราต้องรู้)
 *   2. Date_Out กับ Date_Out2 ชี้วันเดียวกัน — ตัวหนึ่งเป็น พ.ศ. อีกตัวเป็น ค.ศ.
 *   3. สำเนาใน wf.WeighInbox ยังเป็น พ.ศ. เหมือนต้นทาง ไม่ถูกแปลงระหว่างทาง
 *
 * อ่านอย่างเดียว ไม่สร้างข้อมูล
 *
 *   node backend/scripts/verify-date-era.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { wfQuery } = require('../db');
const { tsQuery } = require('../services/truckscale-db');

let failed = 0;
const ok  = (m, extra = '') => console.log(`  ok   ${m}${extra ? ' · ' + extra : ''}`);
const bad = (m, extra = '') => { failed++; console.log(`  ผิด  ${m}${extra ? ' · ' + extra : ''}`); };
const check = (cond, m, extra) => (cond ? ok(m, extra) : bad(m, extra));

/** OLE serial (epoch 1899-12-30) → { ce, be } ปีคริสต์และปีพุทธของวันเดียวกัน */
function fromOleSerial(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Number(serial) * 86400000);
  return { date: d, ce: d.getUTCFullYear(), be: d.getUTCFullYear() + 543 };
}

const BE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

(async () => {
  console.log('ตรวจศักราชของวันที่ทุกแหล่ง\n');

  // ── 1 · ฐานเครื่องชั่ง ────────────────────────────────────────────
  console.log('ฐานเครื่องชั่ง (MySQL tblscale)');
  const scale = await tsQuery(`
    SELECT sequence, Date_In, Date_In2, Date_Out, Date_Out2
    FROM tblscale
    WHERE weight_out > 0 AND Date_Out <> '0' AND Date_Out <> ''
    ORDER BY s_id DESC LIMIT 50`);

  check(scale.length > 0, 'อ่านใบชั่งมาตรวจได้', `${scale.length} ใบ`);

  const badFormat = scale.filter(r => !BE_PATTERN.test(String(r.Date_Out).trim()));
  check(badFormat.length === 0, "Date_Out ทุกใบอยู่ในรูป 'DD/MM/BBBB'",
    badFormat.length ? `ผิดรูป ${badFormat.length} ใบ เช่น ${badFormat[0].Date_Out}` : '');

  const notBE = scale.filter(r => {
    const m = String(r.Date_Out).trim().match(BE_PATTERN);
    return m && Number(m[3]) < 2400;      // ปี พ.ศ. ต้องมากกว่า 2400 เสมอ
  });
  check(notBE.length === 0, 'Date_Out เก็บเป็นปี พ.ศ. (ไม่ใช่ ค.ศ.)',
    notBE.length ? `พบปีที่ไม่ใช่ พ.ศ. ${notBE.length} ใบ เช่น ${notBE[0].Date_Out}` : '');

  const mismatched = scale.filter(r => {
    const m = String(r.Date_Out).trim().match(BE_PATTERN);
    if (!m || !r.Date_Out2) return false;
    const { be, date } = fromOleSerial(r.Date_Out2);
    return Number(m[3]) !== be
        || Number(m[2]) !== date.getUTCMonth() + 1
        || Number(m[1]) !== date.getUTCDate();
  });
  check(mismatched.length === 0, 'Date_Out (พ.ศ.) กับ Date_Out2 (ค.ศ.) ชี้วันเดียวกัน',
    mismatched.length
      ? `ไม่ตรง ${mismatched.length} ใบ เช่น ${mismatched[0].Date_Out} vs serial ${mismatched[0].Date_Out2}`
      : `ตรวจ ${scale.length} ใบ`);

  // ── 2 · สำเนาใน wf.WeighInbox ────────────────────────────────────
  console.log('\nสำเนาใน wf.WeighInbox');
  const inbox = (await wfQuery(`
    SELECT TOP 50 Sequence, DateIn, DateOut FROM wf.WeighInbox
    WHERE DateOut IS NOT NULL AND DateOut <> '' ORDER BY Id DESC`)).recordset;

  if (!inbox.length) {
    ok('ยังไม่มีข้อมูลใน WeighInbox — ข้ามการตรวจ');
  } else {
    // '0' และค่าว่างคือค่าที่เครื่องชั่งใช้แทน "ยังไม่ชั่งออก" ไม่ใช่ข้อมูลผิดรูป
    // หน้าจอต้องแสดงเป็นขีดกลาง ไม่ใช่พยายามตีความเป็นวันที่
    const isSentinel = (v) => { const s = String(v ?? '').trim(); return s === '' || s === '0'; };
    const dated = inbox.filter(r => !isSentinel(r.DateOut));
    const sentinels = inbox.length - dated.length;

    const inboxBad = dated.filter(r => {
      const m = String(r.DateOut).trim().match(BE_PATTERN);
      return !m || Number(m[3]) < 2400;
    });
    check(inboxBad.length === 0, 'DateOut ยังเป็น พ.ศ. เหมือนต้นทาง ไม่ถูกแปลงระหว่าง sync',
      inboxBad.length
        ? `ผิด ${inboxBad.length} แถว เช่น ${inboxBad[0].DateOut}`
        : `ตรวจ ${dated.length} แถว · ยังไม่ชั่งออก ${sentinels} แถว`);
  }

  // ── 3 · ฝั่ง SQL Server ต้องเป็น ค.ศ. ─────────────────────────────
  console.log('\nตารางของแอปและ WINSpeed (ต้องเป็น ค.ศ.)');
  const wfYear = (await wfQuery(`SELECT TOP 1 YEAR(CreatedAt) AS y FROM wf.SalesOrder ORDER BY Id DESC`)).recordset[0];
  if (wfYear) {
    check(wfYear.y > 1900 && wfYear.y < 2400, 'wf.SalesOrder.CreatedAt เก็บเป็นปี ค.ศ.', `ปี ${wfYear.y}`);
  } else ok('ยังไม่มีใบสั่งขายในตาราง wf — ข้าม');

  const dboYear = (await wfQuery(`SELECT TOP 1 YEAR(DocuDate) AS y FROM dbo.SOHD ORDER BY SOID DESC`)).recordset[0];
  if (dboYear) {
    check(dboYear.y > 1900 && dboYear.y < 2400, 'dbo.SOHD.DocuDate เก็บเป็นปี ค.ศ.', `ปี ${dboYear.y}`);
  } else ok('ยังไม่มีใบสั่งขายใน dbo — ข้าม');

  // ── 4 · ตัวแปลงฝั่ง backend ──────────────────────────────────────
  console.log('\nตัวแปลง beDateToIso ใน routes/truckscale.js');
  const beDateToIso = (value) => {
    const m = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const year = Number(m[3]) - 543;
    if (year < 1900 || year > 2200) return null;
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  };
  check(beDateToIso('01/05/2569') === '2026-05-01', "'01/05/2569' → '2026-05-01'");
  check(beDateToIso('5/8/2569') === '2026-08-05', "รับเลขหลักเดียว '5/8/2569' → '2026-08-05'");
  check(beDateToIso('0') === null, "'0' คืน null");
  check(beDateToIso('') === null, 'ค่าว่างคืน null');
  check(beDateToIso('2026-05-01') === null, 'รูปแบบ ค.ศ. คืน null ไม่ตีความมั่ว');

  console.log(failed ? `\nไม่ผ่าน ${failed} ข้อ` : '\nผ่านทุกข้อ');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\nข้อผิดพลาด:', e.message); process.exit(1); });
