'use strict';
const assert = require('node:assert/strict');
const { query } = require('../db');

/**
 * Asserts that the currently active database connection is an isolated test database.
 * Throws immediately if connected to production or any database without a test marker.
 */
async function assertTestDatabase() {
  const res = await query(`SELECT DB_NAME() AS dbName, @@SERVERNAME AS serverName`);
  const dbName = String(res[0]?.dbName || '').toLowerCase();
  const serverName = String(res[0]?.serverName || '').toLowerCase();

  if (!dbName) {
    throw new Error('TEST SAFETY ERROR: Could not determine current DB_NAME()');
  }

  // Refuse execution if connected to production
  if (dbName === 'dbwins_worldfert9' || dbName.includes('prod')) {
    throw new Error(`CRITICAL TEST SAFETY VIOLATION: Refusing to run tests against production database "${dbName}"!`);
  }

  // Must contain test or dev marker
  if (!dbName.includes('test') && !dbName.includes('dev')) {
    throw new Error(`CRITICAL TEST SAFETY VIOLATION: Database name "${dbName}" does not contain a test/dev marker!`);
  }

  return { dbName, serverName };
}

module.exports = {
  assertTestDatabase,
};
