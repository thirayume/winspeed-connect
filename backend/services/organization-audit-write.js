'use strict';
const { businessIds } = require('./business-identity');

async function writeOrganizationChange({ statement, parameters, user, action, target, detail, expected }) {
  const { sql, wfTransaction } = require('../db');
  const ids = businessIds(user);
  if (!ids.actor || !ids.effective || ids.actor !== ids.effective || user.isImpersonating)
    throw Object.assign(Error('ORG_AUDIT_IDENTITY_INVALID'), { status: 403 });
  return wfTransaction(async tx => {
    const lock = (await tx.request().query("DECLARE @result int; EXEC @result=sp_getapplock @Resource='WF_ORG_STRUCTURE',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult")).recordset?.[0];
    if (lock?.LockResult == null || !Number.isInteger(Number(lock.LockResult)) || Number(lock.LockResult) < 0)
      throw Object.assign(Error('ORG_STRUCTURE_BUSY'), { status: 409 });
    // The graph is re-read under transaction locks, after acquiring the common
    // app lock. Every org-position mutation in this candidate uses this path.
    const rows = (await tx.request().query('SELECT * FROM wf.OrgPosition WITH (UPDLOCK,HOLDLOCK)')).recordset || [];
    const key = value => String(value || '').trim().toUpperCase();
    const current = rows.find(row => key(row.PositionCode) === key(target));
    if (action === 'POSITION_CREATE' && current) throw Object.assign(Error('ORG_POSITION_CHANGED'), { status: 409 });
    if (expected) {
      const fields = ['PositionName', 'ReportsTo', 'OrgUnit', 'Tier', 'DefaultRole', 'CanApprove', 'IsActive', 'Note','RecordScope'];
      if (!current || fields.some(k => String(current[k] ?? '') !== String(expected[k] ?? '')))
        throw Object.assign(Error('ORG_POSITION_CHANGED'), { status: 409 });
    }
    if (action === 'POSITION_CREATE' || action === 'POSITION_UPDATE') {
      let parent = key(parameters.reportsTo?.value);
      const visited = new Set([key(target)]);
      while (parent) {
        if (visited.has(parent)) throw Object.assign(Error('ORG_CYCLE'), { status: 409 });
        visited.add(parent);
        const node = rows.find(row => key(row.PositionCode) === parent);
        if (!node) throw Object.assign(Error('ORG_PARENT_CHANGED'), { status: 409 });
        parent = key(node.ReportsTo);
      }
    }
    if (action === 'POSITION_DELETE') {
      const assigned = (await tx.request().input('code', sql.VarChar(30), target)
        .query('SELECT COUNT(*) AS c FROM wf.AppUser WITH (UPDLOCK,HOLDLOCK) WHERE PositionCode=@code')).recordset?.[0];
      if (Number(assigned?.c || 0) > 0 || rows.some(row => key(row.ReportsTo) === key(target)))
        throw Object.assign(Error('ORG_POSITION_IN_USE'), { status: 409 });
    }
    const request = tx.request();
    for (const [name, input] of Object.entries(parameters)) request.input(name, input.type, input.value);
    const changed = await request.query(statement);
    if (Number(changed.rowsAffected?.[0]) !== 1)
      throw Object.assign(Error('ORG_POSITION_CHANGED'), { status: 409 });
    await tx.request().input('actor', sql.Int, ids.actor).input('action', sql.VarChar(40), action)
      .input('target', sql.NVarChar(100), target).input('detail', sql.NVarChar(sql.MAX), JSON.stringify(detail))
      .query('INSERT INTO wf.AdminChangeAudit (ActorId, Action, Target, Detail) VALUES (@actor, @action, @target, @detail)');
  }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
}
module.exports = { writeOrganizationChange };
