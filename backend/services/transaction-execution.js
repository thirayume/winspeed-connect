'use strict';
async function runTransaction(tx, fn, onRollbackConfirmed) {
  let commitStarted=false;
  try {
    const result=await fn(tx);
    commitStarted=true;
    await tx.commit();
    return result;
  } catch(error) {
    let rolledBack=false;
    try { await tx.rollback(); rolledBack=true; } catch (_) {}
    if (!commitStarted && rolledBack && typeof onRollbackConfirmed==='function') {
      try { await onRollbackConfirmed(); } catch (_) { console.error('[transaction] ROLLBACK_CLEANUP_FAILED'); }
    }
    throw error;
  }
}
module.exports={runTransaction};
