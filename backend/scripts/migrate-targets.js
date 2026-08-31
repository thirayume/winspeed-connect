#!/usr/bin/env node
/**
 * migrate-targets.js — รัน migration ไปหลายปลายทางในคำสั่งเดียว
 * ================================================================
 * ทำไมต้องมี:
 *   ระบบมี 3 ปลายทางที่ต้อง schema ตรงกัน (กำลังเทียบต้นทุน/ความง่ายในการดูแล)
 *     local    — SQLEXPRESS บนเครื่อง dev
 *     remote   — Azure VM (ระบบหลักเดิม · Vercel + Railway)
 *     remote_b — Hostinger VPS (ต่อตรงพอร์ต 1433 · ไม่ใช้ tunnel ตั้งแต่ 31/08/2569)
 *   ค่าเริ่มต้นคือ "all" เพราะใกล้ production แล้ว — schema ต้องไม่หลุดกัน
 *
 * ออกแบบให้ "ไม่แตะ" run_migrations.js และ db.js:
 *   db.js อ่าน env ตอน module load → จึง spawn process ใหม่ต่อ target
 *   พร้อม env ที่แมปแล้ว ทำให้ safety property ของ run_migrations.js คงเดิมทุกประการ
 *
 * ใช้งาน:
 *   node scripts/migrate-targets.js                        # = all
 *   node scripts/migrate-targets.js --plan                 # dry-run ทุกปลายทาง
 *   node scripts/migrate-targets.js --targets local,remote_b
 *   node scripts/migrate-targets.js --stop-on-error        # หยุดทันทีที่พลาด
 *
 * ค่า env ที่ต้องมี (ดู .env.example):
 *   local     LOCAL_DB_SERVER
 *   remote    REMOTE_DB_SERVER / _PORT / _USER / _PASSWORD
 *   remote_b  REMOTE_B_DB_SERVER / _PORT / _USER / _PASSWORD [/ _NAME]
 *             tunnel มีไว้เผื่อเท่านั้น และใช้ได้เมื่อ REMOTE_B_DB_SERVER=127.0.0.1 เท่านั้น
 * ================================================================
 */
'use strict';

const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const BACKEND_DIR = path.join(__dirname, '..');
// ต้องระบุ path ตรงๆ — สคริปต์นี้ถูกเรียกจาก root ด้วย (npm run migrate) ซึ่ง cwd ไม่ใช่ backend/
require('dotenv').config({ path: path.join(BACKEND_DIR, '.env') });

const RUNNER = path.join(BACKEND_DIR, 'run_migrations.js');
const REPAIRER = path.join(__dirname, 'repair-migration-checksum.js');
const PROBER = path.join(__dirname, 'schema-fingerprint.js');
const RESETTER = path.join(__dirname, 'reset-wf-schema.js');
const TRACER = path.join(__dirname, 'trace-document.js');
const ALL_TARGETS = ['local', 'remote', 'remote_b'];

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

// ── args ────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { plan: false, targets: null, stopOnError: false, help: false,
              repair: false, actor: '', reason: '', probe: false, reset: false, trace: '' };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--plan' || a === '--verify-only') o.plan = true;
    else if (a === '--stop-on-error') o.stopOnError = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--targets') o.targets = rest[++i];
    else if (a.startsWith('--targets=')) o.targets = a.slice('--targets='.length);
    else if (a === '--repair-checksums') o.repair = true;
    else if (a === '--probe-schema') o.probe = true;
    else if (a === '--trace-document') o.trace = rest[++i] || '';
    else if (a === '--reset-wf-schema') o.reset = true;
    else if (a === '--confirm-reset') o.confirmReset = true;
    else if (a === '--actor') o.actor = rest[++i] || '';
    else if (a === '--reason') o.reason = rest[++i] || '';
    else throw new Error(`ไม่รู้จัก argument: ${a}`);
  }
  // ซ่อม ledger เป็นการแก้บันทึกที่ควรตรวจย้อนได้ จึงบังคับให้ระบุคนสั่งและเหตุผล
  if (o.repair && !o.plan && (!o.actor || !o.reason)) {
    throw new Error('--repair-checksums ต้องมี --actor และ --reason (หรือใส่ --plan เพื่อดูอย่างเดียว)');
  }
  // ล้าง schema เป็นการลบข้อมูล จึงบังคับให้พิมพ์ยืนยันอีกชั้น และทำได้ทีละปลายทาง
  if (o.reset && !o.plan) {
    if (!o.confirmReset) throw new Error('--reset-wf-schema ต้องใส่ --confirm-reset ด้วย (หรือ --plan เพื่อดูก่อน)');
    if (!o.targets || o.targets.includes(',')) {
      throw new Error('--reset-wf-schema ต้องระบุ --targets ทีละปลายทางเท่านั้น');
    }
  }
  return o;
}

