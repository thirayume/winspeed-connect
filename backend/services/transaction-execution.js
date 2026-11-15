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
  // Session setting, so it is put back to "wait" before the connection returns to the pool.
  await tx.request().query(`SET LOCK_TIMEOUT ${Number(ms)}`);
}

/**
 * Runs fn inside the already begun transaction, commits, and rolls back on any error.
 *
 * options.lockTimeoutMs (positive integer): the transaction gives up a lock wait after
 * that long instead of waiting without limit while it holds its own locks. Serializable
 * transactions use it so they cannot keep rows of the shared WinSpeed database locked for
 * longer than a bounded time. A lock timeout or deadlock then surfaces as HTTP 409 with a
 * retry message.
 */
async function runTransaction(tx, fn, onRollbackConfirmed, options = {}) {
  const lockTimeoutMs = Number.isSafeInteger(options.lockTimeoutMs) && options.lockTimeoutMs > 0 ? options.lockTimeoutMs : null;
  let commitStarted=false;
  let timeoutSet=false;
  try {
    if (lockTimeoutMs) { await setLockTimeout(tx, lockTimeoutMs); timeoutSet=true; }
    const result=await fn(tx);
    if (timeoutSet) { await setLockTimeout(tx, -1); timeoutSet=false; }
    commitStarted=true;
    await tx.commit();
    return result;
  } catch(error) {
    // Best effort: if the server already ended the transaction this cannot run, and the
    // pooled connection keeps the bounded wait, which only makes later waits fail sooner.
    if (timeoutSet && !commitStarted) { try { await setLockTimeout(tx, -1); } catch (_) {} }
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
  }
}
module.exports={runTransaction, lockConflictNumber};
