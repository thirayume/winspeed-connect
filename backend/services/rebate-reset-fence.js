'use strict';

// Foundation only: not wired to routes yet. Every Rebate writer and reader
// must use this fence before the reset coordinator can be enabled. A dedicated
// bounded pool prevents fence transactions consuming the normal owner pool.
// A lost primary connection releases this lock: a participant fence inside
// each business transaction is still required before any route can use it.
const crypto = require('crypto');
const { resolvePhysicalResetTargets } = require('./rebate-reset-targets');
const { epoch } = require('./rebate-reset-epoch');
const LOCK = 'WF_REBATE_RESET_V1';
function fail(code) { throw Object.assign(new Error(code), { code, status: 503 }); }
function digestTargets(targets) {
  const pairs = targets.map(t => [t.name.toLowerCase(), t.database.toLowerCase(), t.expectedServerName.toLowerCase()]);
  pairs.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
  return crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex');
}

async function withRebateOperationFence(operation, { env = process.env, db = require('../db'), tupleResolver } = {}) {
  if (typeof operation !== 'function') throw new TypeError('operation is required');
  const targets = resolvePhysicalResetTargets(env, tupleResolver);
  const expectedDigest = digestTargets(targets);
  const kind = String(env.ONPREM_TARGET_KIND || '').trim().toLowerCase();
  const primary = String(env.ONPREM_DB_NAME || '').trim();
  const target = String(db.getDbName() || primary).trim();
  if (db.getTarget() !== 'onprem' || !targets.some(t => t.name.toLowerCase() === target.toLowerCase())) {
    fail('REBATE_RESET_TARGET_NOT_ALLOWED');
  }
  return db.rebateFenceTransaction(async tx => {
    const lockResult = (await tx.request().input('resource', db.sql.NVarChar(255), LOCK).query(`DECLARE @result int;
      EXEC @result=sp_getapplock @Resource=@resource,@LockMode='Shared',@LockOwner='Transaction',@LockTimeout=10000;
      SELECT @result AS LockResult;`)).recordset?.[0]?.LockResult;
    if (!Number.isInteger(lockResult) || lockResult < 0) fail('REBATE_RESET_FENCE_UNAVAILABLE');
    const row = (await tx.request().input('kind', db.sql.VarChar(16), kind).query(`SELECT EnvironmentKind,PrimaryDatabase,ManifestDigest,Generation,Phase,ResetId,LastResetAtUtc
      FROM wf.RebateResetCoordinator WITH (HOLDLOCK) WHERE EnvironmentKind=@kind`)).recordset?.[0];
    if (!row || row.Phase !== 'READY') fail('REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED');
    if (String(row.EnvironmentKind || '').trim().toLowerCase() !== kind || row.Generation == null) fail('REBATE_RESET_COORDINATOR_MISMATCH');
    if (String(row.PrimaryDatabase || '').trim().toLowerCase() !== primary.toLowerCase() ||
        String(row.ManifestDigest || '').trim().toLowerCase() !== expectedDigest ||
        !Number.isSafeInteger(Number(row.Generation)) || Number(row.Generation) < 0) fail('REBATE_RESET_COORDINATOR_MISMATCH');
    // Restore the original session target while retaining the primary SQL
    // transaction and shared application lock until the operation completes.
    const currentEpoch = epoch({ generation: Number(row.Generation), resetId: row.ResetId, lastResetAtUtc: row.LastResetAtUtc });
    return db.runWithTarget('onprem', () => operation({ environment: kind, ...currentEpoch,
      manifestDigest: expectedDigest }), target);
  }, primary);
}

module.exports = { LOCK, digestTargets, withRebateOperationFence };
