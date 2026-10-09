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
  isSysadmin: 0, isSecurityadmin: 0, isServeradmin: 0, isDbcreator: 0, hasControlServer: 0,
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

test('anything else is refused', () => {
  const refuse = (patch, re, env = ENV, operation) => assert.throws(() => validateOnpremTargetRecord({ ...ROW, ...patch }, env, { operation }), re);
  refuse({ dbName: 'dbwins_worldfert9' }, /connected to database/);
  refuse({ serverName: 'OTHER\\SQL' }, /@@SERVERNAME/);
  refuse({ productVersion: '16.0.1000.6' }, /engine/);
  refuse({ loginName: 'wf_migrator', originalLogin: 'wf_migrator' }, /login/);
  refuse({ originalLogin: 'sa' }, /login/);
  refuse({ isSysadmin: 1 }, /sysadmin/);
  refuse({ isDbcreator: null }, /dbcreator/);
  refuse({ hasControlServer: 1 }, /CONTROL SERVER/);
  refuse({ netTransport: 'Shared memory' }, /transport/);
  refuse({}, /COUPON_NATIVE_POSTING_ENABLED/, { ...ENV, COUPON_NATIVE_POSTING_ENABLED: 'true' });
  refuse({}, /login/, ENV, 'migration');
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
    const pool = row => ({ request: () => ({ query: async () => ({ recordset: [row] }) }) });
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
  const s = fs.readFileSync(path.join(__dirname, '../../deploy/onprem/sql/office-logins.sql'), 'utf8');
  assert.match(s, /GRANT SELECT ON SCHEMA::dbo TO \[\$\(APP_LOGIN\)\]/);
  assert.match(s, /GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, REFERENCES ON SCHEMA::wf TO \[\$\(APP_LOGIN\)\]/);
  assert.match(s, /GRANT CONTROL ON SCHEMA::wf TO \[\$\(MIGRATOR_LOGIN\)\]/);
  assert.match(s, /CREATE SCHEMA wf AUTHORIZATION dbo/);
  assert.doesNotMatch(s, /sp_addrolemember|sp_addsrvrolemember|ALTER (SERVER )?ROLE|AppvFlag/i);
  assert.doesNotMatch(s, /PASSWORD = N'[^$]/, 'passwords only come from sqlcmd variables');
});
