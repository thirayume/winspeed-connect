#!/usr/bin/env node
/**
 * backup-truckscale.js — สำรองฐานเครื่องชั่ง (D6-03)
 *
 * ฐาน MySQL ของเครื่องชั่งไม่เคยถูกสำรองเลยแม้แต่ครั้งเดียว ทั้งที่เป็นต้นทาง
 * ของน้ำหนักที่ใช้ออกใบกำกับและตัดยอดรีเบท ถ้าหายคือหายถาวร
 *
 * โรงงานไม่มี mysqldump ติดตั้งไว้ และเครื่องที่รันงานนี้ก็ไม่มี จึงสำรองด้วย
 * mysql2 ตรง ๆ แล้วเขียนเป็น .sql.gz ที่ผู้ดูแลกู้คืนได้ด้วย mysql client ปกติ
 *
 * อ่านอย่างเดียว — มีแต่ SELECT กับ SHOW CREATE TABLE ไม่มีคำสั่งเขียนใด ๆ
 *
 *   node backend/scripts/backup-truckscale.js
 *   node backend/scripts/backup-truckscale.js --out D:\backup --schema-only
 *   node backend/scripts/backup-truckscale.js --tables tblscale,tblproduct_detail
 *
 * ⚠ ไฟล์ผลลัพธ์มีชื่อลูกค้า ทะเบียนรถ และเลขเอกสารจริง — ห้าม commit
 *   ปลายทางปริยายอยู่ใน deploy/onprem/backup/ ซึ่ง .gitignore กันไว้แล้ว
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes('--' + name);

const OUT_DIR = flag('out', path.join(__dirname, '..', '..', 'deploy', 'onprem', 'backup', 'truckscale'));
const ONLY = (flag('tables') || '').split(',').map(t => t.trim()).filter(Boolean);
const SCHEMA_ONLY = has('schema-only');
const ROWS_PER_INSERT = 500;   // ก้อนใหญ่กว่านี้ชน max_allowed_packet ตอนกู้คืน

/** ค่าหนึ่งช่องเป็นข้อความ SQL — ต้องรับ null, ตัวเลข, วันที่ และ Buffer ให้ครบ */
function literal(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Buffer.isBuffer(v)) return '0x' + v.toString('hex');
  if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
  return "'" + String(v)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    .replace(/\0/g, '\\0').replace(/\x1a/g, '\\Z') + "'";
}

/** เขียนแล้วรอให้ buffer ระบายก่อน ไม่งั้นตารางล้านแถวจะกินหน่วยความจำจนตาย */
function write(stream, text) {
  return stream.write(text) ? Promise.resolve() : new Promise(r => stream.once('drain', r));
}

async function main() {
  if (!process.env.MYSQL_HOST) {
    console.error('ยังไม่ได้ตั้งค่า MYSQL_HOST — ตั้งใน backend/.env ก่อน');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '').replace(/-/g, '');
  const dbName = process.env.MYSQL_DATABASE;
  const outPath = path.join(OUT_DIR, `${dbName}-${stamp}${SCHEMA_ONLY ? '-schema' : ''}.sql.gz`);

  console.log(`สำรอง ${dbName} จาก ${process.env.MYSQL_HOST}`);
  console.log(`ปลายทาง ${outPath}${SCHEMA_ONLY ? ' (โครงสร้างอย่างเดียว)' : ''}\n`);

  // การเชื่อมต่อเดี่ยว ไม่ใช่ pool — งานนี้อ่านต่อเนื่องยาว ไม่ต้องแย่งคิวกับใคร
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: dbName,
    charset: 'utf8mb4',
    dateStrings: true,       // เก็บวันที่ตามที่ฐานเก็บจริง ไม่แปลงเขตเวลาระหว่างทาง
  });

  const gzip = zlib.createGzip({ level: 6 });
  const file = fs.createWriteStream(outPath);
  const done = new Promise((res, rej) => { file.on('finish', res); file.on('error', rej); });
  gzip.pipe(file);

  const summary = [];
  try {
    const [tableRows] = await conn.query(
      `SELECT TABLE_NAME AS n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`, [dbName]);
    let tables = tableRows.map(r => r.n);
    if (ONLY.length) {
      const missing = ONLY.filter(t => !tables.includes(t));
      if (missing.length) throw new Error(`ไม่พบตาราง: ${missing.join(', ')}`);
      tables = ONLY;
    }

    await write(gzip,
      `-- สำรองฐานเครื่องชั่ง ${dbName}\n` +
      `-- เมื่อ ${new Date().toISOString()} · ${tables.length} ตาราง\n` +
      `-- กู้คืน: gunzip -c <ไฟล์> | mysql -h <host> -u <user> -p <database>\n` +
      `-- ⚠ มีข้อมูลลูกค้าจริง ห้าม commit และห้ามส่งออกนอกองค์กร\n\n` +
      `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n\n`);

    for (const table of tables) {
      const [[create]] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
      await write(gzip, `\n--\n-- ตาราง ${table}\n--\nDROP TABLE IF EXISTS \`${table}\`;\n${create['Create Table']};\n\n`);

      if (SCHEMA_ONLY) { summary.push({ table, rows: 0 }); console.log(`  ${table} — โครงสร้าง`); continue; }

      const [[{ n: expected }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      let written = 0, buffer = [], columns = null;

      // stream ทีละแถว — tblproduct_detail มีห้าแสนแถว ดึงมาทั้งก้อนไม่ไหว
      const stream = conn.connection.query(`SELECT * FROM \`${table}\``).stream();
      for await (const row of stream) {
        if (!columns) columns = Object.keys(row).map(c => `\`${c}\``).join(', ');
        buffer.push('(' + Object.values(row).map(literal).join(',') + ')');
        if (buffer.length >= ROWS_PER_INSERT) {
          await write(gzip, `INSERT INTO \`${table}\` (${columns}) VALUES\n${buffer.join(',\n')};\n`);
          written += buffer.length; buffer = [];
        }
      }
      if (buffer.length) {
        await write(gzip, `INSERT INTO \`${table}\` (${columns}) VALUES\n${buffer.join(',\n')};\n`);
        written += buffer.length;
      }

      // นับสิ่งที่เขียนจริงเทียบกับที่ควรได้ — ไฟล์สำรองที่ขาดแถวเงียบ ๆ อันตรายกว่าไม่มีเลย
      if (written !== Number(expected)) {
        throw new Error(`${table}: เขียนได้ ${written} แถว แต่ตารางมี ${expected} แถว — ไฟล์สำรองไม่ครบ`);
      }
      summary.push({ table, rows: written });
      console.log(`  ${table} — ${written.toLocaleString()} แถว`);
    }

    await write(gzip, `\nSET FOREIGN_KEY_CHECKS=1;\n`);
  } finally {
    gzip.end();
    await conn.end().catch(() => {});
  }
  await done;

  const size = fs.statSync(outPath).size;
  const total = summary.reduce((a, s) => a + s.rows, 0);
  console.log(`\nสำเร็จ — ${summary.length} ตาราง · ${total.toLocaleString()} แถว · ${(size / 1048576).toFixed(1)} MB`);
  console.log(outPath);
}

if (require.main === module) {
  main().catch(e => { console.error('\nสำรองไม่สำเร็จ:', e.message); process.exit(1); });
}

module.exports = { literal };   // ให้ทดสอบการ escape ได้โดยไม่ต้องสำรองจริง
