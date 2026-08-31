#!/usr/bin/env node
/**
 * ตัวผลักข้อมูล TruckScale จากโรงงานขึ้นคลาวด์
 *
 * ทำไมไม่ใช้ replication ของ MySQL
 *   replication ให้ปลายทางเป็นฝ่ายต่อเข้ามาหาต้นทาง ซึ่งโรงงานอยู่หลัง NAT จึงต้องมีอุโมงค์
 *   และต้องเปิด binlog ที่เครื่องโรงงาน = ต้องรีสตาร์ต MySQL = เครื่องชั่งทุกเครื่องหยุด
 *   ตัวนี้ต่อ "ขาออก" ทั้งสองทางจากเครื่องในโรงงาน และ **อ่านอย่างเดียว** ที่ต้นทาง
 *   ไม่ต้องแก้ config ไม่ต้องรีสตาร์ต ไม่แตะ TruckScale
 *
 * กติกาการตามข้อมูล
 *   ตารางส่วนใหญ่มี PK เป็น auto-increment จึงตามของใหม่ด้วย "PK > ค่าที่จำไว้" ได้ตรง ๆ
 *   แต่ของเดิมถูกแก้ได้ด้วย — ตั๋วถูกสร้างตอนชั่งเข้า แล้ว UPDATE ตอนชั่งออก
 *   ถ้าตามแค่ PK จะพลาดการแก้ทั้งหมด จึงส่งซ้ำ "ช่วงท้าย" ทุกรอบ (REFRESH_TAIL)
 *   ค่าปริยาย 2000 แถวท้าย ครอบคลุมงานหลายวันของโรงงานขนาดนี้อย่างสบาย
 *
 * ปลายทางใช้ INSERT ... ON DUPLICATE KEY UPDATE จึงส่งซ้ำได้ไม่เสียหาย
 * รันซ้ำหลังเน็ตหลุดก็ได้ผลเท่าเดิม
 *
 * ตำแหน่งที่ทำไปแล้วเก็บเป็นไฟล์ JSON ข้าง ๆ สคริปต์ — ไม่ต้องสร้างตารางที่โรงงาน
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const CFG = {
  source: {
    host: env('SRC_HOST', '127.0.0.1'),
    port: Number(env('SRC_PORT', '3306')),
    user: env('SRC_USER', 'root'),
    password: env('SRC_PASS', ''),
    database: env('SRC_DB', 'db_truckscale'),
  },
  target: {
    host: req('DST_HOST'),
    port: Number(env('DST_PORT', '3306')),
    user: req('DST_USER'),
    password: req('DST_PASS'),
    database: env('DST_DB', 'db_truckscale'),
  },
  intervalSec: Number(env('INTERVAL_SEC', '60')),
  batch: Number(env('BATCH', '2000')),
  refreshTail: Number(env('REFRESH_TAIL', '2000')),
  once: process.argv.includes('--once'),
  statePath: env('STATE_PATH', path.join(__dirname, 'watermark.json')),
};

// ตารางที่ผลัก
//   mode 'inc'  = ตามด้วย PK auto-increment + ส่งซ้ำช่วงท้าย (ตารางที่โตเรื่อย ๆ)
//   mode 'full' = ส่งทั้งตารางทุกรอบ (ตารางข้อมูลหลักที่เล็กและไม่มี auto-increment)
//
// สามตัวแรกคือข้อมูลการชั่ง · อีกสามตัวเป็นข้อมูลหลักที่รายงานต้นฉบับต้องใช้
// (ดู TRUCKSCALE-REPORT-INVENTORY — 41 รายงานใช้แค่ 6 ตารางนี้)
const TABLES = [
  { name: 'tbl_keyone',        pk: 'one_id', mode: 'inc'  },
  { name: 'tblscale',          pk: 's_id',   mode: 'inc'  },
  { name: 'tblproduct_detail', pk: 'pd_id',  mode: 'inc'  },
  { name: 'tblcustomer',       pk: 'id',     mode: 'inc'  },
  { name: 'tblproduct',        pk: 'id',     mode: 'inc'  },
  // bo_id ไม่ใช่ auto-increment และมีอยู่ 8 แถว จึงส่งทั้งตารางทุกรอบ ถูกกว่าการตามหาส่วนต่าง
  { name: 'tbl_boat',          pk: 'bo_id',  mode: 'full' },
];

function env(k, d) { const v = process.env[k]; return v === undefined || v === '' ? d : v; }
function req(k) {
  const v = process.env[k];
  if (!v) { console.error(`ต้องตั้งค่า ${k}`); process.exit(2); }
  return v;
}
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(now(), ...a);

function loadState() {
  try { return JSON.parse(fs.readFileSync(CFG.statePath, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  // เขียนไฟล์ชั่วคราวก่อนแล้วค่อยสลับ — ไฟฟ้าดับกลางคันจะได้ไม่เหลือไฟล์ครึ่ง ๆ
  const tmp = CFG.statePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8');
  fs.renameSync(tmp, CFG.statePath);
}

async function columnsOf(conn, db, table) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [db, table]);
  return rows.map(r => r.COLUMN_NAME);
}

async function pushTable(src, dst, t, state) {
  const cols = await columnsOf(src, CFG.source.database, t.name);
  if (!cols.length) { log(`  ${t.name}: ไม่พบตารางที่ต้นทาง — ข้าม`); return 0; }

  const dstCols = await columnsOf(dst, CFG.target.database, t.name);
  const use = cols.filter(c => dstCols.includes(c));
  if (!use.length) { log(`  ${t.name}: ปลายทางไม่มีคอลัมน์ที่ตรงกัน — ข้าม`); return 0; }
  if (use.length !== cols.length) {
    log(`  ${t.name}: คอลัมน์ต่างกัน ส่งเฉพาะที่ตรงกัน ${use.length}/${cols.length}`);
  }

  const list = use.map(c => `\`${c}\``).join(',');
  const upd = use.filter(c => c !== t.pk).map(c => `\`${c}\`=VALUES(\`${c}\`)`).join(',');
  let sent = 0;

  if (t.mode === 'full') {
    // ตารางข้อมูลหลักขนาดเล็ก — ส่งทั้งใบ ไม่ต้องจำตำแหน่ง
    const [rows] = await src.query(`SELECT ${list} FROM \`${t.name}\``);
    if (rows.length) {
      await dst.query(
        `INSERT INTO \`${t.name}\` (${list}) VALUES ? ON DUPLICATE KEY UPDATE ${upd}`,
        [rows.map(r => use.map(c => r[c]))]);
      sent = rows.length;
      log(`  ${t.name}: ส่งทั้งตาราง ${sent} แถว`);
    }
    return sent;
  }

  const last = Number(state[t.name] || 0);
  const [[{ hi }]] = await src.query(`SELECT COALESCE(MAX(\`${t.pk}\`),0) AS hi FROM \`${t.name}\``);
  if (hi === 0) return 0;

  // ของใหม่ + ช่วงท้ายที่อาจถูกแก้ย้อนหลัง
  let cursor = Math.max(0, Math.min(last, hi - CFG.refreshTail));

  while (cursor < hi) {
    const [rows] = await src.query(
      `SELECT ${list} FROM \`${t.name}\` WHERE \`${t.pk}\` > ? ORDER BY \`${t.pk}\` LIMIT ?`,
      [cursor, CFG.batch]);
    if (!rows.length) break;

    const values = rows.map(r => use.map(c => r[c]));
    await dst.query(
      `INSERT INTO \`${t.name}\` (${list}) VALUES ? ON DUPLICATE KEY UPDATE ${upd}`, [values]);

    cursor = Number(rows[rows.length - 1][t.pk]);
    sent += rows.length;
  }

  state[t.name] = hi;
  if (sent) log(`  ${t.name}: ส่ง ${sent} แถว · ถึง ${t.pk}=${hi}`);
  return sent;
}

async function cycle(src, dst) {
  const state = loadState();
  let total = 0;
  for (const t of TABLES) total += await pushTable(src, dst, t, state);
  saveState(state);
  if (!total) log('  ไม่มีอะไรใหม่');
  return total;
}

(async () => {
  log(`ต้นทาง  ${CFG.source.host}:${CFG.source.port}/${CFG.source.database}`);
  log(`ปลายทาง ${CFG.target.host}:${CFG.target.port}/${CFG.target.database}`);
  log(`รอบละ ${CFG.intervalSec} วินาที · ช่วงท้ายที่ส่งซ้ำ ${CFG.refreshTail} แถว`);

  const src = await mysql.createConnection({ ...CFG.source, connectTimeout: 20000 });
  const dst = await mysql.createConnection({
    ...CFG.target, connectTimeout: 30000,
    // ต้องเปิดเพื่อส่งหลายแถวต่อคำสั่ง
    multipleStatements: false,
  });

  // ต้นทางต้องแตะแบบอ่านอย่างเดียวเท่านั้น — กันพลาดไว้ที่ระดับ session
  await src.query('SET SESSION TRANSACTION READ ONLY');

  if (CFG.once) {
    await cycle(src, dst);
    await src.end(); await dst.end();
    return;
  }

  let stopping = false;
  process.on('SIGINT', () => { stopping = true; log('กำลังปิด...'); });
  process.on('SIGTERM', () => { stopping = true; });

  while (!stopping) {
    try { await cycle(src, dst); }
    catch (e) { log('รอบนี้ล้มเหลว:', e.code || e.message, '— จะลองใหม่รอบหน้า'); }
    for (let i = 0; i < CFG.intervalSec && !stopping; i++) await new Promise(r => setTimeout(r, 1000));
  }
  await src.end().catch(() => {}); await dst.end().catch(() => {});
  log('ปิดเรียบร้อย');
})().catch(e => { console.error(now(), 'ล้มเหลว:', e.message); process.exit(1); });
