#!/usr/bin/env node
/**
 * seed-rebate-testdata.js — ข้อมูลทดสอบวงจรรีเบทแบบครบวงจร
 * ==========================================================
 * สร้าง:
 *   1. แผนส่งเสริมการขาย (wf.RebatePlan) 14 สูตร — คีย์จากเอกสารกระดาษจริง
 *      L:\My Drive\World Fert\Requirements\ชุดเอกสารการทำคืนรีเบท.pdf
 *      แผนเลขที่ 12/2568, 14/2568, 15/2568 (ภาคใต้ · 1–30 เม.ย. 2568)
 *
 * ทำไมใช้แผนจริงจากกระดาษแทนที่จะสุ่มตัวเลข
 *   เพราะมีใบขอเคลียร์จริงคู่กันอยู่ในฐานข้อมูล จึงเอาผลที่ระบบคำนวณได้ไปเทียบได้ตรง ๆ
 *   จึงเอาผลที่ระบบคำนวณได้ไปเทียบกับกระดาษได้ตรง ๆ ว่าตรงกันหรือไม่
 *   ถ้าสุ่มตัวเลขเองจะไม่มีอะไรให้เทียบ และพิสูจน์ความถูกต้องไม่ได้
 *
 * ⚠ ใช้กับฐานทดสอบเท่านั้น — สคริปต์ปฏิเสธการรันบน remote/remote_b
 *   แผนเหล่านี้หมดอายุแล้ว (เม.ย. 2568) ห้ามใช้เป็นแผนจริง
 *
 * การใช้งาน:
 *   node scripts/seed-rebate-testdata.js            # สร้าง
 *   node scripts/seed-rebate-testdata.js --clean    # ลบของที่สคริปต์นี้สร้าง
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getReadPool, closePools } = require('./_db');

const TARGET = process.env.DB_MODE || 'local';
// ป้ายกำกับ ใช้ตอนลบ ไม่ต้องเดาว่าแถวไหนของสคริปต์
// **ห้ามใส่วงเล็บเหลี่ยม** — ใน T-SQL '[' คือ character class ของ LIKE
// ฉบับแรกใช้ '[SEED-REBATE-TEST]' แล้ว LIKE หาไม่เจอ ทำให้ --clean ลบไม่ออก
const MARK = 'SEED-REBATE-TEST';

// ── ป้องกันการรันบนฐานผลิต ──────────────────────────────────────────────
if (TARGET !== 'local' && !process.env.SEED_ALLOW_NONLOCAL) {
  console.error(`✖ ปฏิเสธการรันบน "${TARGET}" — สคริปต์นี้สร้างข้อมูลทดสอบ ใช้ได้เฉพาะ local`);
  console.error('  ถ้าจงใจจริง ตั้ง SEED_ALLOW_NONLOCAL=1 (ไม่แนะนำ)');
  process.exit(1);
}

/**
 * แผนจากกระดาษ — GoodCodePattern ตรวจแล้วว่าตรงกับ dbo.EMGood จริง
 *
 * Region = 'ALL' ไม่ใช่ '05'
 *   ลูกค้าตัวอย่างในฐานทดสอบ **ไม่มี SaleAreaID**
 *   v_RebateAccrualLot จึงได้ RegionCode = NULL แล้วเงื่อนไข p.Region = reg.RegionCode
 *   จะเป็น NULL (ไม่จริง) — เหลือทางเดียวคือ 'ALL' ถึงจะ match
 *   ของจริงควรใส่ '05' (ภาคใต้) แล้วผูก SaleArea ให้ลูกค้าก่อน
 */
const PLANS = [
  // แผนเลขที่ 14/2568 — ปุ๋ยสูตรผสม เขตภาคใต้
  ['14/2568', '18-4-5',   '7-18040500BBCAR', 12300],
  ['14/2568', '14-4-9',   '7-14040900BBCAR', 12300],
  ['14/2568', '15-7-18',  '7-15071800BBCAR', 15500],
  ['14/2568', '15-5-20',  '7-15052000BBCAR', 15500],
  ['14/2568', '20-8-20',  '7-20082000BBCAR', 18000],
  ['14/2568', '29-5-18',  '7-29051800BBCAR', 18000],
  ['14/2568', '12-4-40',  '7-12044000BBCAR', 17000],
  ['14/2568', '14-7-35',  '7-14073500BBCAR', 17000],
  ['14/2568', '13-8-35',  '7-1308353BBBCAR', 17000],
  ['14/2568', '15-5-35',  '7-15053500BBCAR', 17000],
  ['14/2568', '14-4-24',  '7-14042400BBCAR', 15500],
  ['14/2568', '20-10-12', '7-20101200BBCAR', 17000],
  // แผนเลขที่ 12/2568 — 0-0-60
  ['12/2568', '0-0-60',   '9-0000600200CAR', 12500],
  // แผนเลขที่ 15/2568 — 21-0-0
  ['15/2568', '21-0-0',   '9-2100000000CAR',  7700],
];

