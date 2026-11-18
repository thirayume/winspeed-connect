'use strict';

const { sqlRepository } = require('./database-identity-resolver');

function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
function positive(n) { return Number.isSafeInteger(n) && n > 0; }
function same(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }

// Review requires explicitly named accounts; neither equal IDs nor usernames
// constitute proof. The reviewer's confirmation is recorded on the identity
// database together with a before/after audit in one transaction.
async function saveReviewedBinding(input, dependencies) {
  const { db, isSwitchableDb, lockPolicy } = dependencies;
  const { primaryDatabase, targetDatabase, primaryUserId, targetUserId, reviewerId,
    primaryUsername, targetUsername, expectedRevision } = input;
  if (![primaryUserId, targetUserId, reviewerId].every(positive) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      !primaryUsername || !targetUsername || !isSwitchableDb(primaryDatabase) || !isSwitchableDb(targetDatabase) || same(primaryDatabase, targetDatabase)) fail('IDENTITY_REVIEW_INVALID', 400);
  const repo = sqlRepository(db, isSwitchableDb);
  const source = await repo.readUser(primaryDatabase, primaryUserId);
  const target = await repo.readUser(targetDatabase, targetUserId);
  if (!source || !target || Number(source.user.Id) !== primaryUserId || Number(target.user.Id) !== targetUserId || !same(source.database, primaryDatabase) || !same(target.database, targetDatabase) ||
      !source.server || !target.server || source.user.Username !== primaryUsername || target.user.Username !== targetUsername) fail('IDENTITY_REVIEW_STALE');
  return db.runWithTarget('onprem', () => db.wfTransaction(async tx => {
    await lockPolicy(tx, reviewerId, 'roles.manage');
    const query = async (text, params) => {
      const req = tx.request();
      for (const [name, value] of Object.entries(params || {})) req.input(name, value);
      return req.query(text);
    };
    const reviewer = await query(`SELECT u.Id FROM wf.AppUser u WITH (UPDLOCK,HOLDLOCK)
      WHERE u.Id=@reviewer AND u.IsActive=1 AND EXISTS
      (SELECT 1 FROM wf.vUserRole r WHERE r.UserId=u.Id AND r.RoleCode='ADMIN')`, { reviewer: reviewerId });
    if (!reviewer.recordset?.length) fail('IDENTITY_REVIEW_FORBIDDEN', 403);
    const liveSource = (await query(`SELECT CAST(SERVERPROPERTY('ServerName') AS NVARCHAR(128)) AS ServerName,
      DB_NAME() AS DatabaseName, Id, Username, EmpId, IsActive FROM wf.AppUser WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id`, { id: primaryUserId })).recordset?.[0];
    if (!liveSource || !same(liveSource.ServerName, source.server) || !same(liveSource.DatabaseName, primaryDatabase) ||
        liveSource.Username !== source.user.Username || String(liveSource.EmpId ?? '') !== String(source.user.EmpId ?? '') ||
        Boolean(liveSource.IsActive) !== Boolean(source.user.IsActive)) fail('IDENTITY_REVIEW_STALE');
    const found = (await query(`SELECT * FROM wf.DatabaseIdentityBinding WITH (UPDLOCK,HOLDLOCK)
      WHERE TargetServerName=@server AND TargetDatabaseName=@database AND (PrimaryUserId=@primary OR TargetUserId=@target)`,
    { server: target.server, database: target.database, primary: primaryUserId, target: targetUserId })).recordset || [];
    if (found.some(row => Number(row.PrimaryUserId) !== primaryUserId || Number(row.TargetUserId) !== targetUserId) || found.length > 1) fail('IDENTITY_REVIEW_CONFLICT');
    const before = found[0] || null;
    if ((before ? Number(before.Revision) : 0) !== expectedRevision) fail('IDENTITY_REVIEW_STALE');
    const params = { primary: primaryUserId, pServer: source.server, pDatabase: source.database,
      pUsername: source.user.Username, pEmp: source.user.EmpId ?? null, server: target.server, database: target.database,
      target: targetUserId, tUsername: target.user.Username, tEmp: target.user.EmpId ?? null, reviewer: reviewerId };
    let saved;
    if (!before) {
      saved = await query(`INSERT wf.DatabaseIdentityBinding
        (PrimaryUserId,PrimaryServerName,PrimaryDatabaseName,PrimaryUsername,PrimaryEmployeeId,TargetServerName,TargetDatabaseName,TargetUserId,TargetUsername,TargetEmployeeId,ReviewedBy)
        OUTPUT INSERTED.* VALUES (@primary,@pServer,@pDatabase,@pUsername,@pEmp,@server,@database,@target,@tUsername,@tEmp,@reviewer)`, params);
    } else {
      saved = await query(`UPDATE wf.DatabaseIdentityBinding SET PrimaryServerName=@pServer,PrimaryDatabaseName=@pDatabase,
        PrimaryUsername=@pUsername,PrimaryEmployeeId=@pEmp,TargetUsername=@tUsername,TargetEmployeeId=@tEmp,
        IsActive=1,Revision=Revision+1,ReviewedBy=@reviewer,ReviewedAt=GETUTCDATE()
        OUTPUT INSERTED.* WHERE Id=@id AND Revision=@revision`, { ...params, id: before.Id, revision: expectedRevision });
    }
    const after = saved.recordset?.[0];
    if (!after) fail('IDENTITY_REVIEW_STALE');
    // A different SQL Server cannot participate in this transaction. Re-read
    // the target before committing; the request resolver will check it again.
    const targetNow = await repo.readUser(targetDatabase, targetUserId);
    if (!targetNow || Number(targetNow.user.Id) !== targetUserId || !same(targetNow.server, target.server) || !same(targetNow.database, target.database) ||
        targetNow.user.Username !== target.user.Username || String(targetNow.user.EmpId ?? '') !== String(target.user.EmpId ?? '') ||
        Boolean(targetNow.user.IsActive) !== Boolean(target.user.IsActive)) fail('IDENTITY_REVIEW_STALE');
    await query(`INSERT wf.DatabaseIdentityBindingAudit (BindingId,ActorUserId,Action,BeforeSnapshot,AfterSnapshot)
      VALUES (@id,@actor,@action,@before,@after)`, { id: after.Id, actor: reviewerId,
      action: before ? 'UPDATE' : 'CREATE', before: before ? JSON.stringify(before) : null, after: JSON.stringify(after) });
    return { id: after.Id, revision: after.Revision, primaryUserId, targetUserId,
      targetActive: Boolean(target.user.IsActive) };
  }), primaryDatabase);
}

