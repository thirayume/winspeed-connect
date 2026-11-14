'use strict';

// First-time initialization of the reset fences (generation 0). It must create the
// participants before the coordinator, be safe to rerun, and refuse any database that
// already carries reset history.
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeRebateEnvironment, initializeParticipant, readRebateEnvironmentStatus } = require('../services/rebate-reset-initialize');
const { digestTargets } = require('../services/rebate-reset-fence');

const DBS = ['dbwins_worldfert9', 'dbwins_worldfert2'];
const SERVER = 'R740-SRV\\SQL2008';
const targets = DBS.map(name => ({ name, database: name, expectedServerName: SERVER }));
const digest = digestTargets(targets);

function fixture() {
  const env = { DB_MODE: 'onprem', REBATE_POOL_103_ENABLED: 'true', ONPREM_TARGET_KIND: 'production', ONPREM_DB_NAME: DBS[0],
    ONPREM_SWITCHABLE_DATABASES: DBS.join(','), REBATE_RESET_DATABASES: DBS.join(',') };
  const tupleResolver = (_env, _op, database) => ({ database, expectedServerName: SERVER });
  const state = { coordinator: null, participants: { [DBS[0]]: null, [DBS[1]]: null },
    history: { [DBS[0]]: {}, [DBS[1]]: {} }, attempts: false, audits: [], log: [], lock: 0,
    failParticipantInsert: null, actualName: {}, current: null, preflightReady: true };
  const execute = async (database, text, p) => {
    if (/SELECT DB_NAME/.test(text)) return { recordset: [{ DatabaseName: state.actualName[database] || database, ServerName: SERVER }] };
    if (/sp_getapplock/.test(text)) {
      assert.match(text, /@LockMode='Exclusive'/); assert.match(text, /@LockOwner='Transaction'/);
      state.log.push(`lock:${database}:${p.resource}`); return { recordset: [{ LockResult: state.lock }] };
    }
    if (/FROM wf\.RebateResetParticipant WITH\(UPDLOCK,HOLDLOCK\)/.test(text)) return { recordset: state.participants[database] ? [state.participants[database]] : [] };
    if (/FROM wf\.RebateResetCoordinator WITH\(UPDLOCK,HOLDLOCK\)/.test(text)) { assert.equal(database, DBS[0]); return { recordset: state.coordinator ? [state.coordinator] : [] }; }
    const used = text.match(/SELECT TOP 1 1 AS Used FROM wf\.(\w+)/);
    if (used) {
      const present = used[1] === 'RebateResetAttempt' ? state.attempts : state.history[database][used[1]];
      return { recordset: present ? [{ Used: 1 }] : [] };
    }
    if (/INSERT wf\.RebateResetParticipant/.test(text)) {
      if (state.failParticipantInsert === database) throw new Error('participant insert failure');
      state.participants[database] = { EnvironmentKind: p.environment, ManifestDigest: p.digest, Generation: 0, Phase: 'READY', ResetId: null, LastResetAtUtc: null };
      state.log.push(`participant:${database}`); return { rowsAffected: [1] };
    }
    if (/INSERT wf\.RebateResetCoordinator/.test(text)) {
      state.coordinator = { EnvironmentKind: p.kind, PrimaryDatabase: p.primary, ManifestDigest: p.digest, Generation: 0, Phase: 'READY', ResetId: null, LastResetAtUtc: null };
      state.log.push('coordinator'); return { rowsAffected: [1] };
    }
    throw new Error(`Unexpected query: ${text.slice(0, 80)}`);
  };
  const txFor = database => ({ database, request: () => { const inputs = {}; return {
    input(name, _type, value) { inputs[name] = value; return this; }, query: text => execute(database, text, inputs) }; } });
  const sql = { NVarChar: x => x, VarChar: x => x, DateTime2: 'datetime', Int: 'int', BigInt: 'bigint', Bit: 'bit', MAX: -1, Decimal: () => 'decimal' };
  // each transaction keeps a copy of the state and restores it when the work throws, like a rollback
  const transactional = async (database, fn) => {
    const before = structuredClone({ coordinator: state.coordinator, participants: state.participants });
    try { return await fn(txFor(database)); } catch (e) { Object.assign(state, before); throw e; }
  };
  const db = { sql,
    runWithTarget: async (_mode, fn, database) => { const previous = state.current; state.current = database; try { return await fn(); } finally { state.current = previous; } },
    wfTransaction: fn => transactional(state.current, fn),
    rebateFenceTransaction: (fn, primary) => transactional(primary, fn) };
  const options = { env, db, tupleResolver, preflight: async () => ({ ready: state.preflightReady }),
    audit: async (tx, event) => { state.audits.push({ database: tx.database, ...event }); state.log.push('audit'); } };
  const run = (input = { actorId: 1, effectiveId: 63, reason: 'เปิดใช้ Rebate Pool บน UAT' }) => initializeRebateEnvironment(input, options);
  return { env, state, options, run, execute };
}

