/** SQL Server pools. local = Windows; remote = Docker SQL auth; remote_b = Hostinger. */
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { AsyncLocalStorage } = require('async_hooks');
const os = require('os');
const isWindows = os.platform() === 'win32';

// Use msnodesqlv8 on Windows for Windows Auth support, standard tedious on Linux (Docker)
const sql = isWindows ? require('mssql/msnodesqlv8') : require('mssql');
const { withNativeSessionSettings } = require('./services/native-session-pool');
const RuntimePool = isWindows ? withNativeSessionSettings(sql.ConnectionPool) : sql.ConnectionPool;

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

const { validateLocalTargetRecord } = require('./safety-validator');
const { onpremConnectionConfig, assertOnpremPools } = require('./onprem-target');

function parseConnectionString(connStr) {
  if (!connStr || typeof connStr !== 'string') {
    throw new Error('SECURITY_ERROR: Connection string must be a non-empty string.');
  }
  const pairs = connStr.split(';').map(s => s.trim()).filter(Boolean);
  const fields = {};
  const duplicateKeys = [];
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim().toLowerCase();
    const val = pair.slice(eqIdx + 1).trim();
    if (fields[key] !== undefined) {
      duplicateKeys.push(key);
    }
    fields[key] = val;
  }
  if (duplicateKeys.length > 0) {
    throw new Error(`SECURITY_ERROR: Duplicate connection string parameters are prohibited: ${duplicateKeys.join(', ')}`);
  }
  return fields;
}

function validateLocalConnectionString(connStr, target) {
  const fields = parseConnectionString(connStr);
  const trusted = (fields['trusted_connection'] || '').toLowerCase();
  const integrated = (fields['integrated security'] || '').toLowerCase();
  if (trusted === 'yes' || trusted === 'true' || integrated === 'sspi' || integrated === 'true') {
    throw new Error(`SECURITY_ERROR: Connection string for ${target} cannot use Windows authentication; explicit approved SQL authentication is required.`);
  }

  const isRehearsal = target === 'local_rehearsal';
  const expectedDb = isRehearsal ? 'dbwins_worldfert9_rehearsal' : process.env.ALLOW_RESTORED_LOCAL_UAT === 'true' ? 'dbwins_worldfert9' : 'dbwins_worldfert9_local_uat';
  const expectedUser = isRehearsal ? 'wf_uat_migrator' : 'wf_uat_app';

  const actualDb = fields['database'] || fields['initial catalog'] || '';
  if (actualDb.toLowerCase() !== expectedDb.toLowerCase()) {
    throw new Error(`SECURITY_ERROR: Connection string for ${target} must target database "${expectedDb}" (got: "${actualDb}").`);
  }

  const actualUser = fields['uid'] || fields['user id'] || fields['user'] || '';
  if (actualUser.toLowerCase() !== expectedUser.toLowerCase()) {
    throw new Error(`SECURITY_ERROR: Connection string for ${target} must use principal "${expectedUser}" (got: "${actualUser}").`);
  }

  const actualServer = fields['server'] || fields['data source'] || fields['address'] || '';
  const sLower = actualServer.toLowerCase();
  const validServers = ['amyou-yoga7\\v2008r2', 'localhost\\v2008r2', '(local)\\v2008r2'];
  if (!validServers.includes(sLower)) {
    throw new Error(`SECURITY_ERROR: Connection string for ${target} must target local instance "AMYOU-YOGA7\\V2008R2" (got: "${actualServer}").`);
  }
}

