/**
 * db.js — SQL Server แบบ dual-pool สลับได้ runtime (local ↔ remote)
 * ──────────────────────────────────────────────────────────────
 * ใช้ msnodesqlv8 ทั้งคู่ (driver เดียว → type เดียว → routes ไม่ต้องแก้):
 *   local  = Windows Authentication (.\SQLEXPRESS, named-pipe)
 *   remote = SQL Server Authentication (sa) ผ่าน ODBC Driver 17 / TCP (public IP)
 *
 * เลือก target ต่อ request ผ่าน header X-DB-Target: local|remote (AsyncLocalStorage)
 * ค่า default = DB_MODE ใน .env (ใช้กับ scripts: seed/import/export)
 *
 * ⚠ IRON RULE: dbo = READ-ONLY — โค้ดเขียนเฉพาะ wf.* (master.js = SELECT ล้วน)
 */
require('dotenv').config();
const { AsyncLocalStorage } = require('async_hooks');
const os = require('os');
const isWindows = os.platform() === 'win32';

// Use msnodesqlv8 on Windows for Windows Auth support, standard tedious on Linux (Railway/Render)
const sql = isWindows ? require('mssql/msnodesqlv8') : require('mssql');

const DEFAULT_TARGET = (process.env.DB_MODE || 'local').toLowerCase() === 'remote' ? 'remote' : 'local';
const DB = process.env.DB_NAME || 'dbwins_worldfert9';
const als = new AsyncLocalStorage();

function localConfig() {
  return {
    server: process.env.LOCAL_DB_SERVER || 'localhost\\SQLEXPRESS',
    database: DB,
    options: { trustedConnection: true, trustServerCertificate: true, enableArithAbort: true },
    driver: 'msnodesqlv8',
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
}
function remoteConfig() {
  const server = process.env.REMOTE_DB_SERVER || '20.255.185.14';
  const port   = parseInt(process.env.REMOTE_DB_PORT || '1433', 10);
  const user   = process.env.REMOTE_DB_USER || 'sa';
  const pwd    = process.env.REMOTE_DB_PASSWORD || '';
  
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
      options: { encrypt: true, trustServerCertificate: true },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
    };
  }
}

// registry: target -> { readerPool, ownerPool, ready }
const registry = {};
function makeTarget(target) {
  const cfgFn = target === 'remote' ? remoteConfig : localConfig;
  // ⚠ ต้องสร้าง config แยก object ต่อ pool — msnodesqlv8 mutate config (แชร์ object → pool ที่ 2 hang)
  const readerPool = new sql.ConnectionPool(cfgFn());
  const ownerPool  = new sql.ConnectionPool(cfgFn());
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
  return (await req.query(text)).recordset;
}
async function wfQuery(text, inputs = {}) {
  const pl = pools();
  await pl.ready;
  const req = pl.ownerPool.request();
  for (const [k, { type, value }] of Object.entries(inputs)) req.input(k, type, value);
  return await req.query(text);
}
async function wfTransaction(fn) {
  const pl = pools();
  await pl.ready;
  const tx = new sql.Transaction(pl.ownerPool);
  await tx.begin();
  try { const r = await fn(tx); await tx.commit(); return r; }
  catch (e) { await tx.rollback(); throw e; }
}

// รัน callback ภายใต้ DB target ที่กำหนด (ใช้ใน middleware)
function runWithTarget(target, fn) {
  const t = target === 'remote' ? 'remote' : 'local';
  return als.run({ target: t }, fn);
}

module.exports = {
  sql, query, wfQuery, wfTransaction, runWithTarget, getTarget, pools,
  DEFAULT_TARGET,
  // backward-compat: pool ของ default target (ใช้โดย scripts + /admin/migrate)
  readerPool: def.readerPool, ownerPool: def.ownerPool,
  readerReady: def.ready, ownerReady: def.ready,
};
