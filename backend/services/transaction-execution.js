'use strict';

// SQL Server error numbers that mean "someone else holds the lock": lock wait timed out,
// or this transaction was chosen as the deadlock victim. Both are safe to retry.
const LOCK_CONFLICTS = new Set([1222, 1205]);

function lockConflictNumber(error) {
  for (const e of [error, error?.originalError, error?.originalError?.info, ...(error?.precedingErrors || [])]) {
    if (e && LOCK_CONFLICTS.has(Number(e.number))) return Number(e.number);
  }
  return null;
}

async function setLockTimeout(tx, ms) {
  // A parameterless query may execute under sp_executesql, whose SET scope ends
  // when the RPC returns. A batch applies the setting to the pinned session.
  await tx.request().batch(`SET LOCK_TIMEOUT ${Number(ms)}`);
}

/**
 * Runs fn inside the already begun transaction, commits, and rolls back on any error.
 *
 * options.lockTimeoutMs (positive integer): the transaction gives up a lock wait after
 * that long instead of waiting without limit while it holds its own locks. Serializable
 * transactions use it to bound each lock wait. It does not bound total transaction time
 * or how long previously acquired locks are held. A lock timeout or deadlock then surfaces
 * as HTTP 409 with a retry message.
 */
async function runTransaction(tx, fn, onRollbackConfirmed, options = {}) {
  const lockTimeoutMs = Number.isSafeInteger(options.lockTimeoutMs) && options.lockTimeoutMs > 0 ? options.lockTimeoutMs : null;
  let commitStarted=false;
  let timeoutSet=false;
  // node-mssql releases a driver-aborted transaction's connection before our
  // catch handler can issue a reset. Its supported pool drivers validate this
  // marker on the next acquire and discard the session rather than reuse it.
  const connection = lockTimeoutMs ? tx._acquiredConnection : null;
  const invalidate = () => { if (connection) connection.hasError = true; };
  const onAutoRollback = aborted => { if (aborted && timeoutSet) invalidate(); };
  if (connection && typeof tx.on === 'function') tx.on('rollback', onAutoRollback);
  try {
    // If the driver reports a failure after the server applied SET, still
    // attempt to restore the session before returning it to the pool.
    if (lockTimeoutMs) { timeoutSet=true; await setLockTimeout(tx, lockTimeoutMs); }
    const result=await fn(tx);
    if (timeoutSet) { await setLockTimeout(tx, -1); timeoutSet=false; }
    commitStarted=true;
    await tx.commit();
    return result;
  } catch(error) {
    // If a reset cannot be confirmed, prevent the possibly tainted connection
    // from being reused with this transaction's session setting.
    if (timeoutSet && !commitStarted) { try { await setLockTimeout(tx, -1); } catch (_) { invalidate(); } }
    let rolledBack=false;
    try { await tx.rollback(); rolledBack=true; } catch (_) {}
    if (!commitStarted && rolledBack && typeof onRollbackConfirmed==='function') {
      try { await onRollbackConfirmed(); } catch (_) { console.error('[transaction] ROLLBACK_CLEANUP_FAILED'); }
    }
    const conflict = lockTimeoutMs && !commitStarted ? lockConflictNumber(error) : null;
    if (conflict) {
      throw Object.assign(new Error('มีผู้ใช้อื่นกำลังทำรายการเดียวกันอยู่ กรุณาลองใหม่อีกครั้ง'),
        { status: 409, code: conflict === 1205 ? 'DEADLOCK_RETRY' : 'LOCK_TIMEOUT', number: conflict, originalError: error });
    }
    throw error;
  } finally {
    if (connection && typeof tx.removeListener === 'function') tx.removeListener('rollback', onAutoRollback);
  }
}
module.exports={runTransaction, lockConflictNumber};
