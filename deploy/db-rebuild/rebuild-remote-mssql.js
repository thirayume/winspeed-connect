/**
 * สร้างฐาน WINSpeed ใหม่จาก .bak ต้นฉบับ — ทำงานผ่าน TCP อย่างเดียว
 *
 * มีตัวนี้เพราะ **Azure เข้าได้แค่พอร์ต 1433** ไม่มี SSH ให้รันสคริปต์บนเครื่อง
 * ตัวนี้จึงทำทุกอย่างผ่านการเชื่อมต่อ SQL ล้วน ๆ และใช้ได้กับ Hostinger ด้วย
 *
 * ทำอะไรบ้าง
 *   1. RESTORE จาก .bak ที่อยู่บนเครื่องเซิร์ฟเวอร์นั้นแล้ว (ไม่อัปโหลดไฟล์)
 *   2. recovery SIMPLE · ย่อ log · ตั้ง autogrowth เป็นก้อนคงที่
 *   3. สร้าง login/user ที่ถูก RESTORE ลบทิ้งไป
 *   4. fix_triggers_raiserror · fix_trigger2_iffailed · update_form
 *   5. สร้างสถิติใหม่ (ฐานนี้มาจาก SQL 2008 สถิติเดิมใช้กับ optimizer ปัจจุบันไม่ได้)
 *   6. QA
 *
 * ยังต้องรันต่อเอง: run_migrations.js แล้ว seed_admin.js
 * เพราะ .bak ไม่มี schema wf และไม่มี database user
 *
 * ใช้:  node rebuild-remote-mssql.js <azure|hostinger|hostinger-uat> [--apply]
 */
const path = require('path');
const fs = require('fs');
const BACKEND = path.join(__dirname, '..', '..', 'backend');
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
const sql = require(path.join(BACKEND, 'node_modules', 'mssql'));

const SQLDIR = 'L:\\My Drive\\World Fert\\RemoteDB';
const APPLY = process.argv.includes('--apply');
const WHICH = process.argv[2];

/** อ่านไฟล์ SQL — ไฟล์ชุดนี้มีทั้ง UTF-8 และ CP874 ปนกัน */
function readSql(name) {
  const buf = fs.readFileSync(path.join(SQLDIR, name));
  const utf8 = buf.toString('utf8');
  // ถ้า decode เป็น UTF-8 แล้วเจอ replacement char แปลว่าไม่ใช่ UTF-8
  // อ่านเป็น latin1 แทน — คอมเมนต์ไทยจะอ่านไม่ออกแต่ตัวคำสั่ง SQL เป็น ASCII จึงทำงานได้ถูกต้อง
  return utf8.includes('\uFFFD') ? buf.toString('latin1') : utf8.replace(/^\uFEFF/, '');
}
const splitBatches = s => String(s).split(/^\s*GO\s*$/im).filter(b => b.trim());

const vpsEnv = () => {
  const out = {};
  const f = path.join(__dirname, '..', 'cloud-vps', '.env');
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
};

const E = process.env;
const V = vpsEnv();
const TARGETS = {
  azure: {
    label: 'Azure (PROD-A)', server: E.REMOTE_DB_SERVER, port: +(E.REMOTE_DB_PORT || 1433),
    user: E.REMOTE_DB_USER, password: E.REMOTE_DB_PASSWORD, encrypt: false,
    database: 'dbwins_worldfert9',
    backup: '/var/opt/mssql/backup/dbwins_worldfert9_db.bak',
    dataDir: '/var/opt/mssql/data',
    readerPw: E.DB_PASSWORD, ownerPw: E.DB_OWNER_PASSWORD,
  },
  hostinger: {
    label: 'Hostinger (PROD-B)', server: E.REMOTE_B_DB_SERVER, port: +(E.REMOTE_B_DB_PORT || 1433),
    user: E.REMOTE_B_DB_USER, password: E.REMOTE_B_DB_PASSWORD, encrypt: true,
    database: 'dbwins_worldfert9',
    backup: '/var/opt/mssql/backup/incoming/dbwins_worldfert9_db_202607021642.bak',
    dataDir: '/var/opt/mssql/data',
    readerPw: V.WF_READER_PASSWORD, ownerPw: V.WF_OWNER_PASSWORD,
  },
  'hostinger-uat': {
    label: 'Hostinger (UAT)', server: E.REMOTE_B_DB_SERVER, port: +(E.REMOTE_B_DB_PORT || 1433),
    user: E.REMOTE_B_DB_USER, password: E.REMOTE_B_DB_PASSWORD, encrypt: true,
    database: 'dbwins_worldfert9_test',
    backup: '/var/opt/mssql/backup/incoming/dbwins_worldfert9_db_202607021642.bak',
    dataDir: '/var/opt/mssql/data',
    readerPw: V.WF_READER_PASSWORD, ownerPw: V.WF_OWNER_PASSWORD,
  },
};

