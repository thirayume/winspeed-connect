#!/usr/bin/env node
'use strict';
/**
 * schema-fingerprint.js — ลายนิ้วมือ schema ของ wf สำหรับเทียบระหว่างปลายทาง (อ่านอย่างเดียว)
 *
 * ทำไมต้องมี
 *   wf.SchemaMigration บอกว่า "รัน migration อะไรไปแล้ว" ไม่ได้บอกว่า "schema เป็นยังไงจริง"
 *   สองอย่างนี้หลุดจากกันได้ เช่นเมื่อฐานถูก restore มาจากที่อื่นแล้วยกมาแต่ ledger เก่า
 *   ผลคือ migration ที่ ledger บอกว่ายังไม่รัน กลับล้มเพราะของที่มันจะสร้าง "มีอยู่แล้ว"
 *   หรือกลับกัน ล้มเพราะของที่มันจะแก้ "ถูกลบไปแล้ว"
 *
 *   สคริปต์นี้พิมพ์ลายนิ้วมือออกมาให้เทียบกันตรง ๆ ว่าปลายทางไหนต่างตรงไหน
 *
 * ใช้งาน (ผ่าน migrate-targets เพื่อให้ได้ tunnel และ env ที่ถูกต้อง)
 *   node scripts/migrate-targets.js --probe-schema
 *   node scripts/migrate-targets.js --probe-schema --targets local,remote_b
 */
require('dotenv').config({ quiet: true });
const { wfQuery } = require('../db');
const rs = (r) => (Array.isArray(r) ? r : r.recordset || r);

async function main() {
  const tables = rs(await wfQuery(`
    SELECT TABLE_NAME AS n, COUNT(*) AS cols
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'wf'
    GROUP BY TABLE_NAME ORDER BY TABLE_NAME`));
  const views = rs(await wfQuery(
    `SELECT TABLE_NAME AS n FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA='wf' ORDER BY 1`));
  const led = rs(await wfQuery(
    `SELECT COUNT(*) AS c, MAX(FileName) AS last FROM wf.SchemaMigration`))[0];

  // จำนวนแถวของทุกตารางใน wf — ใช้ตัดสินว่าปลายทางนี้มีข้อมูลจริงหรือเป็นฐานเปล่า
  // อ่านจาก dm_db_partition_stats ไม่ใช่ COUNT(*) เพราะไม่ต้องสแกนตาราง
  const rows = rs(await wfQuery(`
    SELECT t.name AS n, SUM(ps.row_count) AS c
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.dm_db_partition_stats ps ON ps.object_id = t.object_id AND ps.index_id IN (0,1)
    WHERE s.name = 'wf'
    GROUP BY t.name HAVING SUM(ps.row_count) > 0
    ORDER BY SUM(ps.row_count) DESC`));
  const totalRows = rows.reduce((a, r) => a + Number(r.c), 0);

  // พิมพ์บรรทัดเดียวต่อหนึ่งอย่าง เพื่อให้ diff ระหว่างปลายทางอ่านง่าย
  console.log(`FINGERPRINT tables=${tables.length} views=${views.length} ` +
              `ledger=${led.c} last=${led.last} rows=${totalRows}`);
  for (const t of tables) console.log(`  T ${t.n} (${t.cols})`);
  for (const v of views) console.log(`  V ${v.n}`);
  for (const r of rows) console.log(`  R ${r.n} = ${Number(r.c).toLocaleString()}`);
  process.exit(0);
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