function resolveTargets(spec) {
  if (!spec || spec.toLowerCase() === 'all') return [...ALL_TARGETS];
  const picked = spec.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const bad = picked.filter(t => !ALL_TARGETS.includes(t));
  if (bad.length) throw new Error(`target ไม่ถูกต้อง: ${bad.join(', ')} (ใช้ได้: ${ALL_TARGETS.join(', ')} หรือ all)`);
  return picked;
}

// ── env ต่อ target ──────────────────────────────────────────────
// คืน null ถ้ายังตั้งค่าไม่ครบ → จะถูก "ข้าม" ไม่ใช่ "พัง"
function buildEnv(target) {
  const base = { ...process.env };

  if (target === 'local') {
    if (process.platform !== 'win32') return { skip: 'DB_MODE=local ใช้ได้เฉพาะ Windows (Trusted Connection)' };
    return { env: { ...base, DB_MODE: 'local' }, label: process.env.LOCAL_DB_SERVER || 'localhost\\SQLEXPRESS' };
  }

  if (target === 'remote') {
    if (!process.env.REMOTE_DB_SERVER || !process.env.REMOTE_DB_PASSWORD) {
      return { skip: 'ยังไม่ได้ตั้ง REMOTE_DB_SERVER / REMOTE_DB_PASSWORD' };
    }
    return {
      env: { ...base, DB_MODE: 'remote' },
      label: `${process.env.REMOTE_DB_SERVER}:${process.env.REMOTE_DB_PORT || 1433}`,
    };
  }

  // remote_b — แมป REMOTE_B_* ทับ REMOTE_* เพราะ db.js รู้จักแค่ REMOTE_*
  if (!process.env.REMOTE_B_DB_SERVER || !process.env.REMOTE_B_DB_PASSWORD) {
    return { skip: 'ยังไม่ได้ตั้ง REMOTE_B_DB_SERVER / REMOTE_B_DB_PASSWORD' };
  }
  const env = {
    ...base,
    DB_MODE: 'remote',
    REMOTE_DB_SERVER: process.env.REMOTE_B_DB_SERVER,
    REMOTE_DB_PORT: process.env.REMOTE_B_DB_PORT || '1433',
    REMOTE_DB_USER: process.env.REMOTE_B_DB_USER || 'sa',
    REMOTE_DB_PASSWORD: process.env.REMOTE_B_DB_PASSWORD,
    DB_NAME: process.env.REMOTE_B_DB_NAME || process.env.DB_NAME || 'dbwins_worldfert9',
  };
  return { env, label: `${env.REMOTE_DB_SERVER}:${env.REMOTE_DB_PORT} (Hostinger)` };
}

