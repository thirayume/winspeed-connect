/**
 * ซ่อม ledger ของ 074_fix_winspeed_legacy_raiserror.sql ทุกปลายทาง
 *
 * ทำไมต้องมีตัวนี้แยก
 *   074 มี `USE dbwins_worldfert9;` ฝังไว้ตายตัว ทำให้รันกับฐานชื่ออื่นแล้วไปเขียนผิดฐาน
 *   เอาบรรทัดนั้นออกแล้ว แต่ทำให้จำนวนแบตช์เปลี่ยน (มี GO ตามมาด้วย)
 *   `repair-migration-checksum.js` ปฏิเสธทุกกรณีที่ batch count เปลี่ยน — ถูกต้องตามหลัก
 *   เพราะมันพิสูจน์เองไม่ได้ว่าการเปลี่ยนแบตช์ไม่กระทบอะไร
 *
 *   กรณีนี้ตรวจด้วยมือแล้วว่าไม่กระทบ: บรรทัดที่เอาออกคือ `USE` กับ `GO` ที่ตามมา
 *   ซึ่งไม่ได้ทำอะไรกับข้อมูล และตัวรันเลือกฐานปลายทางให้อยู่แล้ว
 *   คำสั่งที่เหลือทั้งหมดเหมือนเดิมทุกตัวอักษร
 *
 * ใช้:  node repair-074-ledger.js [--apply]
 */
const path = require('path');
const fs = require('fs');
const BACKEND = path.join(__dirname, '..', '..', 'backend');
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
const sql = require(path.join(BACKEND, 'node_modules', 'mssql'));
const { sha256, splitBatches } = require(path.join(BACKEND, 'run_migrations.js'));

const FILE = '074_fix_winspeed_legacy_raiserror.sql';
const APPLY = process.argv.includes('--apply');
const E = process.env;

const TARGETS = [
  { n: 'local',    server: 'localhost\\SQLEXPRESS', database: 'dbwins_worldfert9', trusted: true },
  { n: 'remote',   server: E.REMOTE_DB_SERVER,   port: +(E.REMOTE_DB_PORT || 1433),
    user: E.REMOTE_DB_USER,   password: E.REMOTE_DB_PASSWORD,   database: 'dbwins_worldfert9', encrypt: false },
  { n: 'remote_b', server: E.REMOTE_B_DB_SERVER, port: +(E.REMOTE_B_DB_PORT || 1433),
    user: E.REMOTE_B_DB_USER, password: E.REMOTE_B_DB_PASSWORD, database: 'dbwins_worldfert9', encrypt: true },
];

(async () => {
  const src = fs.readFileSync(path.join(BACKEND, 'migrations', FILE), 'utf8');
  const checksum = sha256(src);
  const batchCount = splitBatches(src).length;
  console.log(`ไฟล์ปัจจุบัน: checksum=${checksum.slice(0, 16)}…  batchCount=${batchCount}\n`);

  const audit = [];
  for (const t of TARGETS) {
    if (t.trusted) { console.log(`${t.n.padEnd(10)} ข้าม (Trusted Connection — ซ่อมด้วย Repair-074-Ledger.ps1)`); continue; }
    try {
      const pool = await new sql.ConnectionPool({
        server: t.server, port: t.port, user: t.user, password: t.password, database: t.database,
        options: { encrypt: t.encrypt, trustServerCertificate: true }, requestTimeout: 60000, connectionTimeout: 25000,
      }).connect();
      const before = (await pool.request().input('f', FILE)
        .query('SELECT Checksum, BatchCount FROM wf.SchemaMigration WHERE FileName=@f')).recordset[0];
      if (!before) { console.log(`${t.n.padEnd(10)} ไม่มีแถวนี้ใน ledger — ข้าม`); await pool.close(); continue; }
      if (before.Checksum.toLowerCase() === checksum.toLowerCase() && Number(before.BatchCount) === batchCount) {
        console.log(`${t.n.padEnd(10)} ตรงกันอยู่แล้ว`); await pool.close(); continue;
      }
      console.log(`${t.n.padEnd(10)} เดิม ${before.Checksum.slice(0, 16)}… batch ${before.BatchCount}  →  ใหม่ ${checksum.slice(0, 16)}… batch ${batchCount}`);
      if (APPLY) {
        const r = await pool.request().input('f', FILE).input('c', checksum).input('b', batchCount)
          .query('UPDATE wf.SchemaMigration SET Checksum=@c, BatchCount=@b WHERE FileName=@f');
        console.log(`${' '.repeat(10)} อัปเดต ${r.rowsAffected[0]} แถว`);
        audit.push({ file: FILE, target: t.n, previousChecksum: before.Checksum, newChecksum: checksum,
          previousBatchCount: before.BatchCount, newBatchCount: batchCount });
      }
      await pool.close();
    } catch (e) { console.log(`${t.n.padEnd(10)} X ${e.message.slice(0, 70)}`); }
  }

  if (APPLY && audit.length) {
    const f = path.join(BACKEND, 'migrations', 'checksum-repairs.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const a of audit) {
      j.repairs.push({ ...a,
        verified: 'เอาบรรทัด `USE dbwins_worldfert9;` กับ GO ที่ตามมาออก — เป็นข้อบกพร่องที่ทำให้ migration ไปเขียนผิดฐานเมื่อรันกับฐานชื่ออื่น · คำสั่งที่ทำงานจริงเหมือนเดิมทุกตัวอักษร ตัวรันเลือกฐานให้อยู่แล้ว',
        actor: 'Thirayu M. (owner)',
        reason: 'อนุมัติ 01/09/2569 · repair-migration-checksum.js ทำให้ไม่ได้เพราะ batch count เปลี่ยน ซึ่งมันปฏิเสธโดยออกแบบ',
        repairedAt: new Date().toISOString() });
    }
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n', 'utf8');
    console.log(`\nบันทึกหลักฐาน ${audit.length} รายการที่ migrations/checksum-repairs.json`);
  }
  if (!APPLY) console.log('\nโหมดตรวจอย่างเดียว — ใส่ --apply เพื่อซ่อมจริง');
})().catch(e => { console.error('X', e.message); process.exit(1); });