test('a fresh environment gets every participant first, then the coordinator with an audit record', async () => {
  const f = fixture();
  const result = await f.run();
  assert.deepEqual(result, { environment: 'production', generation: 0, targetCount: 2, participantsCreated: 2, coordinatorCreated: true, replayed: false });
  // participants on their own databases before the coordinator; the audit is written with the coordinator
  assert.deepEqual(f.state.log.filter(x => !x.startsWith('lock:')), [`participant:${DBS[0]}`, `participant:${DBS[1]}`, 'coordinator', 'audit']);
  assert.ok(f.state.log.includes(`lock:${DBS[1]}:WF_REBATE_PARTICIPANT_V1`));
  assert.ok(f.state.log.includes(`lock:${DBS[0]}:WF_REBATE_RESET_V1`));
  assert.deepEqual(f.state.coordinator, { EnvironmentKind: 'production', PrimaryDatabase: DBS[0], ManifestDigest: digest, Generation: 0, Phase: 'READY', ResetId: null, LastResetAtUtc: null });
  for (const name of DBS) assert.deepEqual(f.state.participants[name], { EnvironmentKind: 'production', ManifestDigest: digest, Generation: 0, Phase: 'READY', ResetId: null, LastResetAtUtc: null });
  assert.equal(f.state.audits.length, 1);
  const audit = f.state.audits[0];
  assert.equal(audit.database, DBS[0]);
  assert.deepEqual({ type: audit.entityType, id: audit.entityId, action: audit.action, reason: audit.reasonText, user: audit.userId },
    { type: 'REBATE_RESET', id: 'production', action: 'INITIALIZE_FENCE', reason: 'เปิดใช้ Rebate Pool บน UAT', user: 63 });
  assert.deepEqual(JSON.parse(audit.afterJson), { environment: 'production', generation: 0, manifestDigest: digest, targetCount: 2,
    targets: DBS, actorPrimaryId: 1, effectivePrimaryId: 63 });
});

test('running it again changes nothing', async () => {
  const f = fixture();
  await f.run();
  const snapshot = structuredClone({ c: f.state.coordinator, p: f.state.participants });
  const again = await f.run();
  assert.deepEqual(again, { environment: 'production', generation: 0, targetCount: 2, participantsCreated: 0, coordinatorCreated: false, replayed: true });
  assert.deepEqual({ c: f.state.coordinator, p: f.state.participants }, snapshot);
  assert.equal(f.state.audits.length, 1, 'no second audit record');
});

test('a failure on one database leaves the fence closed and a rerun completes it', async () => {
  const f = fixture();
  f.state.failParticipantInsert = DBS[1];
  await assert.rejects(f.run(), /participant insert failure/);
  assert.equal(f.state.coordinator, null, 'no coordinator row, so every fenced route stays closed');
  assert.ok(f.state.participants[DBS[0]], 'the first participant committed on its own');
  assert.equal(f.state.participants[DBS[1]], null);
  assert.equal(f.state.audits.length, 0);

  f.state.failParticipantInsert = null;
  const result = await f.run();
  assert.deepEqual({ p: result.participantsCreated, c: result.coordinatorCreated, replayed: result.replayed }, { p: 1, c: true, replayed: false });
  assert.ok(f.state.coordinator && f.state.participants[DBS[1]]);
});

test('a database that already carries reset history is refused', async () => {
  for (const table of ['RebateResetReceipt', 'RebateShipmentEvidence', 'RebateShipmentAccrual']) {
    const f = fixture();
    f.state.history[DBS[1]][table] = true;
    await assert.rejects(f.run(), { code: 'REBATE_RESET_HISTORY_EXISTS', status: 409 });
    assert.equal(f.state.coordinator, null, table);
    assert.equal(f.state.participants[DBS[1]], null, table);
  }
  const f = fixture();
  f.state.attempts = true; // the primary remembers a reset attempt but has no coordinator row
  await assert.rejects(f.run(), { code: 'REBATE_RESET_HISTORY_EXISTS', status: 409 });
  assert.equal(f.state.coordinator, null);
  assert.equal(f.state.audits.length, 0);
});

