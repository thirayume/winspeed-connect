#!/usr/bin/env node
'use strict';
/**
 * repair-migration-checksum.js — ซ่อม checksum ของ migration ที่ apply ไปแล้ว
 * เฉพาะกรณีที่ "SQL ที่รันจริงไม่เปลี่ยน"
 *
 * ทำไมต้องมี
 *   run_migrations.js ถือว่า migration ที่ apply แล้วเป็น immutable และหยุดทั้งชุด
 *   เมื่อพบ checksum drift ซึ่งถูกต้องแล้วสำหรับการแก้ที่กระทบ schema
 *   แต่การแก้ "คอมเมนต์" เช่น ถอดรหัสผ่านตัวอย่างออกจากไฟล์ด้วยเหตุผลด้านความปลอดภัย
 *   ไม่ได้เปลี่ยนสิ่งที่ฐานข้อมูลเคยรันเลย กลับทำให้ทุก migration ถัดไปถูกบล็อก
 *
 * หลักประกันที่สคริปต์นี้ยังรักษาไว้
 *   ซ่อมให้เฉพาะเมื่อ SQL ที่ถอดคอมเมนต์และช่องว่างออกแล้ว "เหมือนเดิมทุกตัวอักษร"
 *   ถ้าคำสั่งจริงเปลี่ยนแม้แต่นิดเดียวจะปฏิเสธ และบอกให้ไปสร้าง migration ใหม่แทน
 *
 * ใช้งาน
 *   node backend/scripts/repair-migration-checksum.js                 # ตรวจอย่างเดียว
 *   node backend/scripts/repair-migration-checksum.js --apply --actor "ชื่อผู้อนุมัติ" --reason "เหตุผล"
 */

const fs = require('fs');
const path = require('path');
const { sha256 } = require('../run_migrations');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

function parseArgs(argv) {
  const options = { apply: false, actor: '', reason: '' };
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--actor') options.actor = argv[++index] || '';
    else if (arg === '--reason') options.reason = argv[++index] || '';
    else throw new Error('Unknown argument: ' + arg);
  }
  return options;
}

