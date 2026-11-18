'use strict';
const { businessIds } = require('./business-identity');

// Database delete and audit commit together; in-memory counters are updated
// only after commit, keeping entries recorded while the transaction ran.
function createErrorClearer({ state, wfQuery, wfTransaction, hasColumn, logChangeEvent }) {
  return async function clearErrors(user, ipAddress) {
    const ids = businessIds(user);
    if (!ids.actor || !ids.effective) throw Object.assign(Error('ERROR_CLEAR_IDENTITY_REQUIRED'), { status: 403 });
    if (user.isImpersonating && !await hasColumn(wfQuery, 'wf.ChangeEvent', 'ActorUserId'))
      throw Object.assign(Error('ERROR_CLEAR_ACTOR_AUDIT_UNAVAILABLE'), { status: 503 });
    const oldErrors = state.errors;
    const oldEntries = new Set(state.recentErrors);
    const oldStatuses = { ...state.byStatus };
    const oldLastErrorAt = state.lastErrorAt;
    const deleted = await wfTransaction(async tx => {
      const r = await tx.request().query('DELETE FROM wf.ErrorLog');
      const count = r.rowsAffected?.[0] ?? 0;
      await logChangeEvent(tx, { entityType: 'ERROR_LOG', entityId: 'ALL', action: 'CLEAR',
        afterJson: { deleted: count }, userId: String(ids.effective), ipAddress });
      return count;
    });
    state.errors = Math.max(0, state.errors - oldErrors);
    state.recentErrors = state.recentErrors.filter(entry => !oldEntries.has(entry));
    for (const [key, count] of Object.entries(oldStatuses)) {
      const remaining = Math.max(0, (state.byStatus[key] || 0) - count);
      if (remaining) state.byStatus[key] = remaining; else delete state.byStatus[key];
    }
    if (!state.recentErrors.length && state.lastErrorAt === oldLastErrorAt) state.lastErrorAt = null;
    return { ok: true, deleted, message: 'ล้าง Error Log ที่มีอยู่ขณะทำรายการแล้ว' };
  };
}
module.exports = { createErrorClearer };
