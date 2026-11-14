'use strict';

const { businessIds } = require('./business-identity');

// Dependencies are explicit so the transaction contract can be tested offline.
function createIncidentAcknowledger({ sql, wfQuery, wfTransaction, hasColumn, logChangeEvent }) {
  return async function acknowledgeIncident({ id, note, user, startUtc, ipAddress }) {
    const ids = businessIds(user);
    if (!ids.actor || !ids.effective) throw Object.assign(new Error('INCIDENT_AUDIT_IDENTITY_REQUIRED'), { status: 403 });
    if (user.isImpersonating && !await hasColumn(wfQuery, 'wf.ChangeEvent', 'ActorUserId')) {
      throw Object.assign(new Error('INCIDENT_ACTOR_AUDIT_UNAVAILABLE'), { status: 503 });
    }
    return wfTransaction(async tx => {
      const result = await tx.request()
        .input('id', sql.Int, id).input('by', sql.Int, ids.effective)
        .input('note', sql.NVarChar(500), note).input('globalStartUtc', sql.DateTime2, startUtc)
        .query(`UPDATE wf.RuleIncident SET Status = 'ACK', AckBy = @by, AckAt = SYSUTCDATETIME(), AckNote = @note
          WHERE Id = @id AND Status = 'OPEN' AND OccurredAt >= @globalStartUtc;
          SELECT @@ROWCOUNT AS Affected;`);
      if (!Number(result.recordset?.[0]?.Affected)) return false;
      await logChangeEvent(tx, { entityType: 'RULE_INCIDENT', entityId: String(id), action: 'ACK',
        beforeJson: { status: 'OPEN' }, afterJson: { status: 'ACK' }, reasonCode: 'INCIDENT_ACK',
        reasonText: note, userId: String(ids.effective), ipAddress });
      return true;
    });
  };
}

async function acknowledgeIncident(args) {
  const { sql, wfQuery, wfTransaction } = require('../db');
  return createIncidentAcknowledger({ sql, wfQuery, wfTransaction,
    hasColumn: require('./request-context').hasColumn,
    logChangeEvent: require('./policy-contract').logChangeEvent })(args);
}

module.exports = { acknowledgeIncident, createIncidentAcknowledger };
