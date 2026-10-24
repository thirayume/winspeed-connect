'use strict';

/**
 * On-premise target (owner 2026-10-09): Sale-App runs in Docker on an Ubuntu VM at the factory and works directly in
 * the office SQL Server database that WINSpeed uses, over the LAN/VPN.
 *
 * The approved tuple lives in the server's .env, not in this public repository: the server, the database, the two
 * logins (app and migrator, made by docs/deploy/onprem/sql/office-logins.sql) and the engine version. Every connection is
 * checked against it before use, as for the local targets: the right server and database, the expected login, no
 * elevated server role, over TCP. Nothing falls back to another database and sa is refused.
 *
 * SQL Server 2008 R2 without its TLS 1.2 update only speaks TLS 1.0, which Node 22 (OpenSSL 3) refuses by default.
 * ONPREM_DB_LEGACY_TLS=true lowers the client floor for this one connection; it is meant for a route that stays
 * inside the LAN/VPN.
 */

const REQUIRED = ['ONPREM_DB_SERVER', 'ONPREM_DB_NAME', 'ONPREM_EXPECTED_SERVERNAME', 'ONPREM_PRODUCT_VERSION_PREFIX'];
const PRODUCTION_DB = 'dbwins_worldfert9';
// uat / production label the environment's primary database only. Database isolation between
// environments was lifted on 2026-10-25 at the owner's request: a signed-in user with a
// permitted role may switch their session to any database in the switchable allowlist and
// read and write there (see docs/deploy/r740/targets/*.env, ONPREM_SWITCHABLE_DATABASES).
const TARGET_KINDS = ['uat', 'production'];
// Only WINSpeed databases may ever be selected, by name shape, whatever the allowlist says.
const SWITCHABLE_NAME = /^dbwins_worldfert[0-9A-Za-z._-]*$/;

/** the databases this environment may connect to: the primary plus ONPREM_SWITCHABLE_DATABASES
 *  (a comma list, or "*" for every dbwins_worldfert* database the login can open at runtime). */
function switchableDatabases(env = process.env) {
  const primary = String(env.ONPREM_DB_NAME || '').trim();
  const raw = String(env.ONPREM_SWITCHABLE_DATABASES || '').trim();
  if (raw === '*') return { wildcard: true, list: primary ? [primary] : [] };
  const list = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (primary && !list.includes(primary)) list.unshift(primary);
  for (const name of list) {
    if (!SWITCHABLE_NAME.test(name)) throw new Error(`ONPREM_SWITCHABLE_DATABASES: "${name}" is not a dbwins_worldfert* database`);
  }
  return { wildcard: false, list };
}

/** is `name` a database this environment is allowed to connect to? */
function isSwitchableDb(name, env = process.env) {
  const candidate = String(name || '').trim();
  if (!SWITCHABLE_NAME.test(candidate)) return false;
  const { wildcard, list } = switchableDatabases(env);
  if (wildcard) return true;
  const lc = v => v.toLowerCase();
  return list.map(lc).includes(lc(candidate));
}

/** the same identity query as the local targets, read on every new pool before use */
const IDENTITY_SQL = `
  SELECT
    DB_NAME() AS dbName,
    @@SERVERNAME AS serverName,
    SUSER_SNAME() AS loginName,
    ORIGINAL_LOGIN() AS originalLogin,
    CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128)) AS productVersion,
    CAST(CONNECTIONPROPERTY('net_transport') AS NVARCHAR(40)) AS netTransport,
    IS_SRVROLEMEMBER('sysadmin') AS isSysadmin,
    IS_SRVROLEMEMBER('securityadmin') AS isSecurityadmin,
    IS_SRVROLEMEMBER('serveradmin') AS isServeradmin,
    IS_SRVROLEMEMBER('setupadmin') AS isSetupadmin,
    IS_SRVROLEMEMBER('processadmin') AS isProcessadmin,
    IS_SRVROLEMEMBER('diskadmin') AS isDiskadmin,
    IS_SRVROLEMEMBER('dbcreator') AS isDbcreator,
    IS_SRVROLEMEMBER('bulkadmin') AS isBulkadmin,
    HAS_DBACCESS('dbwins_worldfert9') AS hasProdAccess,
    (SELECT COUNT(*) FROM sys.databases WHERE database_id > 4 AND name <> DB_NAME() AND HAS_DBACCESS(name) = 1) AS otherUserDbCount,
    HAS_PERMS_BY_NAME(null, null, 'CONTROL SERVER') AS hasControlServer,
    IS_ROLEMEMBER('db_owner') AS isDbOwner,
    HAS_PERMS_BY_NAME(null, 'DATABASE', 'CONTROL') AS hasControlDatabase`;

const isMigratorOp = operation => operation === 'migration' || operation === 'migrator';

