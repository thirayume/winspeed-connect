'use strict';

/**
 * test-safety-guard.test.js
 *
 * DB-free Unit Tests for test-safety.js target validation & fail-closed permission guard.
 * Addresses Item A in Codex Candidate V2.4 review:
 * - Exact approved target tuple (server/database/login)
 * - Raw permissions must be literal known-zero; rejects NULL/undefined/NaN/elevated
 * - Reject unallowlisted/unexpected login
 * - Server check enforced unconditionally without DB_MODE bypass
 * - Cross-DB write protection
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  APPROVED_TARGET,
  validateTargetRecord,
  assertTargetWithQuery,
  assertNoCrossDbWrite,
} = require('./safety-validator');

const VALID_ROW = {
  dbName: 'dbwins_worldfert9_test_v2',
  serverName: '21181f44f254',
  loginName: 'wf_test',
  isSysadmin: 0,
  prodAccess: 0,
};

const SAFE_ENV = {
  COUPON_NATIVE_POSTING_ENABLED: 'false',
  ALLOW_TEST_NATIVE_WRITEBACK: 'false',
};

test('Safety Guard (DB-free): Valid sanctioned target tuple passes cleanly', () => {
  const result = validateTargetRecord(VALID_ROW, SAFE_ENV);
  assert.equal(result.dbName, APPROVED_TARGET.dbName);
  assert.equal(result.serverName, APPROVED_TARGET.serverName);
  assert.equal(result.loginName, APPROVED_TARGET.loginName);
  assert.equal(result.isSysadmin, 0);
  assert.equal(result.prodAccess, 0);
  assert.equal(result.postingFlag, 'false');
  assert.equal(result.allowTestWriteback, false);
});

test('Safety Guard (DB-free): Rejects null or empty query record', () => {
  assert.throws(
    () => validateTargetRecord(null, SAFE_ENV),
    /Target query returned no record/
  );
  assert.throws(
    () => validateTargetRecord({}, SAFE_ENV),
    /Could not determine current DB_NAME/
  );
});

test('Safety Guard (DB-free): Database name validation', () => {
  // Reject production DB
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, dbName: 'dbwins_worldfert9' }, SAFE_ENV),
    /Refusing to run tests against production database/
  );
  // Reject any db containing prod
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, dbName: 'my_prod_db' }, SAFE_ENV),
    /Refusing to run tests against production database/
  );
  // Reject arbitrary non-test DB
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, dbName: 'dbwins_worldfert9_other' }, SAFE_ENV),
    /not the sanctioned test database "dbwins_worldfert9_test_v2"/
  );
});

test('Safety Guard (DB-free): Server name validation (unconditional)', () => {
  // Reject production server IP
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, serverName: '20.255.185.14' }, SAFE_ENV),
    /Refusing to run tests against production server/
  );
  // Reject mismatched server
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, serverName: 'unknown_host' }, SAFE_ENV),
    /does not match sanctioned test server "21181f44f254"/
  );
});

test('Safety Guard (DB-free): Login principal allowlist', () => {
  // Reject unexpected login
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, loginName: 'unexpected_user' }, SAFE_ENV),
    /does not match sanctioned test principal "wf_test"/
  );
  // Reject sa
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, loginName: 'sa' }, SAFE_ENV),
    /does not match sanctioned test principal "wf_test"/
  );
  // Reject empty login
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, loginName: '' }, SAFE_ENV),
    /Could not determine current SUSER_SNAME/
  );
});

test('Safety Guard (DB-free): Fail-closed on isSysadmin (NULL, undefined, elevated)', () => {
  // NULL isSysadmin must NOT be treated as 0
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, isSysadmin: null }, SAFE_ENV),
    /IS_SRVROLEMEMBER\('sysadmin'\) returned NULL or undefined/
  );
  // undefined isSysadmin must NOT be treated as 0
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, isSysadmin: undefined }, SAFE_ENV),
    /IS_SRVROLEMEMBER\('sysadmin'\) returned NULL or undefined/
  );
  // Elevated sysadmin (1) must be rejected
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, isSysadmin: 1 }, SAFE_ENV),
    /elevated sysadmin role/
  );
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, isSysadmin: '1' }, SAFE_ENV),
    /elevated sysadmin role/
  );
});

test('Safety Guard (DB-free): Fail-closed on prodAccess (NULL, undefined, direct access)', () => {
  // NULL prodAccess must NOT be treated as 0
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, prodAccess: null }, SAFE_ENV),
    /HAS_DBACCESS\('dbwins_worldfert9'\) returned NULL or undefined/
  );
  // undefined prodAccess must NOT be treated as 0
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, prodAccess: undefined }, SAFE_ENV),
    /HAS_DBACCESS\('dbwins_worldfert9'\) returned NULL or undefined/
  );
  // Direct prod access (1) must be rejected
  assert.throws(
    () => validateTargetRecord({ ...VALID_ROW, prodAccess: 1 }, SAFE_ENV),
    /has direct access to production database "dbwins_worldfert9"/
  );
});

test('Safety Guard (DB-free): Runtime posting flag consistency', () => {
  // Flag true without allowTestWriteback -> throws
  assert.throws(
    () => validateTargetRecord(VALID_ROW, { COUPON_NATIVE_POSTING_ENABLED: 'true', ALLOW_TEST_NATIVE_WRITEBACK: 'false' }),
    /COUPON_NATIVE_POSTING_ENABLED=true requires explicit ALLOW_TEST_NATIVE_WRITEBACK=true/
  );
  // Flag true with allowTestWriteback -> passes
  const validWriteback = validateTargetRecord(VALID_ROW, { COUPON_NATIVE_POSTING_ENABLED: 'true', ALLOW_TEST_NATIVE_WRITEBACK: 'true' });
  assert.equal(validWriteback.postingFlag, 'true');
  assert.equal(validWriteback.allowTestWriteback, true);

  // Invalid flag value -> throws
  assert.throws(
    () => validateTargetRecord(VALID_ROW, { COUPON_NATIVE_POSTING_ENABLED: 'enabled' }),
    /Invalid COUPON_NATIVE_POSTING_ENABLED/
  );
});

test('Safety Guard (DB-free): assertTargetWithQuery with mock queryFn', async () => {
  // Successful queryFn
  const mockQuerySuccess = async () => [VALID_ROW];
  const validated = await assertTargetWithQuery(mockQuerySuccess);
  assert.equal(validated.dbName, APPROVED_TARGET.dbName);

  // Unsafe queryFn returning elevated permission
  const mockQueryUnsafe = async () => [{ ...VALID_ROW, isSysadmin: 1 }];
  await assert.rejects(
    async () => assertTargetWithQuery(mockQueryUnsafe),
    /elevated sysadmin role/
  );
});

test('Safety Guard (DB-free): assertNoCrossDbWrite blocks cross-db writes targeting production', () => {
  // Block write targeting production 3-part naming
  assert.throws(
    () => assertNoCrossDbWrite('UPDATE dbwins_worldfert9.wf.ControlTicketOverlay SET ExpireDate = GETDATE()'),
    /Cross-database write targeting production "dbwins_worldfert9" blocked/
  );
  assert.throws(
    () => assertNoCrossDbWrite('INSERT INTO [dbwins_worldfert9].[dbo].[GLHD] VALUES (1)'),
    /Cross-database write targeting production "dbwins_worldfert9" blocked/
  );

  // Allow writes to test database
  assert.doesNotThrow(
    () => assertNoCrossDbWrite('UPDATE dbwins_worldfert9_test_v2.wf.ControlTicketOverlay SET ExpireDate = GETDATE()')
  );
  assert.doesNotThrow(
    () => assertNoCrossDbWrite('SELECT * FROM dbwins_worldfert9.dbo.GLHD') // Read-only query allowed
  );
});
