'use strict';

const { validateReviewedBinding } = require('./database-identity-binding');

function invalid() {
  throw Object.assign(new Error('IDENTITY_BINDING_INVALID'), { code: 'IDENTITY_BINDING_INVALID', status: 409 });
}

// Reads both live user records and the reviewed binding. This does not grant
// access: callers must still check role policy, map every business ID and audit.
// No result is cached: disabling an account or changing a snapshot must be
// observed on the next request, including for both parties of Access As.
async function resolveReviewedIdentity({ primaryUserId, primaryDatabase, targetDatabase }, repository) {
  if (!Number.isSafeInteger(primaryUserId) || primaryUserId <= 0 || !primaryDatabase || !targetDatabase) invalid();
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const first = await repository.readPrimary(primaryDatabase, targetDatabase, primaryUserId);
  if (!first?.binding || !first.primary || Number(first.primary.Id) !== primaryUserId || !first.server || !same(first.database, primaryDatabase)) invalid();
  if (!Number.isSafeInteger(Number(first.binding.TargetUserId)) || Number(first.binding.TargetUserId) <= 0) invalid();
  const target = await repository.readTarget(targetDatabase, first.binding.TargetUserId);
  if (!target?.user || !target.server || !same(target.database, targetDatabase)) invalid();
  const checked = validateReviewedBinding({
    binding: first.binding, primary: first.primary, target: target.user,
    primaryServer: first.server, primaryDatabase: first.database,
    targetServer: target.server, targetDatabase: target.database,
  });
  // A review can be revoked while the other database is being read. Recheck
  // the primary snapshot and revision; this is not a cross-server transaction.
  const last = await repository.readPrimary(primaryDatabase, targetDatabase, primaryUserId);
  if (!same(last?.database, primaryDatabase)) invalid();
  const rechecked = validateReviewedBinding({
    binding: last?.binding, primary: last?.primary, target: target.user,
    primaryServer: last?.server, primaryDatabase: last?.database,
    targetServer: target.server, targetDatabase: target.database,
  });
  if (checked.primaryUserId !== rechecked.primaryUserId || checked.revision !== rechecked.revision || checked.targetUserId !== rechecked.targetUserId) invalid();
  return { ...checked, primaryServer: first.server, targetServer: target.server };
}

// Resolve both parties independently. A valid effective user must never make
// an unmapped or disabled Access As actor eligible to write as somebody else.
async function resolveReviewedActorAndEffective({ actorUserId, effectiveUserId, primaryDatabase, targetDatabase }, repository) {
  const resolve = primaryUserId => resolveReviewedIdentity({ primaryUserId, primaryDatabase, targetDatabase }, repository);
  const effective = await resolve(effectiveUserId);
  const actor = actorUserId === effectiveUserId ? effective : await resolve(actorUserId);
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  if (!same(actor.primaryServer, effective.primaryServer) || !same(actor.targetServer, effective.targetServer)) invalid();
  return {
    primaryActorUserId: actor.primaryUserId, primaryEffectiveUserId: effective.primaryUserId,
    businessActorUserId: actor.targetUserId, businessEffectiveUserId: effective.targetUserId,
    actorRevision: actor.revision, effectiveRevision: effective.revision,
    identityServer: effective.primaryServer, businessServer: effective.targetServer,
  };
}

function sqlRepository(db, isSwitchableDb) {
  async function read(database, userId, bindingTarget) {
    if (!isSwitchableDb(database)) invalid();
    return db.runWithTarget('onprem', async () => {
      const user = await db.wfQuery(`SELECT CAST(SERVERPROPERTY('ServerName') AS NVARCHAR(128)) AS ServerName,
        DB_NAME() AS DatabaseName, Id, Username, EmpId, IsActive
        FROM wf.AppUser WHERE Id=@userId`, { userId: { type: db.sql.Int, value: userId } });
      const row = user.recordset?.[0];
      if (!row) return null;
      const location = { server: row.ServerName, database: row.DatabaseName };
      if (!bindingTarget) return { ...location, user: row };
      const result = await db.wfQuery(`SELECT * FROM wf.DatabaseIdentityBinding
        WHERE PrimaryUserId=@userId AND TargetDatabaseName=@targetDatabase`, {
        userId: { type: db.sql.Int, value: userId },
        targetDatabase: { type: db.sql.NVarChar(128), value: bindingTarget },
      });
      if (result.recordset?.length !== 1) return null;
      return { ...location, primary: row, binding: result.recordset[0] };
    }, database);
  }
  return {
    readUser: (database, userId) => read(database, userId),
    readPrimary: (database, target, userId) => {
      if (!isSwitchableDb(target)) invalid();
      return read(database, userId, target);
    },
    readTarget: (database, userId) => read(database, userId),
  };
}

module.exports = { resolveReviewedIdentity, resolveReviewedActorAndEffective, sqlRepository };
