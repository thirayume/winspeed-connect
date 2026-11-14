'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const dbPath = require.resolve('../db');
const activePath = require.resolve('../services/active-database');
let mode = 'missing';
const type = () => ({});
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  sql: { Int: type, NVarChar: type },
  getTarget: () => 'onprem',
  getDbName: () => 'business',
  runWithTarget: (_target, fn) => fn(),
  wfQuery: async text => {
    if (text.includes('OBJECT_ID')) return { recordset: [{ ObjectId: mode === 'missing' ? null : 1 }] };
    throw new Error('SQL driver secret=customer-password');
  },
} };
require.cache[activePath] = { id: activePath, filename: activePath, loaded: true,
  exports: { primaryDatabase: () => 'primary' } };
const audit = require('../middleware/apiAudit')();

async function runAudit() {
  const response = new EventEmitter();
  response.statusCode = 200;
  const req = { user: { sub: 8 }, originalUrl: '/api/example?secret=do-not-log',
    method: 'POST', ip: '127.0.0.1', get: () => 'test-agent' };
  audit(req, response, () => {});
  response.emit('finish');
  await new Promise(resolve => setImmediate(resolve));
}

test('production reports missing audit table and write failures without sensitive data', async () => {
  const originalError = console.error;
  const previousEnv = process.env.NODE_ENV;
  const messages = [];
  console.error = (...args) => messages.push(args.join(' '));
  process.env.NODE_ENV = 'production';
  try {
    mode = 'missing';
    await runAudit();
    mode = 'write-fails';
    await runAudit();
    assert.deepEqual(messages, [
      '[api-audit] AUDIT_TABLE_UNAVAILABLE',
      '[api-audit] AUDIT_WRITE_FAILED',
    ]);
    assert.doesNotMatch(messages.join('\n'), /password|secret|customer|do-not-log/i);
  } finally {
    console.error = originalError;
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});
