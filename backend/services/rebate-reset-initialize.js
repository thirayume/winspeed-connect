'use strict';

// First-time initialization of the Rebate reset coordinator and participants
// for one environment: generation 0, READY, no reset. It changes no balance and
// cancels nothing; it only makes the fences usable, which the routes require
// once the Rebate Pool switch is on.
//
// It refuses a database that already carries reset history for the
// environment (receipts, evidence, accruals, attempts) without the matching
// rows: that is a restored or damaged database and needs a person, not a
// silent re-initialization.
//
// Order: every participant in its own transaction on its own database, then
// the coordinator on the primary. Targets may be on different servers, so the
// whole is not atomic. If a step fails the coordinator row is not written, the
// fence stays closed, and a rerun completes the remaining steps (each step is
// idempotent).
const { resolvePhysicalResetTargets } = require('./rebate-reset-targets');
const { preflightResetTargets } = require('./rebate-reset-preflight');
const { digestTargets, LOCK: COORDINATOR_LOCK } = require('./rebate-reset-fence');
const { LOCK: PARTICIPANT_LOCK } = require('./rebate-participant-fence');
const { transactionQuery } = require('./rebate-sql');

function fail(code, status = 503) { throw Object.assign(new Error(code), { code, status }); }
const clean = value => String(value || '').trim().toLowerCase();
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const HISTORY_TABLES = Object.freeze(['RebateResetReceipt', 'RebateShipmentEvidence', 'RebateShipmentAccrual']);

