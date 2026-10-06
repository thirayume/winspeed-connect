'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SESSION_SQL, withNativeSessionSettings } = require('../services/native-session-pool');
test('initializes every physical native connection before return', async () => {
  const seen = [];
  class FakePool {
    async _poolCreate() {
      return { query: (text, cb) => { seen.push(text); setImmediate(cb); } };
    }
  }
  const pool = new (withNativeSessionSettings(FakePool))();
  await Promise.all([pool._poolCreate(), pool._poolCreate()]);
  assert.deepEqual(seen, [SESSION_SQL, SESSION_SQL]);
  for (const name of ['ANSI_NULLS', 'QUOTED_IDENTIFIER', 'ANSI_PADDING', 'ANSI_WARNINGS', 'CONCAT_NULL_YIELDS_NULL', 'ARITHABORT']) {
    assert.ok(SESSION_SQL.includes('SET ' + name + ' ON'));
  }
  assert.ok(SESSION_SQL.includes('SET NUMERIC_ROUNDABORT OFF'));
});
test('initialization failure destroys connection and preserves original error', async () => {
  const error = new Error('initialization failed');
  const connection = { query: (_, cb) => cb(error) };
  let destroyed;
  class FakePool {
    async _poolCreate() { return connection; }
    async _poolDestroy(value) { destroyed = value; throw Error('close failure'); }
  }
  await assert.rejects(new (withNativeSessionSettings(FakePool))()._poolCreate(), value => value === error);
  assert.equal(destroyed, connection);
});
test('connect failure propagates', async () => {
  class FakePool { async _poolCreate() { throw Error('connect rejected'); } }
  await assert.rejects(new (withNativeSessionSettings(FakePool))()._poolCreate(), /connect rejected/);
});