// ── SSH tunnel (เฉพาะ remote_b) ─────────────────────────────────
function portOpen(host, port, timeout = 1500) {
  return new Promise(resolve => {
    const s = new net.Socket();
    const done = ok => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
    s.connect(port, host);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * เปิด tunnel ถ้าจำเป็น — คืน { proc } เมื่อเป็นคนเปิดเอง (ต้องปิดทีหลัง)
 * ถ้าพอร์ตเปิดอยู่แล้ว (ผู้ใช้เปิดค้างไว้) จะ "ใช้ร่วม" และไม่ไปปิดของเขา
 */
async function ensureTunnel(env) {
  const host = env.REMOTE_DB_SERVER;
  const port = parseInt(env.REMOTE_DB_PORT, 10);

  if (await portOpen(host, port)) {
    return { proc: null, note: 'พอร์ตเปิดอยู่แล้ว — ใช้ tunnel เดิม' };
  }

  const sshHost = process.env.REMOTE_B_SSH_HOST;
  if (!sshHost) {
    // ปลายทางที่ไม่ใช่ localhost = ต่อตรง (เช่น Hostinger) — ต่อไม่ได้แทบทุกครั้งคือไฟร์วอลล์
    // ไม่ใช่เรื่อง tunnel การชี้ไป tunnel ตรงนี้เคยทำให้ไล่ผิดทาง
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error(
        `ต่อ ${host}:${port} ไม่ได้ — ปลายทางนี้ตั้งให้ต่อตรง ไม่ได้ใช้ tunnel\n` +
        `     สาเหตุที่พบบ่อยที่สุดคือไฟร์วอลล์ของ VPS อนุญาตเฉพาะบาง IP และ IP ของเครื่องนี้เปลี่ยนไปแล้ว\n` +
        `     แก้ที่เซิร์ฟเวอร์: ufw allow from <ip ปัจจุบัน> to any port ${port} proto tcp`
      );
    }
    throw new Error(`ต่อ ${host}:${port} ไม่ได้ และไม่ได้ตั้ง REMOTE_B_SSH_HOST ให้เปิด tunnel อัตโนมัติ`);
  }
  const sshUser = process.env.REMOTE_B_SSH_USER || 'root';
  const sshKey = process.env.REMOTE_B_SSH_KEY;
  const remotePort = process.env.REMOTE_B_SSH_REMOTE_PORT || '1433';

  const args = ['-N', '-o', 'StrictHostKeyChecking=no', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30', '-L', `${port}:127.0.0.1:${remotePort}`];
  if (sshKey) args.push('-i', sshKey);
  args.push(`${sshUser}@${sshHost}`);

  console.log(c.dim(`   เปิด SSH tunnel → ${sshUser}@${sshHost} (L:${port} → 127.0.0.1:${remotePort})`));
  const proc = spawn('ssh', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });

  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (proc.exitCode !== null) throw new Error(`SSH tunnel ปิดตัวเอง: ${stderr.trim() || 'exit ' + proc.exitCode}`);
    if (await portOpen(host, port)) return { proc, note: 'เปิด tunnel ให้อัตโนมัติ' };
  }
  proc.kill();
  throw new Error('เปิด SSH tunnel ไม่สำเร็จภายใน 10 วินาที');
}

// ── รัน run_migrations.js หนึ่งครั้ง ──────────────────────────────
//
// โหมด --repair-checksums จะเรียก repair-migration-checksum.js แทน
// มีเพราะเครื่องมือซ่อม checksum ต่อฐานผ่าน db.js ตรง ๆ จึงเปิด SSH tunnel เองไม่ได้
// ทำให้ remote_b ซ่อมไม่ได้เลยและติด drift ค้างจนรัน migration ต่อไม่ได้
function runMigrator(env, plan, repair, probe, reset, trace) {
  return new Promise(resolve => {
    const args = trace
      ? [TRACER]
      : probe
      ? [PROBER]
      : reset
      ? [RESETTER, ...(plan ? [] : ['--confirm-reset'])]
      : repair
        ? [REPAIRER, ...(plan ? [] : ['--apply', '--actor', repair.actor, '--reason', repair.reason])]
        : [RUNNER, ...(plan ? ['--plan'] : [])];
    // ส่งเลขที่เอกสารให้ trace-document.js ทาง env ไม่ผ่าน argv
    const childEnv = trace ? { ...env, TRACE_DOCUNO: trace } : env;
    const p = spawn(process.execPath, args, { cwd: BACKEND_DIR, env: childEnv, stdio: 'inherit' });
    p.on('close', code => resolve(code ?? 1));
    p.on('error', () => resolve(1));
  });
}

// ── main ────────────────────────────────────────────────────────
async function main() {
  let opts;
  try { opts = parseArgs(process.argv); }
  catch (e) { console.error(c.red(e.message)); process.exit(2); }

  if (opts.help) {
    console.log(`
ใช้งาน: node scripts/migrate-targets.js [options]

  --targets <list>   local,remote,remote_b หรือ all   (ค่าเริ่มต้น: all)
  --plan             dry-run อ่านอย่างเดียว ไม่แก้ ledger
  --stop-on-error    หยุดทันทีที่ปลายทางใดพลาด (ค่าเริ่มต้น: รันต่อจนครบแล้วสรุป)
  --repair-checksums ซ่อม checksum ที่เพี้ยนเพราะท้ายบรรทัด/คอมเมนต์ แทนการรัน migration
                     ต้องมี --actor และ --reason · ใส่ --plan เพื่อดูก่อนว่าจะซ่อมอะไร
  --probe-schema     พิมพ์ลายนิ้วมือ schema ของแต่ละปลายทาง (อ่านอย่างเดียว) ไว้เทียบกัน
  --trace-document <เลขที่>  ตามรอยเอกสารหนึ่งใบ (รัน sql/maintenance/trace-document.sql)
  --reset-wf-schema  ลบ schema wf ทั้งหมดเพื่อสร้างใหม่จาก migration ชุดเต็ม
                     ต้องมี --confirm-reset และระบุ --targets ทีละปลายทาง
                     ปฏิเสธเองถ้าพบข้อมูลที่สร้างใหม่ไม่ได้ (ใบสั่งขาย/ใบขอเคลียร์ ฯลฯ)
  -h, --help         แสดงข้อความนี้
`);
    process.exit(0);
  }

  let targets;
  try { targets = resolveTargets(opts.targets); }
  catch (e) { console.error(c.red(e.message)); process.exit(2); }

  console.log(c.bold(c.cyan('\n=== Migration หลายปลายทาง ===')));
  console.log(c.dim(`ปลายทาง: ${targets.join(', ')}${opts.plan ? '  ·  โหมด --plan (อ่านอย่างเดียว)' : ''}\n`));

  const results = [];
  for (const target of targets) {
    const built = buildEnv(target);

    if (built.skip) {
      console.log(c.yellow(`── ${target} — ข้าม`));
      console.log(c.dim(`   ${built.skip}\n`));
      results.push({ target, status: 'skipped', detail: built.skip });
      continue;
    }

    console.log(c.bold(c.cyan(`── ${target} → ${built.label}`)));

    let tunnel = { proc: null };
    try {
      if (target === 'remote_b') {
        tunnel = await ensureTunnel(built.env);
        console.log(c.dim(`   ${tunnel.note}`));
      }
    } catch (e) {
      console.log(c.red(`   เชื่อมต่อไม่ได้: ${e.message}\n`));
      results.push({ target, status: 'failed', detail: e.message });
      if (opts.stopOnError) break;
      continue;
    }

    const code = await runMigrator(built.env, opts.plan,
      opts.repair ? { actor: opts.actor, reason: opts.reason } : null,
      opts.probe, opts.reset, opts.trace);
    if (tunnel.proc) { tunnel.proc.kill(); console.log(c.dim('   ปิด tunnel แล้ว')); }

    if (code === 0) {
      console.log(c.green(`   ✓ ${target} สำเร็จ\n`));
      results.push({ target, status: 'ok' });
    } else {
      console.log(c.red(`   ✗ ${target} ล้มเหลว (exit ${code})\n`));
      results.push({ target, status: 'failed', detail: `exit ${code}` });
      if (opts.stopOnError) break;
    }
  }

  // ── สรุป ──
  console.log(c.bold(c.cyan('=== สรุป ===')));
  for (const r of results) {
    const mark = r.status === 'ok' ? c.green('✓ สำเร็จ')
      : r.status === 'skipped' ? c.yellow('– ข้าม  ')
        : c.red('✗ ล้มเหลว');
    console.log(`  ${mark}  ${r.target.padEnd(9)} ${r.detail ? c.dim(r.detail) : ''}`);
  }

  const notRun = targets.filter(t => !results.some(r => r.target === t));
  for (const t of notRun) console.log(`  ${c.dim('– ไม่ได้รัน')} ${t} ${c.dim('(หยุดเพราะ --stop-on-error)')}`);

  const failed = results.filter(r => r.status === 'failed');
  const skipped = results.filter(r => r.status === 'skipped');

  if (failed.length) {
    console.log(c.red(c.bold(`\n✗ ล้มเหลว ${failed.length} ปลายทาง — schema ยังไม่ตรงกันทุกที่\n`)));
    process.exit(1);
  }
  if (skipped.length) {
    console.log(c.yellow(`\n⚠ สำเร็จเท่าที่รันได้ แต่ข้าม ${skipped.length} ปลายทาง (ตั้งค่ายังไม่ครบ)\n`));
    process.exit(0);
  }
  console.log(c.green(c.bold('\n✓ ครบทุกปลายทาง — schema ตรงกัน\n')));
  process.exit(0);
}

main().catch(e => { console.error(c.red(`ผิดพลาด: ${e.message}`)); process.exit(1); });