async function exclusiveLock(query, resource, code) {
  const lock = (await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
    @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`, { resource })).recordset?.[0]?.LockResult;
  if (!Number.isInteger(lock) || lock < 0) fail(code);
}

async function assertDatabaseIdentity(query, target) {
  const actual = (await query('SELECT DB_NAME() AS DatabaseName, CAST(@@SERVERNAME AS nvarchar(128)) AS ServerName', {})).recordset?.[0];
  if (!actual || clean(actual.DatabaseName) !== clean(target.database) || clean(actual.ServerName) !== clean(target.server)) {
    fail('REBATE_RESET_TARGET_IDENTITY_MISMATCH');
  }
}

// A generation-0 row carries no reset identity at all.
function isPristine(row, environment, digest) {
  return clean(row.EnvironmentKind) === environment && clean(row.ManifestDigest) === digest && row.Generation != null &&
    Number(row.Generation) === 0 && row.Phase === 'READY' && row.ResetId == null && row.LastResetAtUtc == null;
}

// One target database. Call with a query bound to a transaction on that database.
async function initializeParticipant(query, { environment, manifestDigest, target } = {}) {
  if (typeof query !== 'function' || !['uat', 'production'].includes(environment) ||
      !/^[a-f0-9]{64}$/.test(String(manifestDigest || '')) || !target || !clean(target.database) || !clean(target.server)) {
    fail('REBATE_RESET_INPUT_INVALID', 400);
  }
  await assertDatabaseIdentity(query, target);
  await exclusiveLock(query, PARTICIPANT_LOCK, 'REBATE_RESET_PARTICIPANT_LOCK_UNAVAILABLE');
  const row = (await query(`SELECT EnvironmentKind,ManifestDigest,Generation,Phase,ResetId,LastResetAtUtc
    FROM wf.RebateResetParticipant WITH(UPDLOCK,HOLDLOCK) WHERE EnvironmentKind=@environment`, { environment })).recordset?.[0];
  if (row) {
    if (!isPristine(row, environment, manifestDigest)) fail('REBATE_RESET_PARTICIPANT_MISMATCH', 409);
    return { created: false };
  }
  // No participant row: the database must not hold anything a reset produces.
  for (const table of HISTORY_TABLES) { // fixed internal names only
    const used = (await query(`SELECT TOP 1 1 AS Used FROM wf.${table} WITH(HOLDLOCK) WHERE EnvironmentKind=@environment`, { environment })).recordset?.[0];
    if (used) fail('REBATE_RESET_HISTORY_EXISTS', 409);
  }
  const inserted = await query(`INSERT wf.RebateResetParticipant(EnvironmentKind,ManifestDigest,Generation,Phase)
    VALUES(@environment,@digest,0,'READY')`, { environment, digest: manifestDigest });
  if (Number(inserted?.rowsAffected?.[0]) !== 1) fail('REBATE_RESET_PARTICIPANT_MISMATCH', 409);
  return { created: true };
}

async function initializeRebateEnvironment({ actorId, effectiveId, reason } = {}, options = {}) {
  const note = typeof reason === 'string' ? reason.trim() : '';
  if (!positive(actorId) || !positive(effectiveId)) fail('REBATE_RESET_IDENTITY_INVALID', 400);
  if (!note || note.length > 500) fail('REBATE_RESET_REASON_REQUIRED', 400);
  const env = options.env || process.env, db = options.db || require('../db'), tupleResolver = options.tupleResolver;
  if (env.REBATE_POOL_103_ENABLED !== 'true') fail('REBATE_POOL_103_UNAVAILABLE');
  const targets = resolvePhysicalResetTargets(env, tupleResolver);
  const digest = digestTargets(targets), kind = clean(env.ONPREM_TARGET_KIND), primary = String(env.ONPREM_DB_NAME || '').trim();
  const primaryTarget = targets.find(t => clean(t.name) === clean(primary));
  if (!primaryTarget) fail('REBATE_RESET_PRIMARY_INVALID');
  const preflight = await (options.preflight || preflightResetTargets)({ env, db, tupleResolver });
  if (!preflight?.ready) fail('REBATE_RESET_PREFLIGHT_FAILED');

  const coordinator = fn => db.rebateFenceTransaction(async tx => {
    const query = transactionQuery(tx, db.sql);
    await assertDatabaseIdentity(query, { database: primaryTarget.database, server: primaryTarget.expectedServerName });
    await exclusiveLock(query, COORDINATOR_LOCK, 'REBATE_RESET_FENCE_UNAVAILABLE');
    const row = (await query(`SELECT EnvironmentKind,PrimaryDatabase,ManifestDigest,Generation,Phase,ResetId,LastResetAtUtc
      FROM wf.RebateResetCoordinator WITH(UPDLOCK,HOLDLOCK) WHERE EnvironmentKind=@kind`, { kind })).recordset?.[0];
    if (row && (!isPristine(row, kind, digest) || clean(row.PrimaryDatabase) !== clean(primary))) fail('REBATE_RESET_COORDINATOR_MISMATCH', 409);
    return fn({ tx, query, exists: Boolean(row) });
  }, primary);

  // 1. Refuse early when the coordinator exists but is not a pristine match.
  const before = await coordinator(async s => ({ exists: s.exists }));

  // 2. Participants, one database at a time.
  let participantsCreated = 0;
  for (const target of targets) {
    const input = { environment: kind, manifestDigest: digest, target: { database: target.database, server: target.expectedServerName } };
    const result = await db.runWithTarget('onprem', () => db.wfTransaction(tx =>
      (options.initializeParticipant || initializeParticipant)(transactionQuery(tx, db.sql), input)), target.name);
    if (result?.created) participantsCreated += 1;
  }

  // 3. Coordinator last, with the audit record in the same transaction.
  const coordinatorCreated = await coordinator(async s => {
    if (s.exists) return false;
    const attempted = (await s.query('SELECT TOP 1 1 AS Used FROM wf.RebateResetAttempt WITH(HOLDLOCK) WHERE EnvironmentKind=@kind', { kind })).recordset?.[0];
    if (attempted) fail('REBATE_RESET_HISTORY_EXISTS', 409);
    const inserted = await s.query(`INSERT wf.RebateResetCoordinator(EnvironmentKind,PrimaryDatabase,ManifestDigest,Generation,Phase)
      VALUES(@kind,@primary,@digest,0,'READY')`, { kind, primary: primaryTarget.database, digest });
    if (Number(inserted?.rowsAffected?.[0]) !== 1) fail('REBATE_RESET_COORDINATOR_MISMATCH', 409);
    await (options.audit || require('./policy-contract').logChangeEvent)(s.tx, {
      entityType: 'REBATE_RESET', entityId: kind, action: 'INITIALIZE_FENCE', beforeJson: null,
      afterJson: JSON.stringify({ environment: kind, generation: 0, manifestDigest: digest, targetCount: targets.length,
        targets: targets.map(t => t.database), actorPrimaryId: actorId, effectivePrimaryId: effectiveId }),
      reasonText: note, userId: effectiveId,
    });
    return true;
  });

  return { environment: kind, generation: 0, targetCount: targets.length, participantsCreated, coordinatorCreated,
    replayed: before.exists && participantsCreated === 0 };
}

// Read-only view of the fences for the administrator: no locks are taken.
async function readRebateEnvironmentStatus(options = {}) {
  const env = options.env || process.env, db = options.db || require('../db'), tupleResolver = options.tupleResolver;
  const poolEnabled = env.REBATE_POOL_103_ENABLED === 'true';
  const targets = resolvePhysicalResetTargets(env, tupleResolver);
  const digest = digestTargets(targets), kind = clean(env.ONPREM_TARGET_KIND), primary = String(env.ONPREM_DB_NAME || '').trim();
  const typed = { kind: { type: db.sql.VarChar(16), value: kind } };
  const summarize = row => row ? { phase: row.Phase, generation: Number(row.Generation), resetId: row.ResetId || null,
    lastResetAtUtc: row.LastResetAtUtc || null, manifestMatches: clean(row.ManifestDigest) === digest } : null;
  const coordinatorRow = (await db.runWithTarget('onprem', () => db.wfQuery(
    `SELECT EnvironmentKind,PrimaryDatabase,ManifestDigest,Generation,Phase,ResetId,LastResetAtUtc
     FROM wf.RebateResetCoordinator WHERE EnvironmentKind=@kind`, typed), primary)).recordset?.[0];
  const participants = [];
  for (const target of targets) {
    const row = (await db.runWithTarget('onprem', () => db.wfQuery(
      `SELECT EnvironmentKind,ManifestDigest,Generation,Phase,ResetId,LastResetAtUtc
       FROM wf.RebateResetParticipant WHERE EnvironmentKind=@kind`, typed), target.name)).recordset?.[0];
    participants.push({ database: target.database, ...(summarize(row) || { phase: null, generation: null, resetId: null, lastResetAtUtc: null, manifestMatches: false }),
      initialized: Boolean(row) });
  }
  const coordinator = summarize(coordinatorRow);
  const consistent = Boolean(coordinator) && coordinator.manifestMatches && coordinator.phase === 'READY' &&
    participants.every(p => p.initialized && p.manifestMatches && p.phase === 'READY' && p.generation === coordinator.generation &&
      clean(p.resetId) === clean(coordinator.resetId));
  return { environment: kind, poolEnabled, initialized: Boolean(coordinator), ready: consistent, coordinator, participants };
}

module.exports = { initializeParticipant, initializeRebateEnvironment, readRebateEnvironmentStatus, HISTORY_TABLES };