/** the approved tuple from .env for the app login (runtime) or the migrator login (migration).
 *  overrideDb switches the session to another database in the switchable allowlist; the migrator
 *  ignores it and always targets the primary, so migrations never run against a switched copy. */
function onpremTuple(env = process.env, operation = 'runtime', overrideDb = null) {
  const migrator = isMigratorOp(operation);
  const userKey = migrator ? 'ONPREM_MIGRATOR_USER' : 'ONPREM_DB_USER';
  const pwdKey = migrator ? 'ONPREM_MIGRATOR_PASSWORD' : 'ONPREM_DB_PASSWORD';
  const missing = [...REQUIRED, userKey].filter(k => !String(env[k] || '').trim());
  if (!env[pwdKey]) missing.push(pwdKey);
  if (missing.length) throw new Error(`DB_MODE=onprem: set ${missing.join(', ')} in .env`);

  const login = String(env[userKey]).trim();
  if (/^sa$/i.test(login)) {
    throw new Error('SECURITY_ERROR: onprem never connects as sa; use the logins made by docs/deploy/onprem/sql/office-logins.sql');
  }
  const port = env.ONPREM_DB_PORT ? Number(env.ONPREM_DB_PORT) : null;
  if (port !== null && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new Error(`ONPREM_DB_PORT "${env.ONPREM_DB_PORT}" is not a port`);
  const targetKind = String(env.ONPREM_TARGET_KIND || 'uat').trim().toLowerCase();
  if (!TARGET_KINDS.includes(targetKind)) throw new Error(`ONPREM_TARGET_KIND "${env.ONPREM_TARGET_KIND}" must be ${TARGET_KINDS.join(' or ')}`);
  let database = String(env.ONPREM_DB_NAME).trim();
  if (overrideDb && !migrator) {
    const wanted = String(overrideDb).trim();
    if (!isSwitchableDb(wanted, env)) throw new Error(`SECURITY_ERROR: database "${wanted}" is not in this environment's switchable allowlist`);
    database = wanted;
  }
  return {
    targetKind,
    server: String(env.ONPREM_DB_SERVER).trim(),
    port,
    instance: String(env.ONPREM_DB_INSTANCE || '').trim() || null,
    database,
    expectedServerName: String(env.ONPREM_EXPECTED_SERVERNAME).trim(),
    versionPrefix: String(env.ONPREM_PRODUCT_VERSION_PREFIX).trim(),
    login,
    password: env[pwdKey],
    encrypt: String(env.ONPREM_DB_ENCRYPT || 'true').toLowerCase() !== 'false',
    legacyTls: String(env.ONPREM_DB_LEGACY_TLS || '').toLowerCase() === 'true',
    tdsVersion: String(env.ONPREM_DB_TDS_VERSION || '7_3_B').trim(),
  };
}

/** mssql pool config: tedious on Linux (Docker), ODBC Driver 17 on Windows (testing from a workstation over VPN) */
function onpremConnectionConfig(env = process.env, operation = 'runtime', isWindows = false, overrideDb = null) {
  const t = onpremTuple(env, operation, overrideDb);
  const pool = { max: 10, min: 0, idleTimeoutMillis: 30000 };
  if (isWindows) {
    const server = `tcp:${t.server}${t.instance ? `\\${t.instance}` : ''}${t.port ? `,${t.port}` : ''}`;
    return {
      connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=${t.database};` +
        `Uid=${t.login};Pwd={${String(t.password).replace(/}/g, '}}')}};Encrypt=${t.encrypt ? 'yes' : 'no'};TrustServerCertificate=yes;`,
      pool,
    };
  }
  return {
    server: t.server,
    ...(t.port ? { port: t.port } : {}),
    user: t.login,
    password: t.password,
    database: t.database,
    requestTimeout: 30000,
    connectionTimeout: 15000,
    options: {
      // with a fixed port the instance name is not needed; without one SQL Browser (UDP 1434) resolves it
      ...(t.instance && !t.port ? { instanceName: t.instance } : {}),
      encrypt: t.encrypt,
      trustServerCertificate: true,
      enableArithAbort: true,
      tdsVersion: t.tdsVersion,
      ...(t.legacyTls ? { cryptoCredentialsDetails: { minVersion: 'TLSv1', ciphers: 'DEFAULT@SECLEVEL=0' } } : {}),
    },
    pool,
  };
}

function assertZero(row, field, label) {
  const v = row[field];
  if (v === null || v === undefined || v === '' || typeof v === 'boolean' || Number(v) !== 0) {
    throw new Error(`ONPREM SAFETY VIOLATION: ${label} must be 0 for the Sale-App logins (got ${v})`);
  }
}

/** fail closed unless the connection is the approved server, database and login, without elevated roles, over TCP */
function validateOnpremTargetRecord(row, env = process.env, { operation = 'runtime', overrideDb = null } = {}) {
  if (!row || typeof row !== 'object') throw new Error('ONPREM SAFETY VIOLATION: the identity query returned no row');
  const t = onpremTuple(env, operation, overrideDb);
  const lc = v => String(v || '').trim().toLowerCase();

  // The migrator always targets the primary; a runtime connection may be any allowed database.
  if (isMigratorOp(operation)) {
    if (lc(row.dbName) !== lc(t.database)) {
      throw new Error(`ONPREM SAFETY VIOLATION: migrator connected to database "${row.dbName}", approved "${t.database}"`);
    }
  } else if (lc(row.dbName) !== lc(t.database) || !isSwitchableDb(row.dbName, env)) {
    throw new Error(`ONPREM SAFETY VIOLATION: connected to database "${row.dbName}", which is not in the switchable allowlist`);
  }
  if (lc(row.serverName) !== lc(t.expectedServerName)) {
    throw new Error(`ONPREM SAFETY VIOLATION: @@SERVERNAME is "${row.serverName}", approved "${t.expectedServerName}"`);
  }
  if (!String(row.productVersion || '').startsWith(t.versionPrefix)) {
    throw new Error(`ONPREM SAFETY VIOLATION: engine ${row.productVersion} does not start with the approved "${t.versionPrefix}"`);
  }
  if (lc(row.loginName) !== lc(t.login) || lc(row.originalLogin) !== lc(t.login)) {
    throw new Error(`ONPREM SAFETY VIOLATION: login "${row.loginName}" (original "${row.originalLogin}"), approved "${t.login}"`);
  }
  assertZero(row, 'isSysadmin', "IS_SRVROLEMEMBER('sysadmin')");
  assertZero(row, 'isSecurityadmin', "IS_SRVROLEMEMBER('securityadmin')");
  assertZero(row, 'isServeradmin', "IS_SRVROLEMEMBER('serveradmin')");
  assertZero(row, 'isSetupadmin', "IS_SRVROLEMEMBER('setupadmin')");
  assertZero(row, 'processadmin' in row ? 'processadmin' : 'isProcessadmin', "IS_SRVROLEMEMBER('processadmin')");
  assertZero(row, 'diskadmin' in row ? 'diskadmin' : 'isDiskadmin', "IS_SRVROLEMEMBER('diskadmin')");
  assertZero(row, 'isDbcreator', "IS_SRVROLEMEMBER('dbcreator')");
  assertZero(row, 'bulkadmin' in row ? 'bulkadmin' : 'isBulkadmin', "IS_SRVROLEMEMBER('bulkadmin')");
  // The production environment's primary database is still pinned, so a production deploy cannot
  // be aimed at a copy. Cross-database isolation is intentionally not enforced: database switching
  // (owner 2026-10-25) lets a session open any allowed dbwins_worldfert* database.
  if (t.targetKind === 'production' && lc(String(env.ONPREM_DB_NAME).trim()) !== PRODUCTION_DB) {
    throw new Error(`ONPREM SAFETY VIOLATION: ONPREM_TARGET_KIND=production requires ONPREM_DB_NAME=${PRODUCTION_DB}`);
  }
  assertZero(row, 'hasControlServer', 'CONTROL SERVER');
  assertZero(row, 'dbOwner' in row ? 'dbOwner' : 'isDbOwner', "IS_ROLEMEMBER('db_owner')");
  assertZero(row, 'hasControlDatabase', 'CONTROL DATABASE');
  if (lc(row.netTransport) !== 'tcp') {
    throw new Error(`ONPREM SAFETY VIOLATION: transport "${row.netTransport}", expected TCP`);
  }
  // the app does not post coupon redemptions (116) into WINSpeed at go-live (go-live checklist A4)
  if (String(env.COUPON_NATIVE_POSTING_ENABLED || 'false').trim().toLowerCase() !== 'false') {
    throw new Error('ONPREM SAFETY VIOLATION: COUPON_NATIVE_POSTING_ENABLED must stay false on the office database');
  }
  return { database: row.dbName, serverName: row.serverName, login: row.loginName, productVersion: row.productVersion };
}

/** checks both pools of the target before the app (or the migration runner) uses them */
async function assertOnpremPools(readerPool, ownerPool, env = process.env, overrideDb = null) {
  const operation = env.DB_OPERATION === 'migration' ? 'migration' : 'runtime';
  for (const pool of [readerPool, ownerPool]) {
    const row = (await pool.request().query(IDENTITY_SQL)).recordset?.[0];
    validateOnpremTargetRecord(row, env, { operation, overrideDb });
  }
}

module.exports = {
  IDENTITY_SQL, onpremTuple, onpremConnectionConfig, validateOnpremTargetRecord, assertOnpremPools,
  switchableDatabases, isSwitchableDb,
};