// ถอดคอมเมนต์บรรทัด (--), คอมเมนต์บล็อก และช่องว่างทั้งหมด เพื่อเทียบเฉพาะคำสั่งจริง
function executableOnly(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*--.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ไล่ประวัติ git ของไฟล์ หาเวอร์ชันที่ sha256 ตรงกับ checksum ที่ ledger บันทึกไว้
// ถ้าหาไม่เจอ แปลว่าพิสูจน์ไม่ได้ว่าคำสั่งจริงไม่เปลี่ยน จึงไม่ยอมซ่อม
function findRevisionMatchingChecksum(fileName, storedChecksum) {
  const { execFileSync } = require('child_process');
  const repoRoot = path.resolve(__dirname, '..', '..');
  const relative = `backend/migrations/${fileName}`;
  let revisions = [];
  try {
    revisions = execFileSync('git', ['log', '--all', '--format=%H', '--', relative],
      { cwd: repoRoot, encoding: 'utf8' }).split('\n').map(line => line.trim()).filter(Boolean);
  } catch { return null; }

  const target = String(storedChecksum || '').toLowerCase();
  for (const revision of revisions) {
    let content;
    try {
      content = execFileSync('git', ['show', `${revision}:${relative}`],
        { cwd: repoRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    } catch { continue; }
    const clean = content.replace(/^﻿/, '');
    if (sha256(clean).toLowerCase() === target) return clean;
    // ไฟล์อาจถูกบันทึกด้วย CRLF ตอน apply ลองอีกแบบ
    const crlf = clean.replace(/\r?\n/g, '\r\n');
    if (sha256(crlf).toLowerCase() === target) return crlf;
  }
  return null;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.apply && (!options.actor || !options.reason)) {
    throw new Error('--apply ต้องระบุ --actor และ --reason เพื่อบันทึกเป็นหลักฐาน');
  }

  const db = require('../db');
  await db.ownerReady;
  const pool = db.ownerPool;

  const applied = (await pool.request().query(
    'SELECT FileName, Checksum FROM wf.SchemaMigration ORDER BY FileName')).recordset || [];

  const repairable = [];
  const blocked = [];

  for (const row of applied) {
    const file = path.join(MIGRATIONS_DIR, row.FileName);
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const current = sha256(sql);
    if (String(row.Checksum || '').toLowerCase() === current.toLowerCase()) continue;

    // ไฟล์เปลี่ยน — ต้องหาเนื้อหาเวอร์ชันที่ checksum ตรงกับ ledger จากประวัติ git
    // เพื่อพิสูจน์ว่าต่างกันเฉพาะคอมเมนต์ ไม่ใช่เดาจาก HEAD ซึ่งเป็นเนื้อหาใหม่ไปแล้ว
    const record = { file: row.FileName, storedChecksum: row.Checksum, currentChecksum: current };
    const previous = findRevisionMatchingChecksum(row.FileName, row.Checksum);
    if (previous == null) {
      blocked.push({ ...record, why: 'หาเวอร์ชันในประวัติ git ที่ checksum ตรงกับ ledger ไม่เจอ จึงพิสูจน์ไม่ได้ว่าคำสั่งไม่เปลี่ยน' });
    } else if (executableOnly(previous) === executableOnly(sql)) {
      repairable.push(record);
    } else {
      blocked.push({ ...record, why: 'คำสั่ง SQL ที่รันจริงเปลี่ยนไป' });
    }
  }

  if (!repairable.length && !blocked.length) {
    console.log('ไม่มี checksum drift — ไม่ต้องซ่อม');
    return;
  }

  for (const item of repairable) console.log(`  ซ่อมได้   ${item.file} (ต่างเฉพาะคอมเมนต์/ช่องว่าง)`);
  for (const item of blocked) console.log(`  ซ่อมไม่ได้ ${item.file} — ${item.why}`);

  if (!options.apply) {
    console.log('\nโหมดตรวจอย่างเดียว ไม่มีการแก้ ledger · เพิ่ม --apply --actor --reason เพื่อซ่อมจริง');
    if (blocked.length) process.exitCode = 1;
    return;
  }
  if (blocked.length) {
    throw new Error('มีไฟล์ที่คำสั่งจริงเปลี่ยน ให้สร้าง migration ใหม่แทน ไม่ซ่อม ledger');
  }

  // wf.SchemaMigration ไม่มีคอลัมน์สำหรับหมายเหตุ และการเพิ่มคอลัมน์นอก migration
  // จะกลายเป็น schema drift เสียเอง จึงบันทึกหลักฐานเป็นไฟล์ที่อยู่ใน version control
  const auditFile = path.join(MIGRATIONS_DIR, 'checksum-repairs.json');
  const audit = fs.existsSync(auditFile) ? JSON.parse(fs.readFileSync(auditFile, 'utf8')) : { repairs: [] };

  for (const item of repairable) {
    await pool.request()
      .input('f', item.file)
      .input('c', item.currentChecksum)
      .query('UPDATE wf.SchemaMigration SET Checksum = @c WHERE FileName = @f');
    audit.repairs.push({
      file: item.file,
      previousChecksum: item.storedChecksum,
      newChecksum: item.currentChecksum,
      verified: 'executable SQL identical after stripping comments and whitespace',
      actor: options.actor,
      reason: options.reason,
      repairedAt: new Date().toISOString(),
    });
    console.log(`  ✓ ซ่อม ${item.file}`);
  }

  fs.writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n', 'utf8');
  console.log(`\nซ่อมแล้ว ${repairable.length} ไฟล์ โดย ${options.actor}`);
  console.log(`บันทึกหลักฐานที่ ${path.relative(process.cwd(), auditFile)}`);
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch(error => { console.error('ERROR: ' + error.message); process.exit(1); });
