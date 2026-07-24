/**
 * preflight-check.js — ตรวจความพร้อมก่อน/หลัง deploy (Coolify, Docker, หรือ local)
 *
 * ตรวจ: env vars ที่โค้ดอ่านจริง · SQL Server (เชื่อมต่อ/DB/collation/ขนาด/wf migrations)
 *       · MySQL TruckScale · ความปลอดภัย (JWT/CORS) · timezone · กับดักที่เคยเจอ
 *
 * USAGE:
 *   node scripts/preflight-check.js            # ตรวจทั้งหมด
 *   node scripts/preflight-check.js --no-db    # ตรวจเฉพาะ env (ไม่ต่อ DB)
 *
 * EXIT: 0 = ผ่าน (อาจมี warning) · 1 = มี BLOCKER ที่ต้องแก้ก่อน deploy
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const os = require('os');

const NO_DB = process.argv.includes('--no-db');
const C = { red: s => `\x1b[31m${s}\x1b[0m`, grn: s => `\x1b[32m${s}\x1b[0m`,
            yel: s => `\x1b[33m${s}\x1b[0m`, cyn: s => `\x1b[36m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m` };
const blockers = [], warns = [], oks = [];
const ok    = (m) => { oks.push(m); console.log('  ' + C.grn('✓') + ' ' + m); };
const warn  = (m, fix) => { warns.push(m); console.log('  ' + C.yel('!') + ' ' + m + (fix ? C.dim('\n      → ' + fix) : '')); };
const block = (m, fix) => { blockers.push(m); console.log('  ' + C.red('✗') + ' ' + m + (fix ? C.dim('\n      → ' + fix) : '')); };
const head  = (m) => console.log('\n' + C.cyn('── ' + m + ' ' + '─'.repeat(Math.max(0, 46 - m.length))));

const E = k => (process.env[k] || '').trim();
const isLinux = os.platform() !== 'win32';

(async () => {
  console.log(C.cyn('\n=== WS-Sale-App · Pre-flight Check ==='));
  console.log(C.dim(`platform=${os.platform()} node=${process.version} NODE_ENV=${E('NODE_ENV') || '(unset)'}`));

  // ── 1. SQL Server env ───────────────────────────────────────
  head('SQL Server config');
  const mode = E('DB_MODE').toLowerCase();
  if (!mode) block('DB_MODE ไม่ได้ตั้ง', 'ตั้ง DB_MODE=remote สำหรับ container/Linux');
  else if (isLinux && mode !== 'remote')
    block(`DB_MODE="${mode}" บน Linux ใช้ไม่ได้ (local = Windows Trusted Connection)`, 'ตั้ง DB_MODE=remote');
  else ok(`DB_MODE=${mode}`);

  if (E('DB_HOST') || E('DB_PORT'))
    warn('พบ DB_HOST/DB_PORT — โค้ด "ไม่อ่าน" ตัวแปรนี้ (จะถูกเพิกเฉย)',
         'ใช้ REMOTE_DB_SERVER / REMOTE_DB_PORT แทน');

  if (mode === 'remote') {
    const srv = E('REMOTE_DB_SERVER');
    if (!srv) block('REMOTE_DB_SERVER ไม่ได้ตั้ง', 'ตั้งเป็นชื่อ service เช่น "mssql" (ไม่ใช่ IP)');
    else {
      ok(`REMOTE_DB_SERVER=${srv}`);
      if (/^\d+\.\d+\.\d+\.\d+$/.test(srv))
        warn(`REMOTE_DB_SERVER เป็น IP (${srv})`, 'ใน Coolify ควรใช้ชื่อ service ใน Docker network');
      if (srv === '20.255.185.14')
        block('REMOTE_DB_SERVER ยังชี้ IP Azure เดิม', 'เปลี่ยนเป็น "mssql"');
    }
    if (!E('REMOTE_DB_USER')) block('REMOTE_DB_USER ไม่ได้ตั้ง', 'ปกติคือ sa');
    if (!E('REMOTE_DB_PASSWORD')) block('REMOTE_DB_PASSWORD ไม่ได้ตั้ง', 'ต้องตรงกับ MSSQL_SA_PASSWORD ของ container');
    else ok('REMOTE_DB_PASSWORD ตั้งแล้ว');
  }
  if (!E('DB_NAME')) block('DB_NAME ไม่ได้ตั้ง', 'DB_NAME=dbwins_worldfert9');
  else ok(`DB_NAME=${E('DB_NAME')}`);

  // ── 2. MySQL env ────────────────────────────────────────────
  head('TruckScale (MySQL) config');
  if (!E('MYSQL_HOST')) warn('MYSQL_HOST ไม่ได้ตั้ง — ฟีเจอร์ TruckScale จะปิดทำงาน (getPool() = null)',
                             'ตั้งถ้าต้องใช้ Weigh Inbox / ชั่งออก');
  else {
    ok(`MYSQL_HOST=${E('MYSQL_HOST')}:${E('MYSQL_PORT') || 3306}`);
    if (!E('MYSQL_DATABASE')) block('MYSQL_DATABASE ไม่ได้ตั้ง', 'ปกติคือ db_truckscale');
    if (!E('MYSQL_PASSWORD')) warn('MYSQL_PASSWORD ว่าง');
  }

  // ── 3. security / server ────────────────────────────────────
  head('Security & server');
  const jwt = E('JWT_SECRET');
  if (!jwt) block('JWT_SECRET ไม่ได้ตั้ง', 'openssl rand -base64 48');
  else if (jwt.length < 32) block(`JWT_SECRET สั้นเกินไป (${jwt.length} ตัว)`, 'ต้อง >= 32 ตัวอักษร');
  else if (/change_this|changeme|secret|example/i.test(jwt)) block('JWT_SECRET ยังเป็นค่า placeholder', 'สุ่มค่าจริง');
  else ok(`JWT_SECRET ยาว ${jwt.length} ตัว`);

  if (E('NODE_ENV') !== 'production' && isLinux)
    warn(`NODE_ENV="${E('NODE_ENV') || '(unset)'}" บน server`, 'ตั้ง NODE_ENV=production');
  if (!E('CORS_ORIGIN')) warn('CORS_ORIGIN ไม่ได้ตั้ง', 'ตั้งเป็นโดเมน frontend มิฉะนั้นอาจโดน CORS block');
  else ok(`CORS_ORIGIN=${E('CORS_ORIGIN')}`);

  const exp = E('EXPORT_OUTPUT_PATH');
  if (isLinux && /^[A-Za-z]:\\/.test(exp))
    block(`EXPORT_OUTPUT_PATH เป็น Windows path บน Linux (${exp})`, 'เปลี่ยนเป็น /app/exports');
  else if (exp) ok(`EXPORT_OUTPUT_PATH=${exp}`);

  const tz = E('TZ') || Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!/Bangkok|\+07/.test(tz)) warn(`timezone = ${tz}`, 'ตั้ง TZ=Asia/Bangkok (ข้อมูลใช้ พ.ศ./เวลาไทย)');
  else ok(`TZ=${tz}`);

  if (NO_DB) { return finish(); }

  // ── 4. SQL Server live checks ───────────────────────────────
  head('SQL Server — live');
  let query;
  try {
    ({ query } = require('../db'));
    const v = (await query(`SELECT @@VERSION AS V, SERVERPROPERTY('Edition') AS Ed,
                            DB_NAME() AS DbNow, SERVERPROPERTY('Collation') AS SrvColl`))[0];
    ok(`เชื่อมต่อได้ · ${String(v.Ed).split('(')[0].trim()} · db=${v.DbNow}`);

    const edition = String(v.Ed);
    const files = await query(`SELECT type_desc, CAST(SUM(size)*8.0/1024/1024 AS DECIMAL(10,2)) AS GB
                               FROM sys.database_files GROUP BY type_desc`);
    const dataGB = Number((files.find(f => f.type_desc === 'ROWS') || {}).GB || 0);
    if (/Express/i.test(edition)) {
      if (dataGB >= 10) block(`Express Edition แต่ data = ${dataGB} GB (ลิมิต 10 GB)`, 'เปลี่ยนเป็น Developer/Standard');
      else if (dataGB >= 8) warn(`Express: data ${dataGB} GB ใกล้ลิมิต 10 GB`, 'วางแผน upgrade edition');
      else ok(`Express: data ${dataGB} GB < 10 GB`);
    } else ok(`data ${dataGB} GB · edition ${edition.split('(')[0].trim()}`);

    const coll = (await query(`SELECT DATABASEPROPERTYEX(DB_NAME(),'Collation') AS C`))[0].C;
    if (coll !== 'Thai_CI_AS') warn(`DB collation = ${coll} (คาดหวัง Thai_CI_AS)`);
    else ok(`DB collation = ${coll}`);
    if (v.SrvColl !== coll)
      warn(`server collation (${v.SrvColl}) ต่างจาก DB (${coll})`,
           'ตั้ง MSSQL_COLLATION=Thai_CI_AS ตอนสร้าง container กัน tempdb collation conflict');

    // vendor dbo tables must exist (read-only ERP)
    const dboCnt = (await query(`SELECT COUNT(*) AS n FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
                                 WHERE s.name='dbo' AND t.name IN ('SOHD','SODT','SOInvHD','ARReceHD','WFCoupon','EMCust')`))[0].n;
    if (dboCnt < 6) block(`ตาราง WINSpeed (dbo) ไม่ครบ — พบ ${dboCnt}/6`, 'restore backup ยังไม่สมบูรณ์');
    else ok('ตาราง WINSpeed (dbo) ครบ');

    // wf schema = app-owned, needs migrations
    const wfCnt = (await query(`SELECT COUNT(*) AS n FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='wf'`))[0].n;
    if (wfCnt === 0) block('ไม่พบตารางใน schema wf เลย', 'รัน migrations: npm run migrate');
    else {
      const need = ['SalesOrder','RebatePool','RebateLedger','WeighInbox','AppUser','TruckScaleSync'];
      const got = (await query(`SELECT t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='wf'`)).map(r => r.name);
      const miss = need.filter(n => !got.includes(n));
      if (miss.length) block(`schema wf ขาดตาราง: ${miss.join(', ')}`, 'รัน migrations ให้ครบ');
      else ok(`schema wf ครบ (${wfCnt} ตาราง)`);
    }
  } catch (e) {
    block(`เชื่อมต่อ SQL Server ไม่ได้: ${e.message}`,
          'ตรวจ REMOTE_DB_SERVER (ชื่อ service), password, และ backend อยู่ Docker network เดียวกับ mssql');
  }

  // ── 5. MySQL live check ─────────────────────────────────────
  head('TruckScale (MySQL) — live');
  if (!E('MYSQL_HOST')) warn('ข้าม (MYSQL_HOST ไม่ได้ตั้ง)');
  else {
    try {
      const { tsQuery } = require('../services/truckscale-db');
      const n = (await tsQuery('SELECT COUNT(*) AS n FROM tblscale'))[0].n;
      ok(`เชื่อมต่อได้ · tblscale = ${Number(n).toLocaleString()} แถว`);
      if (Number(n) === 0) warn('tblscale ว่าง', 'ตรวจว่า restore/ชี้ host ถูกฐาน');
    } catch (e) {
      block(`เชื่อมต่อ MySQL ไม่ได้: ${e.message}`, 'ตรวจ MYSQL_HOST/USER/PASSWORD และ network');
    }
  }

  finish();
})().catch(e => { console.error(C.red('\nFATAL: ' + e.message)); process.exit(1); });

function finish() {
  console.log('\n' + C.cyn('── สรุป ' + '─'.repeat(40)));
  console.log(`  ${C.grn('ผ่าน')} ${oks.length}   ${C.yel('เตือน')} ${warns.length}   ${C.red('ต้องแก้')} ${blockers.length}`);
  if (blockers.length) {
    console.log('\n' + C.red('BLOCKERS — ต้องแก้ก่อน deploy:'));
    blockers.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
    console.log('');
    process.exit(1);
  }
  console.log('\n' + C.grn(warns.length ? '✓ ผ่าน (มีคำเตือน ควรตรวจก่อน go-live)' : '✓ ผ่านทั้งหมด — พร้อม deploy') + '\n');
  process.exit(0);
}
