'use strict';

/**
 * Owner 2026-10-09: Sale-App on an Ubuntu VM works in the office SQL Server database that WINSpeed uses. The target
 * is approved in the server's .env (server, database, logins, engine) and checked on every pool, never sa, TCP only.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { onpremTuple, onpremConnectionConfig, validateOnpremTargetRecord } = require('../onprem-target');

const ENV = {
  ONPREM_DB_SERVER: '10.0.0.10', ONPREM_DB_PORT: '1433', ONPREM_DB_NAME: 'dbwins_worldfert9_test',
  ONPREM_EXPECTED_SERVERNAME: 'OFFICE-SQL\\SQL2008', ONPREM_PRODUCT_VERSION_PREFIX: '10.50.',
  ONPREM_DB_USER: 'wf_app', ONPREM_DB_PASSWORD: 'app-secret}x', ONPREM_MIGRATOR_USER: 'wf_migrator', ONPREM_MIGRATOR_PASSWORD: 'mig-secret',
};
const ROW = {
  dbName: 'dbwins_worldfert9_test', serverName: 'OFFICE-SQL\\SQL2008', loginName: 'wf_app', originalLogin: 'wf_app',
  productVersion: '10.50.6000.34', netTransport: 'TCP',
  isSysadmin: 0, isSecurityadmin: 0, isServeradmin: 0, isSetupadmin: 0, isProcessadmin: 0, isDiskadmin: 0,
  isDbcreator: 0, isBulkadmin: 0, hasProdAccess: 0, otherUserDbCount: 0, hasControlServer: 0, isDbOwner: 0, hasControlDatabase: 0,
};

test('every part of the approved tuple is required, and sa is refused', () => {
  assert.throws(() => onpremTuple({ ...ENV, ONPREM_EXPECTED_SERVERNAME: '' }), /ONPREM_EXPECTED_SERVERNAME/);
  assert.throws(() => onpremTuple({ ...ENV, ONPREM_DB_PASSWORD: '' }), /ONPREM_DB_PASSWORD/);
  assert.throws(() => onpremTuple({ ...ENV, ONPREM_DB_USER: 'SA' }), /never connects as sa/);
  assert.throws(() => onpremTuple({ ...ENV, ONPREM_DB_PORT: '99999' }), /not a port/);
  assert.equal(onpremTuple(ENV).login, 'wf_app');
  assert.equal(onpremTuple(ENV, 'migration').login, 'wf_migrator', 'migrations run as the migrator login');
});

test('Linux (tedious): TDS 7.3 for SQL 2008 R2, and the TLS floor is lowered only when asked', () => {
  const plain = onpremConnectionConfig(ENV, 'runtime', false);
  assert.equal(plain.server, '10.0.0.10');
  assert.equal(plain.port, 1433);
  assert.equal(plain.options.tdsVersion, '7_3_B');
  assert.equal(plain.options.encrypt, true);
  assert.equal(plain.options.cryptoCredentialsDetails, undefined);
  assert.equal(plain.options.instanceName, undefined);

  const legacy = onpremConnectionConfig({ ...ENV, ONPREM_DB_LEGACY_TLS: 'true' }, 'runtime', false);
  assert.deepEqual(legacy.options.cryptoCredentialsDetails, { minVersion: 'TLSv1', ciphers: 'DEFAULT@SECLEVEL=0' });

  const named = onpremConnectionConfig({ ...ENV, ONPREM_DB_PORT: '', ONPREM_DB_INSTANCE: 'SQL2008' }, 'runtime', false);
  assert.equal(named.options.instanceName, 'SQL2008', 'without a fixed port the instance is resolved by name');
  assert.equal(named.port, undefined);
});

test('Windows (ODBC 17): TCP with the password escaped', () => {
  const cfg = onpremConnectionConfig(ENV, 'runtime', true);
  assert.match(cfg.connectionString, /Server=tcp:10\.0\.0\.10,1433;Database=dbwins_worldfert9_test;Uid=wf_app;Pwd=\{app-secret}}x\};/);
});

test('the approved server, database, login and engine pass', () => {
  assert.equal(validateOnpremTargetRecord(ROW, ENV).login, 'wf_app');
  assert.equal(validateOnpremTargetRecord({ ...ROW, loginName: 'wf_migrator', originalLogin: 'wf_migrator' }, ENV, { operation: 'migration' }).login, 'wf_migrator');
});

test('anything else is refused (elevated server roles, db_owner, control database, and null/unknown)', () => {
  const refuse = (patch, re, env = ENV, operation) => assert.throws(() => validateOnpremTargetRecord({ ...ROW, ...patch }, env, { operation }), re);
  refuse({ dbName: 'dbwins_worldfert9' }, /connected to database/);
  refuse({ serverName: 'OTHER\\SQL' }, /@@SERVERNAME/);
  refuse({ productVersion: '16.0.1000.6' }, /engine/);
  refuse({ loginName: 'wf_migrator', originalLogin: 'wf_migrator' }, /login/);
  refuse({ originalLogin: 'sa' }, /login/);
  refuse({ isSysadmin: 1 }, /sysadmin/);
  refuse({ isSecurityadmin: 1 }, /securityadmin/);
  refuse({ isServeradmin: 1 }, /serveradmin/);
  refuse({ isSetupadmin: 1 }, /setupadmin/);
  refuse({ isProcessadmin: 1 }, /processadmin/);
  refuse({ isDiskadmin: 1 }, /diskadmin/);
  refuse({ isDbcreator: null }, /dbcreator/);
  refuse({ isBulkadmin: 1 }, /bulkadmin/);
  refuse({ isBulkadmin: null }, /bulkadmin/);
  refuse({ hasControlServer: 1 }, /CONTROL SERVER/);
  refuse({ isDbOwner: 1 }, /db_owner/);
  refuse({ isDbOwner: null }, /db_owner/);
  refuse({ hasControlDatabase: 1 }, /CONTROL DATABASE/);
  refuse({ hasControlDatabase: null }, /CONTROL DATABASE/);
  refuse({ netTransport: 'Shared memory' }, /transport/);
  refuse({}, /COUPON_NATIVE_POSTING_ENABLED/, { ...ENV, COUPON_NATIVE_POSTING_ENABLED: 'true' });
  refuse({}, /login/, ENV, 'migration');
});

test('production profile still pins its primary database, without cross-database isolation', () => {
  const PROD_ENV = { ...ENV, ONPREM_DB_NAME: 'dbwins_worldfert9', ONPREM_TARGET_KIND: 'production' };
  const PROD_ROW = { ...ROW, dbName: 'dbwins_worldfert9' };
  assert.equal(validateOnpremTargetRecord(PROD_ROW, PROD_ENV).database, 'dbwins_worldfert9');
  assert.equal(validateOnpremTargetRecord({ ...PROD_ROW, loginName: 'wf_migrator', originalLogin: 'wf_migrator' }, PROD_ENV, { operation: 'migration' }).login, 'wf_migrator');
  const refuse = (patch, re, env = PROD_ENV) => assert.throws(() => validateOnpremTargetRecord({ ...PROD_ROW, ...patch }, env), re);
  refuse({ isDbOwner: 1 }, /db_owner/);
  refuse({ isSysadmin: 1 }, /sysadmin/);
  refuse({ netTransport: 'Shared memory' }, /transport/);
  // Multi-database access no longer fails the guard (owner 2026-10-25): otherUserDbCount is informational.
  assert.equal(validateOnpremTargetRecord({ ...PROD_ROW, otherUserDbCount: 3, hasProdAccess: 1 }, PROD_ENV).database, 'dbwins_worldfert9');
  // The production kind cannot point at a copy.
  assert.throws(() => validateOnpremTargetRecord(ROW, { ...ENV, ONPREM_TARGET_KIND: 'production' }), /requires ONPREM_DB_NAME/);
  assert.throws(() => onpremTuple({ ...ENV, ONPREM_TARGET_KIND: 'prod' }), /ONPREM_TARGET_KIND/);
  assert.equal(onpremTuple(ENV).targetKind, 'uat', 'unset means the uat profile');
});

test('switchable allowlist: explicit list, wildcard, and the dbwins_worldfert* name shape', () => {
  const { switchableDatabases, isSwitchableDb } = require('../onprem-target');
  const LIST_ENV = { ...ENV, ONPREM_SWITCHABLE_DATABASES: 'dbwins_worldfert9, dbwins_worldfert2' };
  const WILD_ENV = { ...ENV, ONPREM_SWITCHABLE_DATABASES: '*' };
  // The primary is always allowed; the explicit list adds the others.
  assert.deepEqual(switchableDatabases(LIST_ENV).list, ['dbwins_worldfert9_test', 'dbwins_worldfert9', 'dbwins_worldfert2']);
  assert.ok(isSwitchableDb('dbwins_worldfert2', LIST_ENV));
  assert.ok(!isSwitchableDb('dbwins_worldfert5', LIST_ENV), 'not listed');
  assert.ok(!isSwitchableDb('master', LIST_ENV), 'not a dbwins_worldfert name');
  assert.ok(!isSwitchableDb('dbwins_other', LIST_ENV));
  // Wildcard allows any dbwins_worldfert* name, but never another database.
  assert.ok(isSwitchableDb('dbwins_worldfert2', WILD_ENV));
  assert.ok(isSwitchableDb('dbwins_worldfert9-uat', WILD_ENV));
  assert.ok(!isSwitchableDb('tempdb', WILD_ENV));
  assert.ok(!isSwitchableDb("dbwins_worldfert9'; DROP", WILD_ENV), 'rejects an injection-shaped name');
  assert.equal(switchableDatabases(ENV).list.length, 1, 'unset means only the primary (no switching)');
  assert.throws(() => switchableDatabases({ ...ENV, ONPREM_SWITCHABLE_DATABASES: 'master,dbwins_worldfert9' }), /not a dbwins_worldfert/);
});

test('a switched session connects to an allowed database; an unlisted one is refused', () => {
  const LIST_ENV = { ...ENV, ONPREM_SWITCHABLE_DATABASES: 'dbwins_worldfert9, dbwins_worldfert2' };
  // The runtime tuple takes the override; the connection config carries it.
  assert.equal(onpremTuple(LIST_ENV, 'runtime', 'dbwins_worldfert2').database, 'dbwins_worldfert2');
  assert.equal(onpremConnectionConfig(LIST_ENV, 'runtime', false, 'dbwins_worldfert2').database, 'dbwins_worldfert2');
  // The migrator ignores the override and always targets the primary.
  assert.equal(onpremTuple(LIST_ENV, 'migration', 'dbwins_worldfert2').database, 'dbwins_worldfert9_test');
  // An override outside the allowlist is refused before any connection is made.
  assert.throws(() => onpremTuple(LIST_ENV, 'runtime', 'dbwins_worldfert5'), /not in this environment's switchable allowlist/);
  assert.throws(() => onpremTuple(LIST_ENV, 'runtime', 'master'), /not in this environment's switchable allowlist/);
  // The guard accepts a connection whose database is the switched (allowed) one.
  assert.equal(validateOnpremTargetRecord({ ...ROW, dbName: 'dbwins_worldfert2' }, LIST_ENV, { overrideDb: 'dbwins_worldfert2' }).database, 'dbwins_worldfert2');
  // ...but refuses one whose actual database is not allowed, even if asked for an allowed one.
  assert.throws(() => validateOnpremTargetRecord({ ...ROW, dbName: 'dbwins_worldfert5' }, LIST_ENV, { overrideDb: 'dbwins_worldfert2' }), /not in the switchable allowlist/);
});

test('the identity query reports access to other user databases', () => {
  const { IDENTITY_SQL } = require('../onprem-target');
  assert.match(IDENTITY_SQL, /database_id > 4 AND name <> DB_NAME\(\) AND HAS_DBACCESS\(name\) = 1\) AS otherUserDbCount/);
});

test('onprem is a known target, and its migration profile is SQL 2008 without migration 074', () => {
  assert.ok(require('../db-target-policy').VALID_TARGETS.includes('onprem'));
  const prof = require('../migration-policy.json').targetProfiles.onprem;
  assert.equal(prof.dialect, 'sql2008');
  assert.deepEqual(prof.excludedFiles, ['074_fix_winspeed_legacy_raiserror.sql']);
  assert.deepEqual(prof.allowedTransports, ['TCP']);
  assert.equal(prof.serverName, undefined, 'the office server name stays out of this public repository');
});

test('the migration runner checks the office target with the migrator login', async () => {
  const { verifyTargetAndProfile } = require('../run_migrations');
  const saved = { ...process.env };
  Object.assign(process.env, ENV);
  try {
    // Model SQL projection: a field absent from SELECT must not be invented by
    // the stub, otherwise missing privilege checks in the runner go unnoticed.
    const pool = row => ({ request: () => ({ query: async text => {
      const aliases = new Set([...text.matchAll(/\bAS\s+(\w+)/gi)].map(match => match[1]));
      return { recordset: [Object.fromEntries(Object.entries(row).filter(([key]) => aliases.has(key)))] };
    } }) });
    const ok = await verifyTargetAndProfile(pool({ ...ROW, loginName: 'wf_migrator', originalLogin: 'wf_migrator' }), 'onprem');
    assert.equal(ok.profile, 'onprem');
    await assert.rejects(verifyTargetAndProfile(pool({ ...ROW, loginName: 'wf_migrator', originalLogin: 'wf_migrator', serverName: 'X' }), 'onprem'), /@@SERVERNAME/);
    await assert.rejects(verifyTargetAndProfile(pool(ROW), 'onprem'), /login/, 'the app login cannot run migrations');
  } finally {
    for (const k of Object.keys(ENV)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('the office login script grants what the app ran with through UAT, and no server role', () => {
  const scriptPath = ['../../docs/deploy/onprem/sql/office-logins.sql', '../../deploy/onprem/sql/office-logins.sql']
    .map(relative => path.join(__dirname, relative)).find(candidate => fs.existsSync(candidate));
  assert.ok(scriptPath, 'reviewed office login script must exist');
  const s = fs.readFileSync(scriptPath, 'utf8');
  assert.match(s, /GRANT SELECT ON SCHEMA::dbo TO \[\$\(APP_LOGIN\)\]/);
  assert.match(s, /GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, REFERENCES ON SCHEMA::wf TO \[\$\(APP_LOGIN\)\]/);
  assert.match(s, /GRANT CONTROL ON SCHEMA::wf TO \[\$\(MIGRATOR_LOGIN\)\]/);
  assert.match(s, /CREATE SCHEMA wf AUTHORIZATION dbo/);
  assert.doesNotMatch(s, /sp_addrolemember|sp_addsrvrolemember|ALTER (SERVER )?ROLE|AppvFlag/i);
  assert.doesNotMatch(s, /PASSWORD = N'[^$]/, 'passwords only come from sqlcmd variables');
});

test('DB_DRIVER=tedious runs the Linux driver on Windows, to rehearse the server path on a workstation', () => {
  const { execFileSync } = require('child_process');
  // dotenv may print a notice on stdout, so the answer is marked
  const probe = "const db = require('./db'); process.stdout.write(' TEDIOUS=' + (db.sql === require('mssql')))";
  const run = env => (execFileSync(process.execPath, ['-e', probe], { cwd: path.join(__dirname, '..'), env: { ...process.env, DB_MODE: 'onprem', ...env } })
    .toString().match(/TEDIOUS=(true|false)/) || [])[1];
  assert.equal(run({ DB_DRIVER: 'tedious' }), 'true');
  if (process.platform === 'win32') assert.equal(run({ DB_DRIVER: '' }), 'false', 'the native Windows driver otherwise');
});
