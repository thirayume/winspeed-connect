#!/usr/bin/env node
'use strict';
/**
 * reset-wf-schema.js — ล้าง schema wf ทั้งหมดเพื่อสร้างใหม่จาก migration ชุดเต็ม
 *
 * ⚠ ลบทุกตารางและวิวใน schema wf · ไม่แตะ dbo (ข้อมูล WINSpeed) เลย
 *
 * ทำไมต้องมี
 *   wf.SchemaMigration บอกว่า "รัน migration อะไรไปแล้ว" ไม่ได้บอกว่า schema เป็นยังไงจริง
 *   ถ้าสองอย่างหลุดจากกัน (เช่นฐานถูกสร้างจากที่อื่นแล้วยกมาแต่ ledger เก่า)
 *   การไล่รัน migration ย้อนหลังจะชนของที่ "มีอยู่แล้ว" หรือ "ถูกลบไปแล้ว" ไปเรื่อย ๆ
 *   ล้างแล้วรันใหม่ทั้งชุดจึงเป็นทางเดียวที่รับประกันว่า schema ตรงกับ ledger จริง
 *
 * ด่านกันพลาด — ปฏิเสธทันทีถ้าเจอข้อมูลที่สร้างใหม่ไม่ได้
 *   ตารางที่เก็บ "งานที่คนทำไว้" ต้องว่างทั้งหมด มิฉะนั้นหยุด
 *   ป้องกันไม่ให้เผลอรันกับฐานหลักหรือฐานที่มีคนใช้งานจริงอยู่
 *
 * ใช้งาน (ผ่าน migrate-targets เพื่อให้ได้ tunnel และ env ที่ถูกต้อง)
 *   node scripts/migrate-targets.js --reset-wf-schema --plan --targets remote_b
 *   node scripts/migrate-targets.js --reset-wf-schema --targets remote_b --confirm-reset
 */
require('dotenv').config({ quiet: true });
const { wfQuery } = require('../db');
const rs = (r) => (Array.isArray(r) ? r : r.recordset || r);

// ตารางที่เก็บงานของคนจริง — ถ้ามีแถวแม้แต่แถวเดียว ห้ามล้าง
const WORK_TABLES = [
  'SalesOrder', 'SalesOrderLine', 'Quotation', 'QuotationLine',
  'RebateClaim', 'RebateClaimLine', 'RebateLedger', 'RebatePlan', 'RebatePool',
  'GiveawayWithdrawal', 'GiveawayIssue', 'PriceBook', 'CustomerRequest',
];

async function main() {
  const apply = process.argv.includes('--confirm-reset');

  const counts = rs(await wfQuery(`
    SELECT t.name AS n, SUM(ps.row_count) AS c
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.dm_db_partition_stats ps ON ps.object_id = t.object_id AND ps.index_id IN (0,1)
    WHERE s.name = 'wf'
    GROUP BY t.name`));
  const rowOf = (n) => Number(counts.find((x) => x.n === n)?.c || 0);

  const occupied = WORK_TABLES.filter((t) => rowOf(t) > 0);
  if (occupied.length) {
    console.error('✗ หยุด — พบข้อมูลที่สร้างใหม่ไม่ได้ในตารางเหล่านี้:');
    for (const t of occupied) console.error(`    wf.${t} = ${rowOf(t).toLocaleString()} แถว`);
    console.error('  ฐานนี้มีคนใช้งานจริง ห้ามล้าง · ถ้าตั้งใจจริงต้องสำรองและลบข้อมูลออกก่อน');
    process.exit(1);
  }

  const views = rs(await wfQuery(
    `SELECT TABLE_NAME AS n FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA='wf'`));
  const tables = rs(await wfQuery(
    `SELECT t.name AS n FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='wf'`));

  console.log(`schema wf: ตาราง ${tables.length} · วิว ${views.length} · แถวรวม ` +
              counts.reduce((a, x) => a + Number(x.c), 0).toLocaleString());
  const keep = counts.filter((x) => Number(x.c) > 0)
    .sort((a, b) => b.c - a.c).slice(0, 8);
  for (const k of keep) console.log(`    wf.${k.n} = ${Number(k.c).toLocaleString()} แถว (จะหายไป)`);

  if (!apply) {
    console.log('\nโหมดดูอย่างเดียว — ไม่มีอะไรถูกลบ · เพิ่ม --confirm-reset เพื่อล้างจริง');
    process.exit(0);
  }

  // ลำดับสำคัญ: วิว → FK → ตาราง มิฉะนั้นติด dependency
  for (const v of views) await wfQuery(`DROP VIEW wf.[${v.n}]`);
  console.log(`  ลบวิว ${views.length} รายการ`);

  const fks = rs(await wfQuery(`
    SELECT fk.name AS fk, t.name AS tbl
    FROM sys.foreign_keys fk
    JOIN sys.tables t ON t.object_id = fk.parent_object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'wf'`));
  for (const f of fks) await wfQuery(`ALTER TABLE wf.[${f.tbl}] DROP CONSTRAINT [${f.fk}]`);
  console.log(`  ถอด foreign key ${fks.length} รายการ`);

  for (const t of tables) await wfQuery(`DROP TABLE wf.[${t.n}]`);
  console.log(`  ลบตาราง ${tables.length} รายการ`);

  const left = rs(await wfQuery(
    `SELECT COUNT(*) AS c FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='wf'`))[0].c;
  if (Number(left) !== 0) { console.error(`✗ ยังเหลือตาราง ${left} รายการ`); process.exit(1); }
  console.log('✓ schema wf ว่างแล้ว — รัน migration ชุดเต็มต่อได้');
  process.exit(0);
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