const VALID_FROM = '2025-04-01';
const VALID_TO   = '2025-04-30';

(async () => {
  const pool = await getReadPool(TARGET);
  const run = async (sql) => { const r = pool.request(); r.timeout = 180000; return (await r.query(sql)).recordset; };

  if (process.argv.includes('--clean')) {
    const n = await run(`SELECT COUNT(*) c FROM wf.RebatePlan WHERE Note LIKE '${MARK}%'`);
    await run(`DELETE FROM wf.RebatePlan WHERE Note LIKE '${MARK}%'`);
    console.log(`✓ ลบแผนทดสอบ ${n[0].c} รายการ`);
    await closePools(TARGET);
    return;
  }

  console.log(`=== seed แผนรีเบทลง ${TARGET} ===`);

  // ตรวจว่ารหัสสินค้ามีจริงก่อน — กัน seed ที่ match อะไรไม่ได้เลยแล้วเสียเวลาไล่หาทีหลัง
  const missing = [];
  for (const [, formula, code] of PLANS) {
    const g = await run(`SELECT TOP 1 GoodID FROM dbo.EMGood WHERE RTRIM(GoodCode) = '${code}'`);
    if (!g.length) missing.push(`${formula} (${code})`);
  }
  if (missing.length) {
    console.error('✖ ไม่พบรหัสสินค้าเหล่านี้ใน dbo.EMGood:');
    missing.forEach(m => console.error('   ' + m));
    await closePools(TARGET);
    process.exit(1);
  }
  console.log(`✓ ตรวจรหัสสินค้าครบ ${PLANS.length} รายการ`);

  let created = 0, skipped = 0;
  for (const [planNo, formula, code, netPrice] of PLANS) {
    const exists = await run(
      `SELECT TOP 1 PlanId FROM wf.RebatePlan
       WHERE PlanNo = N'${planNo}' AND GoodCodePattern = N'${code}'`);
    if (exists.length) { skipped++; continue; }

    await run(`
      INSERT INTO wf.RebatePlan
        (PlanNo, Title, GoodCodePattern, Region, ReturnType, NetPrice,
         ValidFrom, ValidTo, AllocatedAmount, Priority, Status, Note, RefDoc)
      VALUES
        (N'${planNo}',
         N'คืนรีเบทราคาสุทธิ ${netPrice.toLocaleString('en-US')} บาท — ${formula}',
         N'${code}', N'ALL', N'REBATE', ${netPrice},
         '${VALID_FROM}', '${VALID_TO}', 0, 100, N'ACTIVE',
         N'${MARK} คีย์จากเอกสารกระดาษ แผนเลขที่ ${planNo} ลว. 02/04/2568 (ภาคใต้)',
         N'แบบขออนุมัติรายการส่งเสริมการขาย เลขที่ ${planNo}')`);
    created++;
  }
  console.log(`✓ สร้างแผน ${created} รายการ · ข้าม (มีอยู่แล้ว) ${skipped} รายการ`);

  console.log('\n=== ผลลัพธ์: แผนที่ใช้งานได้ ===');
  console.table(await run(`
    SELECT PlanNo, GoodCodePattern, NetPrice,
           CONVERT(varchar(10),ValidFrom,120) ValidFrom,
           CONVERT(varchar(10),ValidTo,120) ValidTo, Region, Status
    FROM   wf.RebatePlan WHERE Note LIKE '${MARK}%' ORDER BY PlanNo, GoodCodePattern`));

  console.log('\n=== ผลที่ระบบคำนวณได้ทันที (v_RebateAccrualLot) ===');
  console.table(await run(`
    SELECT COUNT(*) บรรทัดทั้งหมด,
           SUM(CASE WHEN NetPricePerTon IS NOT NULL THEN 1 ELSE 0 END) matchแผน,
           SUM(CASE WHEN RebateAmount > 0 THEN 1 ELSE 0 END) ได้รีเบท,
           SUM(ISNULL(RebateAmount,0)) มูลค่ารีเบทรวม
    FROM   wf.v_RebateAccrualLot
    WHERE  SourceDocuDate >= '${VALID_FROM}' AND SourceDocuDate <= '${VALID_TO}'`));

  await closePools(TARGET);
})().catch(e => { console.error(e.message); process.exit(1); });
