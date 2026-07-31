'use strict';

const STATUSES = Object.freeze({
  APPLIED_CURRENT: 'APPLIED_CURRENT',
  APPLIED_VIA_LEGACY_ALIAS: 'APPLIED_VIA_LEGACY_ALIAS',
  CHECKSUM_DRIFT: 'CHECKSUM_DRIFT',
  PARTIALLY_APPLIED: 'PARTIALLY_APPLIED',
  PENDING: 'PENDING',
  UNSAFE: 'UNSAFE',
  EXCLUDED: 'EXCLUDED',
});

function classifyCurrentMigration(applied, checksum, batchCount) {
  if (!applied) return { status: STATUSES.PENDING, reason: null };
  if (String(applied.checksum || '').toLowerCase() !== String(checksum).toLowerCase()) {
    return { status: STATUSES.CHECKSUM_DRIFT, reason: 'CHECKSUM_MISMATCH' };
  }
  if (Number(applied.batchCount) !== Number(batchCount)) {
    return { status: STATUSES.CHECKSUM_DRIFT, reason: 'BATCH_COUNT_MISMATCH' };
  }
  return { status: STATUSES.APPLIED_CURRENT, reason: null };
}

function probeValue(results, id) {
  if (!results) return null;
  if (results instanceof Map) return results.get(id) || null;
  return results[id] || null;
}

function reconcileLegacyAlias(alias, applied, results) {
  const ledgerEvidence = alias.legacyFiles.map(expected => {
    const actual = applied.get(expected.file) || null;
    const checksumMatch = Boolean(actual)
      && String(actual.checksum || '').toLowerCase() === String(expected.checksum).toLowerCase();
    const batchCountMatch = Boolean(actual)
      && Number(actual.batchCount) === Number(expected.batchCount);
    return { ...expected, actual, present: Boolean(actual), checksumMatch, batchCountMatch };
  });
  const probeEvidence = alias.probes.map(probe => ({
    ...probe,
    result: probeValue(results, probe.id),
  }));

  const presentCount = ledgerEvidence.filter(item => item.present).length;
  const passedProbeCount = probeEvidence.filter(item => item.result?.passed === true).length;
  const checksumMismatch = ledgerEvidence.some(item => item.present && !item.checksumMatch);
  const batchMismatch = ledgerEvidence.some(item => item.present && !item.batchCountMatch);

  if (checksumMismatch || batchMismatch) {
    return {
      status: STATUSES.CHECKSUM_DRIFT,
      reason: checksumMismatch ? 'LEGACY_CHECKSUM_MISMATCH' : 'LEGACY_BATCH_COUNT_MISMATCH',
      ledgerEvidence,
      probeEvidence,
      historicalEvidence: alias.historicalEvidence,
    };
  }

  const ledgerComplete = ledgerEvidence.every(item => item.present && item.checksumMatch && item.batchCountMatch);
  const probesComplete = probeEvidence.every(item => item.result?.passed === true);
  if (ledgerComplete && probesComplete) {
    return {
      status: STATUSES.APPLIED_VIA_LEGACY_ALIAS,
      reason: null,
      ledgerEvidence,
      probeEvidence,
      historicalEvidence: alias.historicalEvidence,
    };
  }

  if (presentCount === 0 && passedProbeCount === 0) {
    return {
      status: STATUSES.PENDING,
      reason: 'NO_LEGACY_EVIDENCE',
      ledgerEvidence,
      probeEvidence,
      historicalEvidence: alias.historicalEvidence,
    };
  }

  return {
    status: STATUSES.PARTIALLY_APPLIED,
    reason: ledgerComplete ? 'LEGACY_OBJECT_PROBE_MISSING' : 'LEGACY_LEDGER_INCOMPLETE',
    ledgerEvidence,
    probeEvidence,
    historicalEvidence: alias.historicalEvidence,
  };
}

function statusForPendingFile({ file, currentChecksum, policy, applied, aliasProbeResults, preflightProbeResults }) {
  const alias = policy.legacyAliases?.[file];
  if (alias) {
    if (alias.currentChecksum && String(alias.currentChecksum).toLowerCase() !== String(currentChecksum).toLowerCase()) {
      return { status: STATUSES.CHECKSUM_DRIFT, reason: 'CONSOLIDATED_IDENTITY_MISMATCH', expectedChecksum: alias.currentChecksum, currentChecksum };
    }
    return reconcileLegacyAlias(alias, applied, aliasProbeResults);
  }

  const preflight = policy.preflightMigrations?.[file];
  if (preflight) {
    const evidence = (preflight.probes || []).map(probe => ({
      ...probe,
      result: probeValue(preflightProbeResults, probe.id),
    }));
    if (evidence.some(item => item.result?.passed === true)) {
      return { status: STATUSES.PARTIALLY_APPLIED, reason: 'DATABASE_EFFECT_WITHOUT_LEDGER', probeEvidence: evidence };
    }
    if (preflight.unsafe === true) {
      return { status: STATUSES.UNSAFE, reason: preflight.riskReason || 'REQUIRES_MANUAL_REVIEW', probeEvidence: evidence };
    }
  }
  return { status: STATUSES.PENDING, reason: null };
}

