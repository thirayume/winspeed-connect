'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sampleLocks, SAMPLE_SQL } = require('../scripts/measure-uat-locks.cjs');
const valid = { DbName: 'dbwins_worldfert9_uat', ServerName: 'R740-SRV\\SQL2008', CanView: 1 };

test('refuses an unexpected target or insufficient visibility before sampling', async () => {
  for (const identity of [{ ...valid, DbName: 'dbwins_worldfert9' }, { ...valid, CanView: 0 }]) {
    let calls = 0;
    await assert.rejects(sampleLocks({ seconds: 10, delay: async () => {}, query: async () => { calls++; return { recordset: [identity] }; } }));
    assert.equal(calls, 1);
  }
});
test('reports aggregated lock waits without querying text or writing data', async () => {
  let calls = 0;
  const result = await sampleLocks({ seconds: 10, delay: async () => {}, query: async () => {
    calls++;
    return { recordset: [calls === 1 ? valid : { Blocked: calls === 2 ? 1 : 0, LockWaits: 1, MaxBlockedWaitMs: 250 }] };
  }});
  assert.deepEqual(result, { samples: 2, sampleIntervalMs: 5000, blockedSamples: 1, maxBlocked: 1, maxLockWaits: 1, maxWaitMs: 250 });
  assert.doesNotMatch(SAMPLE_SQL, /\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
  assert.doesNotMatch(SAMPLE_SQL, /sql_text|input_buffer/i);
});
