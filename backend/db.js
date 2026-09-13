/** SQL Server pools. local = Windows; remote = Docker SQL auth; remote_b = Hostinger. */
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { AsyncLocalStorage } = require('async_hooks');
const os = require('os');
const isWindows = os.platform() === 'win32';

// Use msnodesqlv8 on Windows for Windows Auth support, standard tedious on Linux (Docker)
const sql = isWindows ? require('mssql/msnodesqlv8') : require('mssql');

/** Explicit configured database targets; never silently fall back to another database. */
const { VALID_TARGETS, validateTarget } = require('./db-target-policy');
const RAW_MODE = (process.env.DB_MODE || 'local').toLowerCase().trim();
if (!VALID_TARGETS.includes(RAW_MODE)) {
  throw new Error(
    `DB_MODE="${RAW_MODE}" ไม่ถูกต้อง — รองรับเฉพาะ ${VALID_TARGETS.join(' | ')}`);
}
const DEFAULT_TARGET = RAW_MODE;
const DB = process.env.DB_NAME || 'dbwins_worldfert9';
const als = new AsyncLocalStorage();

function localConfig() {
  const localConnectionString = process.env.LOCAL_DB_CONNECTION_STRING;
  if (localConnectionString) {
    return { connectionString: localConnectionString, pool: { max: 10, min: 0, idleTimeoutMillis: 30000 } };
  }
  const server = process.env.LOCAL_DB_SERVER || 'localhost\\SQLEXPRESS';
  if (/^np:/i.test(server)) {
    return {
      connectionString:
        `Driver={SQL Server Native Client 11.0};Server=${server};Database=${DB};` +
        'Trusted_Connection=Yes;TrustServerCertificate=Yes;',
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    };
  }
  return {
    server,
    database: DB,
    options: { trustedConnection: true, trustServerCertificate: true, enableArithAbort: true },
    driver: 'msnodesqlv8',
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
}
function remoteConfig() {
  const server = process.env.REMOTE_DB_SERVER;
  const port   = parseInt(process.env.REMOTE_DB_PORT || '1433', 10);
  const user   = process.env.REMOTE_DB_USER || 'sa';
  const pwd    = process.env.REMOTE_DB_PASSWORD || '';
  if (!server || !pwd) throw new Error('DB_MODE=remote requires explicit REMOTE_DB_SERVER / REMOTE_DB_PASSWORD (Docker SQL Server)');
  
  if (isWindows) {
    const connectionString =
      `Driver={ODBC Driver 17 for SQL Server};Server=${server},${port};Database=${DB};` +
      `Uid=${user};Pwd={${pwd}};Encrypt=yes;TrustServerCertificate=yes;`;
    return { connectionString, pool: { max: 10, min: 0, idleTimeoutMillis: 30000 } };
  } else {
    return {
      user,
      password: pwd,
      server,
      port,
      database: DB,
      requestTimeout:    30000,
      connectionTimeout: 15000,
      options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
    };
  }
}

/** Explicit configured database targets; never silently fall back to another database. */
function remoteBConfig() {
  const server = process.env.REMOTE_B_DB_SERVER;
  const port   = parseInt(process.env.REMOTE_B_DB_PORT || '1433', 10);
  const user   = process.env.REMOTE_B_DB_USER || 'sa';
  const pwd    = process.env.REMOTE_B_DB_PASSWORD || '';
  const db     = process.env.REMOTE_B_DB_NAME || DB;

  if (!server || !pwd) {
    throw new Error('DB_MODE=remote_b แต่ยังไม่ได้ตั้ง REMOTE_B_DB_SERVER / REMOTE_B_DB_PASSWORD');
  }

  if (isWindows) {
    // tunnel เป็น loopback จึงไม่บังคับเข้ารหัส แต่ยอมรับได้ถ้าเซิร์ฟเวอร์บังคับเอง
    const connectionString =
      `Driver={ODBC Driver 17 for SQL Server};Server=${server},${port};Database=${db};` +
      `Uid=${user};Pwd={${pwd}};Encrypt=yes;TrustServerCertificate=yes;`;
    return { connectionString, pool: { max: 10, min: 0, idleTimeoutMillis: 30000 } };
  }
  return {
    user, password: pwd, server, port, database: db,
    requestTimeout: 30000,
    connectionTimeout: 15000,
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
}

// registry: target -> { readerPool, ownerPool, ready }
const CONFIG_BY_TARGET = { local: localConfig, remote: remoteConfig, remote_b: remoteBConfig };
const registry = {};
function makeTarget(target) {
  const cfgFn = CONFIG_BY_TARGET[target];
  if (!cfgFn) throw new Error(`ปลายทางฐานข้อมูลไม่รู้จัก: ${target}`);
  // ⚠ ต้องสร้าง config แยก object ต่อ pool — msnodesqlv8 mutate config (แชร์ object → pool ที่ 2 hang)
  const readerPool = new sql.ConnectionPool(cfgFn());
  const ownerPool  = new sql.ConnectionPool(cfgFn());
  // Handle pool-level errors so they don't become uncaught exceptions that corrupt process state
  readerPool.on('error', (e) => console.error(`[DB] readerPool (${target}) error:`, e.message));
  ownerPool.on('error',  (e) => console.error(`[DB] ownerPool (${target}) error:`, e.message));
  const ready = Promise.all([readerPool.connect(), ownerPool.connect()])
    .then(() => { console.log(`✓ DB pools connected — ${target}`); })
    .catch(e => { console.error(`✗ DB ${target} connect failed:`, e.message); throw e; });
  return { readerPool, ownerPool, ready };
}
function pools(target) {
  const t = target || (als.getStore()?.target) || DEFAULT_TARGET;
  if (!registry[t]) {
    const entry = makeTarget(t);
    // ถ้าต่อไม่ติด ให้เคลียร์ออกเพื่อ retry ครั้งถัดไป (ไม่ค้าง promise reject)
    entry.ready.catch(() => { if (registry[t] === entry) delete registry[t]; });
    registry[t] = entry;
  }
  return registry[t];
}
function getTarget() { return als.getStore()?.target || DEFAULT_TARGET; }

// connect default target ตั้งแต่ start (remote = lazy)
const def = pools(DEFAULT_TARGET);

// ── helpers (เลือก pool ตาม target ปัจจุบัน) ──────────────────
async function query(text, inputs = {}) {
  const pl = pools();
  await pl.ready;
  const req = pl.readerPool.request();
  for (const [k, { type, value }] of Object.entries(inputs)) req.input(k, type, value);
  const actualText = isWindows ? text : `SET ARITHABORT ON; SET ANSI_WARNINGS ON; ${text}`;
  return (await req.query(actualText)).recordset;
}
/**
 * เขียนข้อมูลใน dbo (WINSpeed) — ต้องใช้ ownerPool ไม่ใช่ readerPool
 *
 * query() ด้านบนใช้ readerPool และคืนเฉพาะ .recordset จึงใช้เขียนไม่ได้ด้วยสองเหตุผล
 *   1. readerPool อาจถูกตั้งสิทธิ์อ่านอย่างเดียวในบางสภาพแวดล้อม
 *   2. ไม่มี rowsAffected ให้ตรวจว่ามีแถวถูกแก้จริงหรือไม่
 *
 * คืน result object เต็มเหมือน wfQuery เพื่อให้ตรวจ rowsAffected ได้
 */
async function dboWrite(text, inputs = {}) {
  const pl = pools();
  await pl.ready;
  const req = pl.ownerPool.request();
  for (const [k, { type, value }] of Object.entries(inputs)) req.input(k, type, value);
  const actualText = isWindows ? text : `SET ARITHABORT ON; SET ANSI_WARNINGS ON; ${text}`;
  return await req.query(actualText);
}

async function wfQuery(text, inputs = {}) {
  const pl = pools();
  await pl.ready;
  const req = pl.ownerPool.request();
  for (const [k, { type, value }] of Object.entries(inputs)) req.input(k, type, value);
  const actualText = isWindows ? text : `SET ARITHABORT ON; SET ANSI_WARNINGS ON; ${text}`;
  return await req.query(actualText);
}
async function wfTransaction(fn) {
  const pl = pools();
  await pl.ready;
  const tx = new sql.Transaction(pl.ownerPool);
  await tx.begin();
  try {
    const r = await fn(tx);
    await tx.commit();
    return r;
  } catch (e) {
    try { await tx.rollback(); } catch (_) {}
    throw e;
  }
}

// รัน callback ภายใต้ DB target ที่กำหนด (ใช้ใน middleware)
function runWithTarget(target, fn) {
  const t = validateTarget(target);
  return als.run({ target: t }, fn);
}

module.exports = {
  sql, query, dboWrite, wfQuery, wfTransaction, runWithTarget, getTarget, pools,
  DEFAULT_TARGET,
  // backward-compat: pool ของ default target (ใช้โดย scripts + /admin/migrate)
  readerPool: def.readerPool, ownerPool: def.ownerPool,
  readerReady: def.ready, ownerReady: def.ready,
};
