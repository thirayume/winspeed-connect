'use strict';
const assert = require('node:assert/strict');
const { query } = require('../db');

/**
 * Asserts that the currently active database connection is an isolated test database.
 * Throws immediately if connected to production, any non-test database, or if unsafe runtime flags are set.
 */
async function assertTestDatabase() {
  const res = await query(`SELECT DB_NAME() AS dbName, @@SERVERNAME AS serverName`);
  const dbName = String(res[0]?.dbName || '').toLowerCase();
  const serverName = String(res[0]?.serverName || '').toLowerCase();

  if (!dbName) {
    throw new Error('TEST SAFETY ERROR: Could not determine current DB_NAME()');
  }

  // 1. Refuse execution if connected to production
  if (dbName === 'dbwins_worldfert9' || dbName.includes('prod')) {
    throw new Error(`CRITICAL TEST SAFETY VIOLATION: Refusing to run tests against production database "${dbName}"!`);
  }

  // 2. Must be the exact sanctioned test database: dbwins_worldfert9_test_v2
  if (dbName !== 'dbwins_worldfert9_test_v2') {
    throw new Error(`CRITICAL TEST SAFETY VIOLATION: Database name "${dbName}" is not the sanctioned test database "dbwins_worldfert9_test_v2"!`);
  }

  // 3. Runtime posting flag must be strictly disabled
  const postingFlag = String(process.env.COUPON_NATIVE_POSTING_ENABLED || '').toLowerCase().trim();
  if (postingFlag !== 'false') {
    throw new Error(`CRITICAL TEST SAFETY VIOLATION: COUPON_NATIVE_POSTING_ENABLED="${postingFlag}" must be strictly "false"!`);
  }

  return { dbName, serverName, postingFlag };
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

module.exports = {
  assertTestDatabase,
  fatalTestGuard,
};

