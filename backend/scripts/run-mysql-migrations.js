'use strict';
/**
 * run-mysql-migrations.js — ใช้ migration ฝั่งฐานเครื่องชั่ง (MySQL)
 *
 * แยกจาก run_migrations.js เพราะเป็นคนละฐานคนละชนิด และ ledger ของ SQL Server
 * (wf.SchemaMigration) ใช้ร่วมกันไม่ได้ จึงเก็บประวัติไว้ในตารางฝั่ง MySQL เอง
 *
 * ทุกสคริปต์ต้องสั่งซ้ำได้ (idempotent) — ตัว runner ตรวจ checksum เพื่อจับกรณี
 * แก้ไฟล์ที่ใช้ไปแล้ว ซึ่งเป็นวิธีเดียวกับฝั่ง SQL Server
 *
 *   node backend/scripts/run-mysql-migrations.js            # ดูว่ามีอะไรรอใช้
 *   node backend/scripts/run-mysql-migrations.js --apply    # ใช้จริง
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const DIR = path.join(__dirname, '..', 'migrations', 'mysql');
const APPLY = process.argv.includes('--apply');

// ตัดคอมเมนต์และช่องว่างออกก่อนคิด checksum เพื่อให้แก้คำอธิบายได้โดยไม่ถือว่า drift
const checksum = (sql) => crypto.createHash('sha256').update(
  sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()).digest('hex');

(async () => {
  if (!process.env.MYSQL_HOST) { console.error('ยังไม่ได้ตั้งค่า MYSQL_HOST'); process.exitCode = 1; return; }
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE, charset: 'utf8mb4', multipleStatements: true,
  });

  await conn.query(`
    CREATE TABLE IF NOT EXISTS wf_schema_migration (
      FileName VARCHAR(200) NOT NULL PRIMARY KEY,
      Checksum CHAR(64) NOT NULL,
      AppliedAt DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [applied] = await conn.query('SELECT FileName, Checksum FROM wf_schema_migration');
  const ledger = new Map(applied.map(r => [r.FileName, r.Checksum]));

  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort() : [];
  let pending = 0, drift = 0;

  for (const file of files) {
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    const sum = checksum(sql);
    const known = ledger.get(file);

    if (known && known !== sum) { console.error(`DRIFT  ${file} — ไฟล์ถูกแก้หลังใช้ไปแล้ว`); drift++; continue; }
    if (known) { console.log(`ok     ${file}`); continue; }

    pending++;
    if (!APPLY) { console.log(`PENDING ${file}`); continue; }

    console.log(`ใช้     ${file}`);
    const started = Date.now();
    await conn.query(sql);
    await conn.query('INSERT INTO wf_schema_migration (FileName, Checksum, AppliedAt) VALUES (?, ?, NOW())', [file, sum]);
    console.log(`       เสร็จใน ${((Date.now() - started) / 1000).toFixed(1)} วินาที`);
  }

  console.log(`\nทั้งหมด ${files.length} ไฟล์ · รอใช้ ${APPLY ? 0 : pending} · drift ${drift}`);
  if (!APPLY && pending) console.log('สั่ง --apply เพื่อใช้จริง');
  await conn.end();
  process.exitCode = drift ? 1 : 0;
})().catch(e => { console.error('ผิดพลาด:', e.message); process.exitCode = 1; });