const T = TARGETS[WHICH];
if (!T) { console.error(`ใช้: node rebuild-remote-mssql.js <${Object.keys(TARGETS).join('|')}> [--apply]`); process.exit(2); }

const connect = db => new sql.ConnectionPool({
  server: T.server, port: T.port, user: T.user, password: T.password, database: db,
  options: { encrypt: T.encrypt, trustServerCertificate: true },
  requestTimeout: 30 * 60 * 1000, connectionTimeout: 30000,
}).connect();

const step = s => console.log(`\n──────── ${s}`);

(async () => {
  console.log(`ปลายทาง: ${T.label}  ${T.server}:${T.port}/${T.database}`);
  console.log(`ไฟล์สำรองบนเซิร์ฟเวอร์: ${T.backup}`);
  if (!APPLY) { console.log('\nโหมดตรวจอย่างเดียว — ใส่ --apply เพื่อทำจริง'); return; }

  // ── 1. RESTORE (ต้องต่อ master เพราะกำลังจะเขียนทับฐานเป้าหมาย)
  step(`1/6 RESTORE ${T.database}`);
  let m = await connect('master');
  const hdr = (await m.request().query(`RESTORE HEADERONLY FROM DISK='${T.backup}'`)).recordset[0];
  console.log(`  ไฟล์นี้คือ backup ของ ${hdr.DatabaseName} เมื่อ ${hdr.BackupStartDate.toISOString()}`);
  await m.request().query(`
    IF DB_ID('${T.database}') IS NOT NULL ALTER DATABASE [${T.database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    RESTORE DATABASE [${T.database}] FROM DISK='${T.backup}'
      WITH MOVE 'dbERP_New_Data' TO '${T.dataDir}/${T.database}.mdf',
           MOVE 'dbERP_New_Log'  TO '${T.dataDir}/${T.database}_log.ldf',
           REPLACE, RECOVERY;
    ALTER DATABASE [${T.database}] SET MULTI_USER;`);
  console.log('  RESTORE เสร็จ');

  // ── 2. recovery model + ขนาดไฟล์
  // คง SIMPLE: ระบบนี้ไม่มี BACKUP LOG ตามกำหนดเวลา ถ้าเป็น FULL log จะโตไม่หยุด (เคยถึง 11 GB)
  // ตั้ง FILEGROWTH เป็นก้อนคงที่ — 10% บนไฟล์ 3.3 GB คือโตทีละ ~334 MB และหยุดรอทุกครั้ง
  step('2/6 recovery SIMPLE · ย่อ log · autogrowth คงที่');
  await m.request().query(`ALTER DATABASE [${T.database}] SET RECOVERY SIMPLE;`);
  await m.close();
  let d = await connect(T.database);
  await d.request().query('CHECKPOINT;');
  await d.request().query(`DBCC SHRINKFILE (N'dbERP_New_Log', 64);`);
  // ตั้งเฉพาะ FILEGROWTH — MODIFY FILE ตั้ง SIZE เล็กกว่าปัจจุบันไม่ได้
  await d.request().query(`
    ALTER DATABASE [${T.database}] MODIFY FILE (NAME=N'dbERP_New_Log',  FILEGROWTH=64MB);
    ALTER DATABASE [${T.database}] MODIFY FILE (NAME=N'dbERP_New_Data', FILEGROWTH=512MB);
    ALTER DATABASE [${T.database}] SET AUTO_CREATE_STATISTICS ON;
    ALTER DATABASE [${T.database}] SET AUTO_UPDATE_STATISTICS ON;`);
  console.log('  เสร็จ');

  // ── 3. login/user ที่ RESTORE ลบทิ้ง (login ระดับเซิร์ฟเวอร์รอด แต่ database user ไม่รอด)
  step('3/6 สร้าง database user + สิทธิ์');
  await d.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='wf_reader') CREATE USER wf_reader FOR LOGIN wf_reader;
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='wf_owner')  CREATE USER wf_owner  FOR LOGIN wf_owner;
    ALTER ROLE db_datareader ADD MEMBER wf_reader;
    ALTER ROLE db_datareader ADD MEMBER wf_owner;
    ALTER ROLE db_datawriter ADD MEMBER wf_owner;`);
  console.log('  wf_reader / wf_owner พร้อม');

  // ── 4. สคริปต์แก้ trigger และ form
  for (const [n, file] of [['4/6', 'fix_triggers_raiserror.sql'], ['4/6', 'fix_trigger2_iffailed.sql'], ['5/6', 'update_form.sql']]) {
    step(`${n} ${file}`);
    let text = readSql(file);
    // สคริปต์ต้นฉบับ hard-code ชื่อฐาน — ตัวรันเลือกฐานให้แล้ว จึงตัด USE ทิ้ง
    text = text.replace(/^[ \t]*USE\s+\[?dbwins_worldfert9\]?[ \t]*;?[ \t]*$/gim, '-- USE ถูกตัดออก: ต่อฐานถูกตัวอยู่แล้ว');
    for (const batch of splitBatches(text)) {
      const r = await d.request().query(batch);
      for (const line of (r.recordset ? [] : [])) console.log(line);
    }
    console.log('  รันแล้ว');
  }

  // ── 5. สถิติ — ฐานนี้ถูกแปลงจาก SQL 2008 (version 655) สถิติที่ติดมาใช้กับ optimizer ปัจจุบันไม่ได้
  step('6/6 สร้างสถิติใหม่ทั้งฐาน (ใช้เวลาสักครู่)');
  await d.request().query('EXEC sp_updatestats;');
  console.log('  เสร็จ');

  // ── 6. QA
  step('QA');
  const qa = (await d.request().query(`
    SELECT
      (SELECT COUNT(*) FROM sys.sql_modules WHERE definition LIKE '%raiserror @errno @errmsg%') AS triggers_ค้าง,
      (SELECT recovery_model_desc FROM sys.databases WHERE name=DB_NAME()) AS recovery,
      (SELECT CAST(size*8/1024 AS int) FROM sys.database_files WHERE name='dbERP_New_Log') AS log_MB,
      (SELECT CASE WHEN is_percent_growth=1 THEN CAST(growth AS varchar(9))+'%' ELSE CAST(growth*8/1024 AS varchar(9))+'MB' END
         FROM sys.database_files WHERE name='dbERP_New_Data') AS data_growth,
      (SELECT COUNT(*) FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo')) AS dbo_tables,
      (SELECT COUNT(*) FROM dbo.SOHD) AS SOHD,
      (SELECT COUNT(*) FROM dbo.SMForm WHERE Formpath LIKE 'C:\\Program Files\\Prosoft\\WINSpeed\\Forms\\%') AS SMForm_ok
  `)).recordset[0];
  console.table([qa]);
  if (qa['triggers_ค้าง'] !== 0) console.log('⚠ triggers ยังค้างอยู่ ต้องตรวจ');
  await d.close();
  console.log(`\n${T.label}: RESTORE + แก้ trigger/form + tune เสร็จ`);
  console.log('ขั้นต่อไป: run_migrations.js แล้ว seed_admin.js');
})().catch(e => { console.error('\nX', e.message); process.exit(1); });
