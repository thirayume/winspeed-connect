'use strict';

const { businessIds, actorPerspective } = require('./business-identity');

// Dependencies are explicit so the transaction contract can be tested offline.
function createIncidentAcknowledger({ sql, wfQuery, wfTransaction, hasColumn, logChangeEvent, getVisibleScope, scopeFilter, currentActorId }) {
  return async function acknowledgeIncident({ id, note, user, startUtc, ipAddress }) {
    const ids = businessIds(user);
    if (!ids.actor || !ids.effective) throw Object.assign(new Error('INCIDENT_AUDIT_IDENTITY_REQUIRED'), { status: 403 });
    if (ids.actor !== ids.effective && (currentActorId() !== ids.actor || !await hasColumn(wfQuery, 'wf.ChangeEvent', 'ActorUserId'))) {
      throw Object.assign(new Error('INCIDENT_ACTOR_AUDIT_UNAVAILABLE'), { status: 503 });
    }
    return wfTransaction(async tx => {
      const txQuery = async (statement, inputs = {}) => {
        const request = tx.request();
        for (const [key, { type, value }] of Object.entries(inputs)) request.input(key, type, value);
        return request.query(statement);
      };
      const effective = await getVisibleScope(user, txQuery);
      const actor = actorPerspective(user);
      const actorScope = actor === user ? effective : await getVisibleScope(actor, txQuery);
      const filterOptions = { userCol: 'e.SalesUserId', empCol: 'h.EmpID' };
      const visible = scopeFilter(effective, { ...filterOptions, prefix: 'incidentEffective' });
      const actorVisible = scopeFilter(actorScope, { ...filterOptions, prefix: 'incidentActor' });
      const request = tx.request()
        .input('id', sql.Int, id).input('by', sql.Int, ids.effective)
        .input('note', sql.NVarChar(500), note).input('globalStartUtc', sql.DateTime2, startUtc);
      for (const [key, { type, value }] of Object.entries({ ...visible.inputs, ...actorVisible.inputs })) request.input(key, type, value);
      const result = await request.query(`UPDATE i SET Status = 'ACK', AckBy = @by, AckAt = SYSUTCDATETIME(), AckNote = @note
          FROM wf.RuleIncident i
          LEFT JOIN dbo.SOHD h ON h.SOID = i.SOID
          LEFT JOIN wf.SalesOrderExt e ON e.SOID = CONVERT(VARCHAR(50), i.SOID)
          WHERE i.Id = @id AND i.Status = 'OPEN' AND i.OccurredAt >= @globalStartUtc
            AND (i.SOID IS NULL OR (${visible.sql} AND ${actorVisible.sql}));
          SELECT @@ROWCOUNT AS Affected;`);
      if (!Number(result.recordset?.[0]?.Affected)) return false;
      await logChangeEvent(tx, { entityType: 'RULE_INCIDENT', entityId: String(id), action: 'ACK',
        beforeJson: { status: 'OPEN' }, afterJson: { status: 'ACK' }, reasonCode: 'INCIDENT_ACK',
        reasonText: note, userId: String(ids.effective), ipAddress });
      return true;
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
  };
}

async function acknowledgeIncident(args) {
  const { sql, wfQuery, wfTransaction } = require('../db');
  return createIncidentAcknowledger({ sql, wfQuery, wfTransaction,
    hasColumn: require('./request-context').hasColumn,
    currentActorId: require('./request-context').currentActorId,
    logChangeEvent: require('./policy-contract').logChangeEvent,
    ...require('./visible-scope') })(args);
}

module.exports = { acknowledgeIncident, createIncidentAcknowledger };
