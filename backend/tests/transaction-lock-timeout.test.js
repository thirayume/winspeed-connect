'use strict';
// Serializable transactions run with a bounded lock wait. The wait is set at the start,
// put back before the connection returns to the pool, and a lock timeout or deadlock
// comes back as a 409 the user can retry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runTransaction, lockConflictNumber } = require('../services/transaction-execution');

function fakeTx({ failOn = null } = {}) {
  const log = [];
  return { log,
    request: () => ({
      query: async text => { assert.doesNotMatch(text, /^SET LOCK_TIMEOUT/); log.push(text); return { recordset: [] }; },
      batch: async text => { assert.match(text, /^SET LOCK_TIMEOUT/); log.push(text); if (failOn && failOn.test(text)) throw new Error('request refused'); return { recordset: [] }; }
    }),
    commit: async () => { log.push('COMMIT'); }, rollback: async () => { log.push('ROLLBACK'); } };
}
const sqlError = number => Object.assign(new Error(`sql ${number}`), { number, code: 'EREQUEST' });

test('the lock wait is set first and put back before commit', async () => {
  const tx = fakeTx();
  const result = await runTransaction(tx, async t => { await t.request().query('WORK'); return 7; }, null, { lockTimeoutMs: 10000 });
  assert.equal(result, 7);
  assert.deepEqual(tx.log, ['SET LOCK_TIMEOUT 10000', 'WORK', 'SET LOCK_TIMEOUT -1', 'COMMIT']);
});

test('without the option nothing changes for ordinary transactions', async () => {
  const tx = fakeTx();
  await runTransaction(tx, async t => { await t.request().query('WORK'); });
  assert.deepEqual(tx.log, ['WORK', 'COMMIT']);
  for (const bad of [0, -5, 1.5, '10', null]) { const t = fakeTx(); await runTransaction(t, async () => {}, null, { lockTimeoutMs: bad }); assert.deepEqual(t.log, ['COMMIT']); }
});

test('a lock timeout or a deadlock becomes a retryable 409 and the wait is put back before rollback', async () => {
  for (const [number, code] of [[1222, 'LOCK_TIMEOUT'], [1205, 'DEADLOCK_RETRY']]) {
    const tx = fakeTx();
    await assert.rejects(() => runTransaction(tx, async () => { throw sqlError(number); }, null, { lockTimeoutMs: 5000 }),
      e => e.status === 409 && e.code === code && e.number === number && e.originalError.number === number);
    assert.deepEqual(tx.log, ['SET LOCK_TIMEOUT 5000', 'SET LOCK_TIMEOUT -1', 'ROLLBACK']);
  }
  const nested = Object.assign(new Error('wrapped'), { originalError: { info: { number: 1222 } } });
  assert.equal(lockConflictNumber(nested), 1222);
  assert.equal(lockConflictNumber(Object.assign(new Error('x'), { precedingErrors: [{ number: 1205 }] })), 1205);
});

test('other errors pass through unchanged, and lock errors are not rewritten for ordinary transactions', async () => {
  const boom = Object.assign(new Error('constraint'), { number: 2627 });
  await assert.rejects(() => runTransaction(fakeTx(), async () => { throw boom; }, null, { lockTimeoutMs: 5000 }), e => e === boom);
  const lock = sqlError(1222);
  await assert.rejects(() => runTransaction(fakeTx(), async () => { throw lock; }), e => e === lock);
});

test('if the server already ended the transaction the rollback still runs and the cleanup rule is kept', async () => {
  const tx = fakeTx({ failOn: /LOCK_TIMEOUT -1/ });
  let cleaned = 0;
  await assert.rejects(() => runTransaction(tx, async () => { throw sqlError(1205); }, async () => { cleaned++; }, { lockTimeoutMs: 5000 }), e => e.status === 409);
  assert.deepEqual(tx.log, ['SET LOCK_TIMEOUT 5000', 'SET LOCK_TIMEOUT -1', 'ROLLBACK']);
  assert.equal(cleaned, 1);
});

test('a failed initial SET still attempts to restore the session and rolls back', async () => {
  const tx = fakeTx({ failOn: /LOCK_TIMEOUT 10000/ });
  await assert.rejects(() => runTransaction(tx, async () => { throw Error('must not run'); }, null, { lockTimeoutMs: 10000 }), /request refused/);
  assert.deepEqual(tx.log, ['SET LOCK_TIMEOUT 10000', 'SET LOCK_TIMEOUT -1', 'ROLLBACK']);
});

test('driver auto-abort invalidates the pinned session before it can be reused', async () => {
  const { EventEmitter } = require('node:events');
  const tx = Object.assign(new EventEmitter(), fakeTx(), { _acquiredConnection: {} });
  await assert.rejects(() => runTransaction(tx, async () => { tx.emit('rollback', true); throw sqlError(1205); }, null, { lockTimeoutMs: 10000 }), { code: 'DEADLOCK_RETRY' });
  assert.equal(tx._acquiredConnection.hasError, true);
  assert.equal(tx.listenerCount('rollback'), 0);
});

test('failure to restore the timeout invalidates the pinned session', async () => {
  const tx = Object.assign(fakeTx({ failOn: /LOCK_TIMEOUT -1/ }), { _acquiredConnection: {} });
  await assert.rejects(() => runTransaction(tx, async () => { throw sqlError(1222); }, null, { lockTimeoutMs: 10000 }), { code: 'LOCK_TIMEOUT' });
  assert.equal(tx._acquiredConnection.hasError, true);
});

test('db.wfTransaction asks for the bounded wait only when an isolation level is given', () => {
  const source = fs.readFileSync(path.join(__dirname, '../db.js'), 'utf8');
  const body = source.slice(source.indexOf('async function wfTransaction('), source.indexOf('async function wfTransaction(') + 1400);
  assert.match(body, /isolationLevel == null \? null/);
  assert.match(body, /WF_SERIALIZABLE_LOCK_TIMEOUT_MS/);
  assert.match(body, /runTransaction\(tx, fn, onRollbackConfirmed, \{ lockTimeoutMs \}\)/);
});
