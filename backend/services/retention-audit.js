'use strict';
const { businessIds } = require('./business-identity');

function createRetentionService({ sql, wfQuery, wfTransaction, hasColumn, logChangeEvent }) {
  async function identity(user) {
    const ids = businessIds(user);
    if (!ids.actor || !ids.effective) throw Object.assign(Error('RETENTION_AUDIT_IDENTITY_REQUIRED'), { status: 403 });
    if (user.isImpersonating && !await hasColumn(wfQuery, 'wf.ChangeEvent', 'ActorUserId'))
      throw Object.assign(Error('RETENTION_ACTOR_AUDIT_UNAVAILABLE'), { status: 503 });
    return ids;
  }
  async function updateRetentionPolicy({ id, retentionDays, note, user, ipAddress }) {
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(retentionDays) || retentionDays < 0 || retentionDays > 365000)
      throw Object.assign(Error('Invalid retention policy'), { status: 400 });
    const ids = await identity(user);
    return wfTransaction(async tx => {
      const existing = (await tx.request().input('id', sql.Int, id).query(
        'SELECT Id, DataClass, RetentionDays, Note FROM wf.RetentionPolicy WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id')).recordset?.[0];
      if (!existing) return false;
      await tx.request().input('id', sql.Int, id).input('days', sql.Int, retentionDays).input('note', sql.NVarChar(300), note)
        .query('UPDATE wf.RetentionPolicy SET RetentionDays=@days, Note=@note, UpdatedAt=GETUTCDATE() WHERE Id=@id');
      await logChangeEvent(tx, { entityType: 'RETENTION_POLICY', entityId: String(id), action: 'UPDATE',
        beforeJson: { dataClass: existing.DataClass, retentionDays: existing.RetentionDays, note: existing.Note },
        afterJson: { dataClass: existing.DataClass, retentionDays, note }, userId: String(ids.effective), ipAddress });
      return true;
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
  }
  async function runRetention({ user, ipAddress }) {
    const ids = await identity(user);
    return wfTransaction(async tx => {
      const policies = (await tx.request().query('SELECT DataClass, RetentionDays FROM wf.RetentionPolicy WITH (UPDLOCK,HOLDLOCK)')).recordset || [];
      const result = {};
      for (const [dataClass, table, condition, resultKey] of [
        ['ERROR_LOG', 'wf.ErrorLog', 'OccurredAt', 'errorLogDeleted'],
        ['OUTBOX_DONE', 'wf.OutboxEvent', "ProcessedAt", 'outboxDeleted'],
      ]) {
        const raw = policies.find(p => p.DataClass === dataClass)?.RetentionDays;
        if (raw == null || Number(raw) === 0) continue;
        const days = Number(raw);
        if (!Number.isSafeInteger(days) || days < 0 || days > 365000) throw Object.assign(Error('Invalid stored retention policy'), { status: 409 });
        const prefix = dataClass === 'OUTBOX_DONE' ? "Status='DONE' AND " : '';
        const deletion = await tx.request().input('days', sql.Int, days).query(`DELETE FROM ${table} WHERE ${prefix}${condition} < DATEADD(day, -@days, GETUTCDATE())`);
        result[resultKey] = deletion.rowsAffected?.[0] ?? 0;
      }
      await logChangeEvent(tx, { entityType: 'RETENTION_RUN', entityId: 'CURRENT', action: 'RUN',
        afterJson: { result }, userId: String(ids.effective), ipAddress });
      return result;
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
  }
  async function recordDsarExport({ subjectType, subjectId, user, ipAddress }) {
    const ids = await identity(user);
    return wfTransaction(async tx => {
      await tx.request().input('type', sql.NVarChar(20), subjectType).input('subject', sql.NVarChar(40), String(subjectId))
        .input('user', sql.Int, ids.effective)
        .query("INSERT INTO wf.DsarLog (SubjectType, SubjectId, Action, RequestedBy, Note) VALUES (@type,@subject,'EXPORT',@user,N'DSAR export')");
      await logChangeEvent(tx, { entityType: 'DSAR_EXPORT', entityId: `${subjectType}:${subjectId}`,
        action: 'EXPORT', afterJson: { subjectType }, userId: String(ids.effective), ipAddress });
    });
  }
  return { updateRetentionPolicy, runRetention, recordDsarExport };
}
function instance() {
  const { sql, wfQuery, wfTransaction } = require('../db');
  return createRetentionService({ sql, wfQuery, wfTransaction, hasColumn: require('./request-context').hasColumn,
    logChangeEvent: require('./policy-contract').logChangeEvent });
}
module.exports = { createRetentionService, updateRetentionPolicy: args => instance().updateRetentionPolicy(args),
  runRetention: args => instance().runRetention(args), recordDsarExport: args => instance().recordDsarExport(args) };
