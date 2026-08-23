#!/usr/bin/env node
/**
 * seed-so-testdata.js — ใบสั่งขายทดสอบหลายรูปแบบ สำหรับ Manual Test
 * ================================================================
 * สร้างใบสั่งขายสถานะ DRAFT ครอบคลุมรูปแบบที่ระบบต้องรองรับจริง:
 *
 *   A · ขายปกติหลายสูตร            → เส้นทางพื้นฐาน 103 → 104 → 202
 *   B · มีของแถม                    → ของแถมต้องไม่นับเป็นยอดขายและไม่เกิดรีเบท
 *   C · ใบจองตั๋วคุม (AI)            → TruckPlate = 'ตั๋วคุม'
 *   D · เบิกจากตั๋วคุม               → RefControlTicketNo รายบรรทัด
 *   E · สองบิลรถคันเดียว (I + K)     → หนึ่งเที่ยวรถ หลายบิล
 *   F · ราคาต่ำกว่า NET              → ต้องถูกจับเป็น "รออนุมัติ"
 *   G · สูตรที่ไม่มีแผนรีเบท          → ต้องไม่เกิดสิทธิ์สะสม
 *
 * ทำไมสร้างแค่ DRAFT ไม่ยืนยันให้
 *   การยืนยันบิลเขียนลง dbo.SOHD ของ WINSpeed ซึ่งกินเลข SOID จากบล็อกของเครื่อง
 *   และลบทิ้งไม่ได้ (ดู winspeed-smid-id-blocks) — ผู้ทดสอบต้องเป็นคนกดยืนยันเอง
 *   เพื่อให้รู้ตัวว่ากำลังสร้างเอกสารจริงในระบบบัญชี
 *
 * ⚠ ใช้กับฐานทดสอบเท่านั้น — ปฏิเสธการรันบน remote/remote_b
 *
 * การใช้งาน:
 *   node scripts/seed-so-testdata.js            # สร้าง
 *   node scripts/seed-so-testdata.js --clean    # ลบเฉพาะใบที่ยังเป็น DRAFT
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getReadPool, closePools } = require('./_db');

const TARGET = process.env.DB_MODE || 'local';
const MARK = 'SEED-SO-TEST';        // ห้ามใส่วงเล็บเหลี่ยม — '[' คือ character class ของ LIKE

if (TARGET !== 'local' && !process.env.SEED_ALLOW_NONLOCAL) {
  console.error(`✖ ปฏิเสธการรันบน "${TARGET}" — สคริปต์นี้สร้างข้อมูลทดสอบ ใช้ได้เฉพาะ local`);
  process.exit(1);
}

// ลูกค้าตัวอย่าง — **ห้ามฝังรหัส/ชื่อลูกค้าจริงในไฟล์นี้ repo เป็นสาธารณะ**
// ค่าปริยายคือให้สคริปต์เลือกเองจากฐานทดสอบ: รายที่มีสิทธิ์รีเบทสะสมมากที่สุด
// ซึ่งจะไปตรงกับรายที่มีใบขอเคลียร์จริงคู่กันอยู่แล้ว ทำให้เทียบยอดกับเอกสารกระดาษได้
// ระบุเองได้ด้วย SEED_CUST_ID=<รหัส>
const CUST_ID_ENV = process.env.SEED_CUST_ID || null;

// สูตรที่เลือกล้วนมีแผนรีเบทรองรับ (จาก seed-rebate-testdata) ยกเว้นที่ระบุว่าไม่มีแผน
const G = {
  f15535:  '7-15053500BBCAR',   // 15-5-35  ราคาสุทธิ 17,000
  f29518:  '7-29051800BBCAR',   // 29-5-18  ราคาสุทธิ 18,000
  f15718:  '7-15071800BBCAR',   // 15-7-18  ราคาสุทธิ 15,500
  f0060:   '9-0000600200CAR',   // 0-0-60   ราคาสุทธิ 12,500
  f2100:   '9-2100000000CAR',   // 21-0-0   ราคาสุทธิ  7,700
  f151515: '7-15151500BBCAR',   // 15-15-15 **ไม่มีแผน** — ต้องไม่เกิดรีเบท
};

// บรรทัด: [รหัสสูตร, ตัน, ราคาขาย/ตัน, ราคาสุทธิ/ตัน, ตัวเลือกเพิ่มเติม]
const ORDERS = [
  { code: 'A', soPrefix: 'I', desc: 'ขายปกติ 3 สูตร', truckPlate: 'ทดสอบ-A01', lines: [
      [G.f15535, 10, 18200, 17000], [G.f15718, 5, 16200, 15500], [G.f0060, 4, 13200, 12500] ] },

  { code: 'B', soPrefix: 'I', desc: 'มีของแถม 1 รายการ', truckPlate: 'ทดสอบ-B01', lines: [
      [G.f29518, 8, 19200, 18000], [G.f2100, 2, 0, 7700, { isGiveaway: true }] ] },

  { code: 'C', soPrefix: 'AI', desc: 'ใบจองตั๋วคุม', truckPlate: 'ตั๋วคุม', lines: [
      [G.f15535, 30, 18200, 17000], [G.f0060, 20, 13200, 12500] ] },

  { code: 'D', soPrefix: 'I', desc: 'เบิกจากตั๋วคุม', truckPlate: 'ทดสอบ-D01',
    controlTicketNo: 'TESTCT-001', lines: [
      [G.f15535, 12, 18200, 17000, { isControlTicketDrawn: true, refControlTicketNo: 'TESTCT-001' }],
      [G.f0060, 6, 13200, 12500] ] },

  { code: 'E1', soPrefix: 'I', desc: 'สองบิลรถคันเดียว (บิลที่ 1)', truckPlate: 'ทดสอบ-E01', lines: [
      [G.f15718, 7, 16200, 15500] ] },
  { code: 'E2', soPrefix: 'K', desc: 'สองบิลรถคันเดียว (บิลที่ 2)', truckPlate: 'ทดสอบ-E01', lines: [
      [G.f2100, 6, 8200, 7700] ] },

  { code: 'F', soPrefix: 'I', desc: 'ราคาต่ำกว่า NET เกิน 500 — ต้องรออนุมัติ', truckPlate: 'ทดสอบ-F01', lines: [
      [G.f15535, 5, 16000, 17000] ] },

  { code: 'G', soPrefix: 'I', desc: 'สูตรที่ไม่มีแผนรีเบท — ต้องไม่เกิดสิทธิ์', truckPlate: 'ทดสอบ-G01', lines: [
      [G.f151515, 9, 17500, 17000] ] },
];

(async () => {
  const pool = await getReadPool(TARGET);
  const run = async (s) => { const r = pool.request(); r.timeout = 120000; return (await r.query(s)).recordset; };
  const esc = (v) => String(v).replace(/'/g, "''");

  if (process.argv.includes('--clean')) {
    // ลบเฉพาะใบที่ยังไม่ถูกยืนยัน — ใบที่โอนเข้า WINSpeed แล้วต้องยกเลิกผ่านหน้าจอ
    const rows  = await run(`SELECT Id, WfRef, Status FROM wf.SalesOrder WHERE Remark LIKE '${MARK}%'`);
    const draft = rows.filter(r => r.Status === 'DRAFT');
    const gone  = rows.filter(r => r.Status !== 'DRAFT');
    if (draft.length) {
      const ids = draft.map(r => r.Id).join(',');
      await run(`DELETE FROM wf.SalesOrderLine WHERE SoId IN (${ids})`);
      await run(`DELETE FROM wf.SalesOrder WHERE Id IN (${ids})`);
    }
    console.log(`✓ ลบใบทดสอบสถานะ DRAFT ${draft.length} ใบ`);
    if (gone.length) {
      console.log(`⚠ อีก ${gone.length} ใบยืนยันไปแล้ว ลบด้วยสคริปต์ไม่ได้ — ต้องยกเลิกผ่านหน้าจอ:`);
      gone.forEach(r => console.log(`   ${r.WfRef} (${r.Status})`));
    }
    await closePools(TARGET);
    return;
  }

  console.log(`=== seed ใบสั่งขายทดสอบลง ${TARGET} ===`);

  // เลือกลูกค้าตัวอย่าง: รายที่มีล็อตซึ่งแผนรีเบทคุ้มครองมากที่สุด
  // ต้องรัน seed-rebate-testdata.js ก่อน ไม่งั้นจะไม่มีล็อตไหน match แผนเลย
  const pick = CUST_ID_ENV
    ? await run(`SELECT TOP 1 CustID AS CustId, CustName FROM dbo.EMCust WHERE CustID = '${esc(CUST_ID_ENV)}'`)
    : await run(`
        SELECT TOP 1 l.CustId, MAX(l.CustName) AS CustName
        FROM   wf.v_RebateAccrualLot l
        WHERE  l.NetPricePerTon IS NOT NULL
        GROUP BY l.CustId
        ORDER BY COUNT(*) DESC, SUM(l.QtyTon) DESC`);
  if (!pick.length) {
    console.error('✖ หาลูกค้าตัวอย่างไม่ได้ — รัน scripts/seed-rebate-testdata.js ก่อน');
    await closePools(TARGET); process.exit(1);
  }
  const CUST_ID = String(pick[0].CustId);
  const CUST_NAME = String(pick[0].CustName || '');
  console.log(`✓ ลูกค้าตัวอย่าง: ${CUST_NAME} (${CUST_ID})`);

  // ตรวจรหัสสินค้าก่อน — กันสร้างใบที่อ้างสินค้าไม่มีจริงแล้วไปพังตอนยืนยัน
  const codes = [...new Set(Object.values(G))];
  const goods = {};
  for (const c of codes) {
    const g = await run(`SELECT TOP 1 GoodID, GoodName1 AS GoodName FROM dbo.EMGood WHERE RTRIM(GoodCode) = '${esc(c)}'`);
    if (!g.length) { console.error(`✖ ไม่พบรหัสสินค้า ${c}`); await closePools(TARGET); process.exit(1); }
    goods[c] = g[0];
  }
  console.log(`✓ ตรวจรหัสสินค้าครบ ${codes.length} รายการ`);

  const owner = (await run(`SELECT TOP 1 Id FROM wf.AppUser WHERE Username = 'e2e_admin'`))[0];
  if (!owner) {
    console.error('✖ ไม่พบผู้ใช้ e2e_admin — รัน scripts/create_e2e_admin.js ก่อน');
    await closePools(TARGET); process.exit(1);
  }

  const made = [];
  for (const o of ORDERS) {
    const wfRef = `${o.soPrefix}TEST-${o.code}`;
    if ((await run(`SELECT TOP 1 Id FROM wf.SalesOrder WHERE WfRef = '${esc(wfRef)}'`)).length) {
      console.log(`- ข้าม ${wfRef} (มีอยู่แล้ว)`);
      continue;
    }

    const ins = await run(`
      INSERT INTO wf.SalesOrder
        (WfRef, SoPrefix, CustId, CustName, TruckPlate, ControlTicketNo, DeliveryDate,
         RequestedAt, IsOwnTruck, NoTruckRequired, PSling, Remark, SalesUserId,
         EnteredByUserId, RebateDiscountAmt, Status, CreditDays, CreatedAt, UpdatedAt)
      OUTPUT INSERTED.Id
      VALUES
        ('${esc(wfRef)}', '${o.soPrefix}', '${CUST_ID}', N'${esc(CUST_NAME)}',
         N'${esc(o.truckPlate)}', ${o.controlTicketNo ? `N'${esc(o.controlTicketNo)}'` : 'NULL'},
         CAST(GETDATE() AS DATE), GETDATE(), 0, 0, 0,
         N'${MARK} ${esc(o.code)} — ${esc(o.desc)}', ${owner.Id},
         ${owner.Id}, 0, 'DRAFT', 0, GETUTCDATE(), GETUTCDATE())`);
    const soId = ins[0].Id;

    let n = 0;
    for (const [code, ton, price, net, opt = {}] of o.lines) {
      const g = goods[code];
      n += 1;
      // LineAmount / RebatePerTon / RebateAmount เป็น computed column — ใส่เองไม่ได้
      // สูตรคือ QtyTon*PricePerTon และ PricePerTon-NetPricePerTon ตามลำดับ (ไม่ปัดพื้นที่ 0)
      // ของแถมจึงต้องตั้ง "ราคาสุทธิ" เป็น 0 ด้วย ไม่งั้นรีเบทจะติดลบ -7,700/ตัน
      const netUsed = opt.isGiveaway ? 0 : net;
      const ref = opt.refControlTicketNo ? `N'${esc(opt.refControlTicketNo)}'` : 'NULL';
      await run(`
        INSERT INTO wf.SalesOrderLine
          (SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon,
           NetPricePerTon, IsGiveaway, RefControlTicketNo, IsControlTicketDrawn,
           LoadSequence, CreatedAt)
        VALUES
          (${soId}, ${n}, '${esc(g.GoodID)}', '${esc(code)}', N'${esc(g.GoodName)}',
           ${ton}, ${ton * 20}, ${price}, ${netUsed},
           ${opt.isGiveaway ? 1 : 0}, ${ref}, ${opt.isControlTicketDrawn ? 1 : 0},
           ${n}, GETUTCDATE())`);
    }
    made.push({ 'เลขที่': wfRef, 'รูปแบบ': o.desc, 'บรรทัด': n });
  }

  console.log(`\n✓ สร้างใบสั่งขายทดสอบ ${made.length} ใบ (สถานะ DRAFT)`);
  if (made.length) console.table(made);

  console.log('\n=== สรุปใบทดสอบทั้งหมดในระบบ ===');
  console.table(await run(`
    SELECT so.WfRef AS [เลขที่], so.SoPrefix AS [ชนิด], so.Status AS [สถานะ],
           so.TruckPlate AS [ทะเบียนรถ], so.ControlTicketNo AS [ตั๋วคุม],
           COUNT(sol.Id) AS [บรรทัด],
           CAST(SUM(sol.QtyTon) AS DECIMAL(18,2)) AS [ตันรวม],
           CAST(SUM(sol.LineAmount) AS DECIMAL(18,2)) AS [เป็นเงิน]
    FROM   wf.SalesOrder so
    LEFT JOIN wf.SalesOrderLine sol ON sol.SoId = so.Id
    WHERE  so.Remark LIKE '${MARK}%'
    GROUP BY so.WfRef, so.SoPrefix, so.Status, so.TruckPlate, so.ControlTicketNo
    ORDER BY so.WfRef`));

  console.log('ขั้นถัดไป: เปิดหน้า "ใบสั่งขาย" กดยืนยันทีละใบ ตามเอกสาร MANUAL-TEST-REBATE-FIFO.md');
  await closePools(TARGET);
})().catch(e => { console.error(e.message); process.exit(1); });