async function validateStartupTargetIdentity(readerPool, ownerPool, target) {
  const isRehearsal = target === 'local_rehearsal';
  const targetType = isRehearsal ? 'rehearsal' : 'uat';
  const isMigratorOp = isRehearsal || process.env.DB_OPERATION === 'migration';
  const operation = isMigratorOp ? 'migrator' : 'runtime';
  const query = `
    SELECT 
      DB_NAME() AS dbName,
      @@SERVERNAME AS serverName,
      SUSER_SNAME() AS loginName,
      ORIGINAL_LOGIN() AS originalLogin,
      SERVERPROPERTY('ProductVersion') AS productVersion,
      CONNECTIONPROPERTY('net_transport') AS netTransport,
      IS_SRVROLEMEMBER('sysadmin') AS isSysadmin,
      IS_SRVROLEMEMBER('securityadmin') AS isSecurityadmin,
      IS_SRVROLEMEMBER('serveradmin') AS isServeradmin,
      IS_SRVROLEMEMBER('dbcreator') AS isDbcreator,
      HAS_PERMS_BY_NAME(null, null, 'CONTROL SERVER') AS hasControlServer,
      HAS_DBACCESS('dbwins_worldfert9') AS prodAccess,
      HAS_DBACCESS('dbwins_worldfert9') AS hasProdAccess,
      (SELECT COUNT(*) FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb', DB_NAME()) AND HAS_DBACCESS(name) = 1) AS otherUserDbCount;
  `;

  const readerRes = await readerPool.request().query(query);
  const readerRow = readerRes.recordset && readerRes.recordset[0];
  validateLocalTargetRecord(readerRow, process.env, { targetType, operation });

  const ownerRes = await ownerPool.request().query(query);
  const ownerRow = ownerRes.recordset && ownerRes.recordset[0];
  validateLocalTargetRecord(ownerRow, process.env, { targetType, operation });
}

function localUatConfig() {
  const connStr = process.env.LOCAL_UAT_CONNECTION_STRING;
  if (process.env.ALLOW_RESTORED_LOCAL_UAT === 'true' && connStr) throw new Error('Restored localhost UAT requires structured connection fields');
  if (connStr) {
    validateLocalConnectionString(connStr, 'local_uat');
    return { connectionString: connStr, pool: { max: 10, min: 0, idleTimeoutMillis: 30000 } };
  }
  const isMigrator = process.env.DB_OPERATION === 'migration';
  const server = process.env.LOCAL_UAT_SERVER || 'AMYOU-YOGA7\\V2008R2';
  const db = process.env.LOCAL_UAT_DB || (process.env.ALLOW_RESTORED_LOCAL_UAT === 'true' ? 'dbwins_worldfert9' : 'dbwins_worldfert9_local_uat');
  const user = isMigrator
    ? (process.env.LOCAL_UAT_MIGRATOR_USER || process.env.LOCAL_UAT_USER || 'wf_uat_migrator')
    : (process.env.LOCAL_UAT_USER || 'wf_uat_app');
  const pwd = isMigrator
    ? (process.env.LOCAL_UAT_MIGRATOR_PASSWORD || process.env.LOCAL_UAT_PASSWORD)
    : process.env.LOCAL_UAT_PASSWORD;
  const allowedRestoredLogins = ['wf_uat_app', 'wf_uat_migrator'];
  if (process.env.ALLOW_RESTORED_LOCAL_UAT === 'true' && (server.toLowerCase() !== 'amyou-yoga7\\v2008r2' || db !== 'dbwins_worldfert9' || !allowedRestoredLogins.includes(user))) throw new Error('Restored localhost connection tuple mismatch');
  if (!pwd) {
    throw new Error('SECURITY_ERROR: Missing password for local_uat; implicit Windows authentication fallback is prohibited.');
  }
  const connectionString =
    `Driver={SQL Server Native Client 10.0};Server=lpc:${server};Database=${db};` +
    `Uid=${user};Pwd={${pwd}};`;
  return { connectionString, pool: { max: 10, min: 0, idleTimeoutMillis: 30000 } };
}