function knownLegacyFiles(policy) {
  return new Set(Object.values(policy.legacyAliases || {})
    .flatMap(alias => alias.legacyFiles || [])
    .map(item => item.file));
}

function assertIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value))) {
    throw new Error(`Unsafe ${label} identifier in migration policy: ${value}`);
  }
  return value;
}

async function runMetadataProbe(pool, probe) {
  const schema = assertIdentifier(probe.schema || 'wf', 'schema');
  const object = probe.object ? assertIdentifier(probe.object, 'object') : null;
  const request = pool.request();
  request.input('schema', schema);
  if (object) request.input('object', object);

  if (probe.kind === 'object') {
    const result = await request.query(`
      SELECT o.type FROM sys.objects o
      JOIN sys.schemas s ON s.schema_id=o.schema_id
      WHERE s.name=@schema AND o.name=@object;
    `);
    const actualType = String(result.recordset?.[0]?.type || '').trim() || null;
    const passed = Boolean(actualType) && (!probe.types || probe.types.includes(actualType));
    return { passed, state: actualType ? `PRESENT:${actualType}` : 'MISSING' };
  }

  if (probe.kind === 'column' || probe.kind === 'columnAbsent') {
    request.input('column', assertIdentifier(probe.column, 'column'));
    const result = await request.query(`
      SELECT COUNT(*) AS n FROM sys.columns c
      JOIN sys.objects o ON o.object_id=c.object_id
      JOIN sys.schemas s ON s.schema_id=o.schema_id
      WHERE s.name=@schema AND o.name=@object AND c.name=@column;
    `);
    const present = Number(result.recordset?.[0]?.n || 0) > 0;
    const passed = probe.kind === 'column' ? present : !present;
    return { passed, state: present ? 'PRESENT' : 'MISSING' };
  }

  if (probe.kind === 'index') {
    request.input('index', assertIdentifier(probe.index, 'index'));
    const result = await request.query(`
      SELECT COUNT(*) AS n FROM sys.indexes i
      JOIN sys.objects o ON o.object_id=i.object_id
      JOIN sys.schemas s ON s.schema_id=o.schema_id
      WHERE s.name=@schema AND o.name=@object AND i.name=@index;
    `);
    const passed = Number(result.recordset?.[0]?.n || 0) > 0;
    return { passed, state: passed ? 'PRESENT' : 'MISSING' };
  }

  if (probe.kind === 'constraintContains') {
    request.input('constraint', assertIdentifier(probe.constraint, 'constraint'));
    const result = await request.query(`
      SELECT cc.definition FROM sys.check_constraints cc
      JOIN sys.objects o ON o.object_id=cc.parent_object_id
      JOIN sys.schemas s ON s.schema_id=o.schema_id
      WHERE s.name=@schema AND o.name=@object AND cc.name=@constraint;
    `);
    const definition = String(result.recordset?.[0]?.definition || '').toLowerCase();
    const tokens = (probe.tokens || []).map(token => String(token).toLowerCase());
    const passed = Boolean(definition) && tokens.every(token => definition.includes(token));
    return { passed, state: definition ? (passed ? 'DEFINITION_MATCH' : 'DEFINITION_MISMATCH') : 'MISSING' };
  }

  if (probe.kind === 'definitionContains') {
    const result = await request.query(`
      SELECT sm.definition FROM sys.sql_modules sm
      JOIN sys.objects o ON o.object_id=sm.object_id
      JOIN sys.schemas s ON s.schema_id=o.schema_id
      WHERE s.name=@schema AND o.name=@object;
    `);
    const definition = String(result.recordset?.[0]?.definition || '').toLowerCase();
    const tokens = (probe.tokens || []).map(token => String(token).toLowerCase());
    const passed = Boolean(definition) && tokens.every(token => definition.includes(token));
    return { passed, state: definition ? (passed ? 'DEFINITION_MATCH' : 'DEFINITION_MISMATCH') : 'MISSING' };
  }

  if (probe.kind === 'rowCountAtLeast') {
    const table = assertIdentifier(probe.object, 'object');
    const result = await pool.request().query(`SELECT COUNT_BIG(*) AS n FROM [${schema}].[${table}];`);
    const count = Number(result.recordset?.[0]?.n || 0);
    return { passed: count >= Number(probe.minimum || 1), state: `ROWS:${count}` };
  }

  throw new Error(`Unsupported migration metadata probe kind: ${probe.kind}`);
}

async function collectProbeResults(pool, groups) {
  const output = new Map();
  for (const [file, spec] of Object.entries(groups || {})) {
    const results = new Map();
    for (const probe of spec.probes || []) {
      results.set(probe.id, await runMetadataProbe(pool, probe));
    }
    output.set(file, results);
  }
  return output;
}

module.exports = {
  STATUSES,
  classifyCurrentMigration,
  reconcileLegacyAlias,
  statusForPendingFile,
  knownLegacyFiles,
  runMetadataProbe,
  collectProbeResults,
};
