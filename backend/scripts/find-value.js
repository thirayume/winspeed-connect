#!/usr/bin/env node
'use strict';
/**
 * find-value.js — ค้นค่าหนึ่งค่าในทุกตาราง/ทุกคอลัมน์ข้อความของ schema ที่ระบุ (อ่านอย่างเดียว)
 *
 * ใช้ตอนต้องตามรอยเอกสารหนึ่งใบว่าไปโผล่ที่ไหนบ้าง โดยไม่ต้องรู้โครงสร้างล่วงหน้า
 *
 *   node scripts/find-value.js --value I69-02420 --schema dbo
 *   DB_MODE=remote node scripts/find-value.js --value I69-02420 --schema wf --json
 *
 * วิธีทำงาน
 *   อ่านรายชื่อคอลัมน์ชนิดข้อความจาก INFORMATION_SCHEMA แล้วสร้าง EXISTS ทีละคอลัมน์
 *   ข้ามคอลัมน์ที่สั้นกว่าค่าที่ค้น (ใส่ไม่ลงอยู่แล้ว) เพื่อไม่เสียเวลาสแกน
 */
require('dotenv').config({ quiet: true });
const { query, wfQuery } = require('../db');
const rs = (r) => (Array.isArray(r) ? r : r.recordset || r);

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

async function main() {
  const value = arg('value');
  const schema = arg('schema', 'dbo');
  const asJson = process.argv.includes('--json');
  if (!value) throw new Error('ต้องระบุ --value');

  // wfQuery ใช้บัญชีเจ้าของซึ่งอ่านได้ทั้งสอง schema · query ใช้บัญชีอ่านอย่างเดียว
  const run = wfQuery;

  // --numeric: ค้นคอลัมน์ตัวเลขแทน (ใช้ตามรอย ID ที่คอลัมน์ข้อความมองไม่เห็น)
  const numeric = process.argv.includes('--numeric');
  const typeFilter = numeric
    ? `c.DATA_TYPE IN ('int','bigint','smallint','numeric','decimal','money')`
    : `c.DATA_TYPE IN ('varchar','nvarchar','char','nchar','text','ntext')
       AND (c.CHARACTER_MAXIMUM_LENGTH = -1 OR c.CHARACTER_MAXIMUM_LENGTH >= ${value.length})`;

  const cols = rs(await run(`
    SELECT c.TABLE_NAME AS t, c.COLUMN_NAME AS c, c.DATA_TYPE AS dt, c.CHARACTER_MAXIMUM_LENGTH AS len
    FROM INFORMATION_SCHEMA.COLUMNS c
    JOIN INFORMATION_SCHEMA.TABLES tb
      ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME AND tb.TABLE_TYPE = 'BASE TABLE'
    WHERE c.TABLE_SCHEMA = @s AND ${typeFilter}
    ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
    { s: { type: require('../db').sql.NVarChar(20), value: schema } }));

  if (!asJson) console.error(`ค้น "${value}" ใน ${schema} · ${cols.length} คอลัมน์`);

  const hits = [];
  // ยิงทีละ 40 คอลัมน์ เพื่อไม่ให้ statement ยาวจน SQL Server ปฏิเสธ
  for (let i = 0; i < cols.length; i += 40) {
    const chunk = cols.slice(i, i + 40);
    const parts = chunk.map(x =>
      `SELECT '${x.t}' AS TableName, '${x.c}' AS ColumnName, ` +
      (numeric
        ? `(SELECT COUNT(*) FROM [${schema}].[${x.t}] WHERE [${x.c}] = @n) AS Hits`
        : `(SELECT COUNT(*) FROM [${schema}].[${x.t}] WHERE CAST([${x.c}] AS NVARCHAR(MAX)) = @v) AS Hits`));
    let out;
    try {
      out = rs(await run(parts.join(' UNION ALL '),
        numeric
          ? { n: { type: require('../db').sql.Decimal(28, 4), value: Number(value) } }
          : { v: { type: require('../db').sql.NVarChar(400), value } }));
    } catch (e) {
      if (!asJson) console.error('  ข้ามกลุ่ม ' + i + ': ' + e.message.slice(0, 70));
      continue;
    }
    for (const r of out) if (Number(r.Hits) > 0) hits.push(r);
  }

  if (asJson) { console.log(JSON.stringify(hits, null, 1)); }
  else {
    console.log(`\nพบใน ${hits.length} คอลัมน์:`);
    for (const h of hits) console.log(`  ${schema}.${h.TableName}.${h.ColumnName} = ${h.Hits} แถว`);
  }
  process.exit(0);
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
