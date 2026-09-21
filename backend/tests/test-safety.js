'use strict';
const assert = require('node:assert/strict');
const { query } = require('../db');

/**
 * Asserts that the currently active database connection is an isolated test database.
 * Throws immediately if connected to production, any non-test database, or if unsafe runtime flags are set.
 */
async function assertTestDatabase() {
  const res = await query(`
    SELECT 
      DB_NAME() AS dbName, 
      @@SERVERNAME AS serverName,
      SUSER_SNAME() AS loginName,
      IS_SRVROLEMEMBER('sysadmin') AS isSysadmin,
      HAS_DBACCESS('dbwins_worldfert9') AS prodAccess
  `);
  const dbName = String(res[0]?.dbName || '').toLowerCase();
  const serverName = String(res[0]?.serverName || '').toLowerCase();
  const loginName = String(res[0]?.loginName || '').toLowerCase();
  const isSysadmin = Number(res[0]?.isSysadmin || 0);
  const prodAccess = Number(res[0]?.prodAccess || 0);

  if (!dbName) {
    throw new Error('TEST SAFETY ERROR: Could not determine current DB_NAME()');
  }

  // 1. Refuse execution if connected to production DB name
  if (dbName === 'dbwins_worldfert9' || dbName.includes('prod')) {
    throw new Error(`CRITICAL TEST SAFETY VIOLATION: Refusing to run tests against production database "${dbName}"!`);
  }

  // 2. Must be the exact sanctioned test database: dbwins_worldfert9_test_v2
  if (dbName !== 'dbwins_worldfert9_test_v2') {
    throw new Error(`CRITICAL TEST SAFETY VIOLATION: Database name "${dbName}" is not the sanctioned test database "dbwins_worldfert9_test_v2"!`);
  }

  // 3. Server assertion: Reject if connected to production server or unknown server
  const prodServers = ['20.255.185.14'];
  if (prodServers.some(p => serverName.includes(p))) {
    throw new Error(`CRITICAL TEST SAFETY VIOLATION: Refusing to run tests against production server "${serverName}"!`);
  }

  const activeMode = (process.env.DB_MODE || '').toLowerCase().trim();
  if (activeMode === 'remote_b') {
    if (serverName !== '21181f44f254') {
      throw new Error(`CRITICAL TEST SAFETY VIOLATION: @@SERVERNAME "${serverName}" does not match sanctioned test server "21181f44f254"!`);
    }

    // 4. Principal assertion: Must NOT be sysadmin and must NOT have access to production DB
    if (isSysadmin === 1) {
      throw new Error(`CRITICAL TEST SAFETY VIOLATION: Test connection is running as sysadmin (${loginName})! Must use restricted test principal.`);
    }
    if (prodAccess === 1) {
      throw new Error(`CRITICAL TEST SAFETY VIOLATION: Test principal "${loginName}" has direct access to production database "dbwins_worldfert9"!`);
    }
  }

  // 5. Runtime posting flag must be strictly disabled
  const postingFlag = String(process.env.COUPON_NATIVE_POSTING_ENABLED || '').toLowerCase().trim();
  if (postingFlag !== 'false') {
    throw new Error(`CRITICAL TEST SAFETY VIOLATION: COUPON_NATIVE_POSTING_ENABLED="${postingFlag}" must be strictly "false"!`);
  }

  return { dbName, serverName, loginName, isSysadmin, prodAccess, postingFlag };
}

/**
 * Fatal hook to terminate process immediately if test safety checks fail.
 */
async function fatalTestGuard() {
  try {
    return await assertTestDatabase();
  } catch (err) {
    console.error('FATAL TEST SAFETY GUARD TRIGGERED:', err.message);
    process.exit(1);
  }
}

/**
 * Blocks any SQL write command referencing production database or foreign databases via 3-part naming.
 * e.g. "UPDATE dbwins_worldfert9.wf.ControlTicketOverlay ..."
 */
function assertNoCrossDbWrite(sqlText) {
  if (typeof sqlText !== 'string') return;
  const isWrite = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|MERGE)\b/i.test(sqlText);
  if (isWrite) {
    const targetsProd = /\b\[?dbwins_worldfert9\]?\b(?!\s*_\s*test)/i.test(sqlText);
    if (targetsProd) {
      throw new Error(`CRITICAL TEST SAFETY VIOLATION: Cross-database write targeting production "dbwins_worldfert9" blocked by test safety guard!`);
    }
  }
}

// Automatically install query interceptors on db pools when test-safety is loaded
const originalQuery = query;
const db = require('../db');
if (db.wfQuery && !db.wfQuery.__guarded) {
  const origWfQuery = db.wfQuery;
  db.wfQuery = function (text, inputs) {
    assertNoCrossDbWrite(text);
    return origWfQuery.apply(this, arguments);
  };
  db.wfQuery.__guarded = true;
}
if (db.dboWrite && !db.dboWrite.__guarded) {
  const origDboWrite = db.dboWrite;
  db.dboWrite = function (text, inputs) {
    assertNoCrossDbWrite(text);
    return origDboWrite.apply(this, arguments);
  };
  db.dboWrite.__guarded = true;
}
if (db.query && !db.query.__guarded) {
  const origQuery = db.query;
  db.query = function (text, inputs) {
    assertNoCrossDbWrite(text);
    return origQuery.apply(this, arguments);
  };
  db.query.__guarded = true;
}

module.exports = {
  assertTestDatabase,
  assertNoCrossDbWrite,
  fatalTestGuard,
};

