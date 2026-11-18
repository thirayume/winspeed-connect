'use strict';

// Foundation only: invoke with a query bound to the business SQL transaction,
// and keep that transaction open until its mutation commits or rolls back.
// The reset coordinator must take the matching exclusive lock on each target.
const LOCK = 'WF_REBATE_PARTICIPANT_V1';
const { epoch } = require('./rebate-reset-epoch');
function fail(code) { throw Object.assign(new Error(code), { code, status: 503 }); }
function instant(value) {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time)) fail('REBATE_RESET_PARTICIPANT_MISMATCH');
  return time;
}

async function acquireRebateParticipantFence(query, { environment, generation, resetId, manifestDigest, lastResetAtUtc } = {}) {
  if (typeof query !== 'function' || !['uat', 'production'].includes(environment) ||
      !Number.isSafeInteger(generation) || generation < 0 || !/^[a-f0-9]{64}$/.test(String(manifestDigest || ''))) {
    fail('REBATE_RESET_PARTICIPANT_MISMATCH');
  }
  const expected = epoch({ generation, resetId, lastResetAtUtc });
  const lockResult = (await query(`DECLARE @result int;
    EXEC @result=sp_getapplock @Resource=@resource,@LockMode='Shared',@LockOwner='Transaction',@LockTimeout=10000;
    SELECT @result AS LockResult;`, { resource: LOCK })).recordset?.[0]?.LockResult;
  if (!Number.isInteger(lockResult) || lockResult < 0) fail('REBATE_RESET_PARTICIPANT_LOCK_UNAVAILABLE');
  const row = (await query(`SELECT EnvironmentKind,ManifestDigest,Generation,Phase,ResetId,LastResetAtUtc
    FROM wf.RebateResetParticipant WITH (HOLDLOCK) WHERE EnvironmentKind=@environment`, { environment })).recordset?.[0];
  if (!row || row.Phase !== 'READY') fail('REBATE_RESET_PARTICIPANT_UNAVAILABLE');
  if (String(row.EnvironmentKind || '').trim().toLowerCase() !== environment || row.Generation == null ||
      Number(row.Generation) !== generation || String(row.ManifestDigest || '').trim().toLowerCase() !== manifestDigest ||
      String(row.ResetId || '').toLowerCase() !== String(expected.resetId || '') ||
      instant(row.LastResetAtUtc) !== instant(expected.lastResetAtUtc)) fail('REBATE_RESET_PARTICIPANT_MISMATCH');
  return expected;
}
module.exports = { LOCK, acquireRebateParticipantFence };