test('rows that are not a pristine generation-0 match are never overwritten', async () => {
  const pristine = { EnvironmentKind: 'production', PrimaryDatabase: DBS[0], ManifestDigest: digest, Generation: 0, Phase: 'READY', ResetId: null, LastResetAtUtc: null };
  for (const change of [{ Generation: 1 }, { Phase: 'APPLYING' }, { ManifestDigest: 'b'.repeat(64) }, { ResetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    { LastResetAtUtc: new Date() }, { PrimaryDatabase: DBS[1] }]) {
    const f = fixture();
    f.state.coordinator = { ...pristine, ...change };
    await assert.rejects(f.run(), { code: 'REBATE_RESET_COORDINATOR_MISMATCH', status: 409 });
    assert.deepEqual(f.state.participants, { [DBS[0]]: null, [DBS[1]]: null }, 'no participant is touched');
  }
  const participant = { EnvironmentKind: 'production', ManifestDigest: digest, Generation: 0, Phase: 'READY', ResetId: null, LastResetAtUtc: null };
  for (const change of [{ Generation: 2 }, { Phase: 'FAILED' }, { ManifestDigest: 'c'.repeat(64) }, { ResetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }]) {
    const f = fixture();
    f.state.participants[DBS[1]] = { ...participant, ...change };
    await assert.rejects(f.run(), { code: 'REBATE_RESET_PARTICIPANT_MISMATCH', status: 409 });
    assert.equal(f.state.coordinator, null);
  }
});

test('nothing is touched without the Pool switch, a valid identity, a reason, a passing preflight and the right database', async () => {
  const guarded = fixture();
  guarded.options.db = new Proxy({}, { get() { throw new Error('must not reach the database'); } });
  guarded.options.preflight = async () => { throw new Error('must not run preflight'); };
  guarded.env.REBATE_POOL_103_ENABLED = 'false';
  await assert.rejects(guarded.run(), { code: 'REBATE_POOL_103_UNAVAILABLE', status: 503 });
  guarded.env.REBATE_POOL_103_ENABLED = 'true';
  for (const input of [{ actorId: 0, effectiveId: 1, reason: 'x' }, { actorId: 1, effectiveId: null, reason: 'x' }]) {
    await assert.rejects(guarded.run(input), { code: 'REBATE_RESET_IDENTITY_INVALID', status: 400 });
  }
  for (const reason of [undefined, '   ', 'x'.repeat(501)]) {
    await assert.rejects(guarded.run({ actorId: 1, effectiveId: 1, reason }), { code: 'REBATE_RESET_REASON_REQUIRED', status: 400 });
  }

  const notReady = fixture(); notReady.state.preflightReady = false;
  await assert.rejects(notReady.run(), { code: 'REBATE_RESET_PREFLIGHT_FAILED' });
  assert.equal(notReady.state.log.length, 0);

  const wrongDb = fixture(); wrongDb.state.actualName[DBS[1]] = 'dbwins_worldfert9_uat';
  await assert.rejects(wrongDb.run(), { code: 'REBATE_RESET_TARGET_IDENTITY_MISMATCH' });
  assert.equal(wrongDb.state.coordinator, null);

  const busy = fixture(); busy.state.lock = -1;
  await assert.rejects(busy.run(), { code: 'REBATE_RESET_FENCE_UNAVAILABLE' });
});

test('participant initialization validates its own input', async () => {
  const never = async () => { throw new Error('no SQL expected'); };
  const good = { environment: 'uat', manifestDigest: 'a'.repeat(64), target: { database: 'dbwins_worldfert9_uat', server: SERVER } };
  for (const bad of [{ ...good, environment: 'staging' }, { ...good, manifestDigest: 'short' }, { ...good, target: { database: '', server: SERVER } }, { ...good, target: null }]) {
    await assert.rejects(initializeParticipant(never, bad), { code: 'REBATE_RESET_INPUT_INVALID', status: 400 });
  }
  await assert.rejects(initializeParticipant(null, good), { code: 'REBATE_RESET_INPUT_INVALID' });
});

test('status reports each database without taking locks', async () => {
  const f = fixture();
  const reads = [];
  const read = { sql: { VarChar: n => `varchar(${n})` },
    runWithTarget: async (_mode, fn, database) => { f.state.current = database; return fn(); },
    wfQuery: async (text, inputs) => {
      reads.push({ database: f.state.current, text }); assert.equal(inputs.kind.value, 'production'); assert.doesNotMatch(text, /UPDLOCK|HOLDLOCK|sp_getapplock/);
      const row = /RebateResetCoordinator/.test(text) ? f.state.coordinator : f.state.participants[f.state.current];
      return { recordset: row ? [row] : [] };
    } };
  const before = await readRebateEnvironmentStatus({ env: f.env, db: read, tupleResolver: f.options.tupleResolver });
  assert.deepEqual({ env: before.environment, pool: before.poolEnabled, initialized: before.initialized, ready: before.ready, coordinator: before.coordinator },
    { env: 'production', pool: true, initialized: false, ready: false, coordinator: null });
  assert.deepEqual(before.participants.map(p => [p.database, p.initialized]), [[DBS[0], false], [DBS[1], false]]);

  await f.run();
  const after = await readRebateEnvironmentStatus({ env: f.env, db: read, tupleResolver: f.options.tupleResolver });
  assert.equal(after.initialized, true); assert.equal(after.ready, true);
  assert.deepEqual(after.coordinator, { phase: 'READY', generation: 0, resetId: null, lastResetAtUtc: null, manifestMatches: true });

  // one database out of step is reported as not ready
  f.state.participants[DBS[1]] = { ...f.state.participants[DBS[1]], Generation: 1, ResetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
  const skewed = await readRebateEnvironmentStatus({ env: f.env, db: read, tupleResolver: f.options.tupleResolver });
  assert.equal(skewed.ready, false);
  assert.equal(reads.every(r => DBS.includes(r.database)), true);
});