function localRehearsalConfig() {
  const connStr = process.env.LOCAL_REHEARSAL_CONNECTION_STRING;
  if (connStr) {
    validateLocalConnectionString(connStr, 'local_rehearsal');
    return { connectionString: connStr, pool: { max: 10, min: 0, idleTimeoutMillis: 30000 } };
  }
  const server = process.env.LOCAL_REHEARSAL_SERVER || 'AMYOU-YOGA7\\V2008R2';
  const db = process.env.LOCAL_REHEARSAL_DB || 'dbwins_worldfert9_rehearsal';
  const user = process.env.LOCAL_REHEARSAL_USER || 'wf_uat_migrator';
  const pwd = process.env.LOCAL_REHEARSAL_PASSWORD;
  if (!pwd) {
    throw new Error('SECURITY_ERROR: Missing password for local_rehearsal; implicit Windows authentication fallback is prohibited.');
  }
  const connectionString =
    `Driver={SQL Server Native Client 10.0};Server=${server};Database=${db};` +
    `Uid=${user};Pwd={${pwd}};`;
  return { connectionString, pool: { max: 10, min: 0, idleTimeoutMillis: 30000 } };
}

// registry: target -> { readerPool, ownerPool, ready }
const CONFIG_BY_TARGET = {
  local: localConfig,
  remote: remoteConfig,
  remote_b: remoteBConfig,
  local_uat: localUatConfig,
  local_rehearsal: localRehearsalConfig,
  onprem: () => onpremConnectionConfig(process.env, process.env.DB_OPERATION === 'migration' ? 'migration' : 'runtime', isWindows),
};
const registry = {};
function makeTarget(target) {
  if (process.env.LOCAL_ONLY_MODE === 'true' && target !== 'local_uat') throw new Error('LOCAL_ONLY_MODE prohibits this database target');
  const cfgFn = CONFIG_BY_TARGET[target];
  if (!cfgFn) throw new Error(`ปลายทางฐานข้อมูลไม่รู้จัก: ${target}`);
  // ⚠ ต้องสร้าง config แยก object ต่อ pool — msnodesqlv8 mutate config (แชร์ object → pool ที่ 2 hang)
  const readerPool = new RuntimePool(cfgFn());
  const ownerPool  = new RuntimePool(cfgFn());
  // Handle pool-level errors so they don't become uncaught exceptions that corrupt process state
  readerPool.on('error', (e) => console.error(`[DB] readerPool (${target}) error:`, e.message));
  ownerPool.on('error',  (e) => console.error(`[DB] ownerPool (${target}) error:`, e.message));
  const ready = Promise.all([readerPool.connect(), ownerPool.connect()])
    .then(async () => {
      if (target === 'local_uat' || target === 'local_rehearsal') {
        await validateStartupTargetIdentity(readerPool, ownerPool, target);
      }
      if (target === 'onprem') await assertOnpremPools(readerPool, ownerPool);
      console.log(`✓ DB pools connected — ${target}`);
    })
    .catch(e => {
      console.error(`✗ DB ${target} connect failed:`, e.message);
      readerPool.close().catch(() => {});
      ownerPool.close().catch(() => {});
      throw e;
    });
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

async function closeAll() {
  const promises = [];
  let closedPools = 0;
  const closedTargets = [];
  for (const [target, entry] of Object.entries(registry)) {
    if (entry?.readerPool) {
      promises.push(entry.readerPool.close().catch(() => {}));
      closedPools++;
    }
    if (entry?.ownerPool) {
      promises.push(entry.ownerPool.close().catch(() => {}));
      closedPools++;
    }
    closedTargets.push(target);
    delete registry[target];
  }
  await Promise.all(promises);
  return { success: true, closedPools, closedTargets };
}

module.exports = {
  sql, query, dboWrite, wfQuery, wfTransaction, runWithTarget, getTarget, pools, closeAll,
  DEFAULT_TARGET,
  parseConnectionString,
  validateLocalConnectionString,
  CONFIG_BY_TARGET,
  // backward-compat: pool ของ default target (ใช้โดย scripts + /admin/migrate) — lazy loaded
  get readerPool() { return pools(DEFAULT_TARGET).readerPool; },
  get ownerPool() { return pools(DEFAULT_TARGET).ownerPool; },
  get readerReady() { return pools(DEFAULT_TARGET).ready; },
  get ownerReady() { return pools(DEFAULT_TARGET).ready; },
};