async function revokeReviewedBinding({ primaryDatabase, bindingId, reviewerId, expectedRevision }, dependencies) {
  const { db, isSwitchableDb, lockPolicy } = dependencies;
  if (!isSwitchableDb(primaryDatabase) || !positive(bindingId) || !positive(reviewerId) ||
      !positive(expectedRevision)) fail('IDENTITY_REVIEW_INVALID', 400);
  return db.runWithTarget('onprem', () => db.wfTransaction(async tx => {
    await lockPolicy(tx, reviewerId, 'roles.manage');
    const query = async (text, params) => {
      const req = tx.request();
      for (const [name, value] of Object.entries(params || {})) req.input(name, value);
      return req.query(text);
    };
    const reviewer = await query(`SELECT u.Id FROM wf.AppUser u WITH (UPDLOCK,HOLDLOCK)
      WHERE u.Id=@reviewer AND u.IsActive=1 AND EXISTS
      (SELECT 1 FROM wf.vUserRole r WHERE r.UserId=u.Id AND r.RoleCode='ADMIN')`, { reviewer: reviewerId });
    if (!reviewer.recordset?.length) fail('IDENTITY_REVIEW_FORBIDDEN', 403);
    const before = (await query('SELECT * FROM wf.DatabaseIdentityBinding WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id', { id: bindingId })).recordset?.[0];
    if (!before || Number(before.Revision) !== expectedRevision) fail('IDENTITY_REVIEW_STALE');
    if (!before.IsActive) return { id: bindingId, revision: expectedRevision, changed: false };
    const after = (await query(`UPDATE wf.DatabaseIdentityBinding SET IsActive=0,Revision=Revision+1,
      ReviewedBy=@reviewer,ReviewedAt=GETUTCDATE() OUTPUT INSERTED.* WHERE Id=@id AND Revision=@revision`,
    { id: bindingId, revision: expectedRevision, reviewer: reviewerId })).recordset?.[0];
    if (!after) fail('IDENTITY_REVIEW_STALE');
    await query(`INSERT wf.DatabaseIdentityBindingAudit (BindingId,ActorUserId,Action,BeforeSnapshot,AfterSnapshot)
      VALUES (@id,@actor,'REVOKE',@before,@after)`, { id: bindingId, actor: reviewerId,
      before: JSON.stringify(before), after: JSON.stringify(after) });
    return { id: bindingId, revision: after.Revision, changed: true };
  }), primaryDatabase);
}

module.exports = { saveReviewedBinding, revokeReviewedBinding };
