'use strict';

// Execute only in the primary identity database. The caller chooses that
// context; identity IDs are never translated to a business database ID.
async function writeProfileChange({ user, action, statement, parameters, onRollbackConfirmed }) {
  const { sql, wfTransaction } = require('../db');
  const effective = Number(user?.sub ?? user?.id);
  const actor = Number(user?.actorSub ?? user?.actorId ?? effective);
  if (!Number.isSafeInteger(effective) || effective <= 0 || !Number.isSafeInteger(actor) || actor <= 0)
    throw Object.assign(Error('PROFILE_IDENTITY_INVALID'), { status: 403 });
  return wfTransaction(async tx => {
    const update = tx.request();
    for (const [name, input] of Object.entries(parameters)) update.input(name, input.type, input.value);
    const result = await update.query(statement);
    if (Number(result.rowsAffected?.[0]) !== 1)
      throw Object.assign(Error('PROFILE_STALE_OR_MISSING'), { status: 409 });
    // Never store field values, password/hash, signature contents or file path.
    const audit = await tx.request().input('actor', sql.Int, actor)
      .input('action', sql.VarChar(40), action)
      .input('target', sql.NVarChar(100), String(effective))
      .input('detail', sql.NVarChar(sql.MAX), JSON.stringify({ effectiveUserId: effective }))
      .query('INSERT INTO wf.AdminChangeAudit (ActorId, Action, Target, Detail) VALUES (@actor, @action, @target, @detail)');
    if (Number(audit.rowsAffected?.[0]) !== 1) throw Error('PROFILE_AUDIT_FAILED');
  }, { onRollbackConfirmed });
}
module.exports = { writeProfileChange };
