'use strict';

require('dotenv').config();

const { loadPolicy } = require('./run_migrations');
const { collectProbeResults } = require('./migration-reconciliation');

function definitionMatch(probe, result) {
  if (!['definitionContains', 'constraintContains'].includes(probe.kind)) return 'NOT_APPLICABLE';
  return result?.passed === true ? 'MATCH' : 'MISMATCH';
}

function buildPreflightRows(policy, collected) {
  const rows = [];
  for (const [migration, spec] of Object.entries(policy.preflightMigrations || {})) {
    const results = collected.get(migration) || new Map();
    const probes = spec.probes || [];
    if (probes.length === 0) {
      rows.push({
        Migration: migration,
        RequiredObject: 'Manual data reconciliation',
        CurrentDbState: 'REQUIRES_REVIEW',
        DefinitionMatch: 'NOT_APPLICABLE',
        DataImpact: spec.dataImpact,
        Dependency: spec.dependency,
        Risk: spec.risk,
        SafeAction: spec.safeAction,
      });
      continue;
    }
    for (const probe of probes) {
      const result = results.get(probe.id) || { passed: false, state: 'NOT_PROBED' };
      rows.push({
        Migration: migration,
        RequiredObject: probe.id,
        CurrentDbState: result.state,
        DefinitionMatch: definitionMatch(probe, result),
        DataImpact: spec.dataImpact,
        Dependency: spec.dependency,
        Risk: spec.risk,
        SafeAction: spec.safeAction,
      });
    }
  }
  return rows;
}

async function run(argv = process.argv.slice(2)) {
  const unknown = argv.filter(arg => arg !== '--json');
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(', ')}`);
  const policy = loadPolicy();
  const db = require('./db');
  await db.readerReady;
  try {
    const collected = await collectProbeResults(db.readerPool, policy.preflightMigrations);
    const rows = buildPreflightRows(policy, collected);
    if (argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
    else console.table(rows);
    console.log('Read-only preflight complete: no schema, data, transaction, or ledger changes were made.');
    return rows;
  } finally {
    await Promise.all([db.readerPool.close(), db.ownerPool.close()]);
  }
}

if (require.main === module) {
  run().catch(async error => {
    console.error(`Migration preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildPreflightRows, run };
