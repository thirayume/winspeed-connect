'use strict';
const assert = require('node:assert/strict');
const { query } = require('../db');

const { APPROVED_TARGET, validateTargetRecord, assertNoCrossDbWrite, assertTargetWithQuery } = require('./safety-validator');

/**
 * Asserts that the currently active database connection is an isolated test database.
 * Throws immediately if connected to production, any non-test database, or if unsafe runtime flags are set.
 */
async function assertTestDatabase(customQueryFn = null) {
  return assertTargetWithQuery(customQueryFn || query);
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



// Automatically install query interceptors on db pools when test-safety is loaded
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
  APPROVED_TARGET,
  validateTargetRecord,
  assertTestDatabase,
  assertNoCrossDbWrite,
  fatalTestGuard,
};
