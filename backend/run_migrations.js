'use strict';

/**
 * WinSpeed migration runner.
 *
 * Safety properties:
 * - migration selection, exclusions and legacy aliases are governed by migration-policy.json;
 * - old consolidated migrations require exact ledger evidence and read-only object probes;
 * - an applied file is immutable: checksum or batch-count drift stops the run;
 * - ledger read/write failures are fatal rather than treated as an empty ledger;
 * - --plan uses the reader pool and never bootstraps or changes the ledger.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  STATUSES,
  classifyCurrentMigration,
  statusForPendingFile,
  knownLegacyFiles,
  collectProbeResults,
} = require('./migration-reconciliation');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const POLICY_PATH = path.join(__dirname, 'migration-policy.json');
const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const splitBatches = sql => String(sql).split(/^\s*GO\s*$/im).filter(batch => batch.trim());

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function loadPolicy(file = POLICY_PATH) {
  const policy = readJson(file);
  if (policy.schemaVersion !== 2) throw new Error(`Unsupported migration policy schemaVersion: ${policy.schemaVersion}`);
  if (!Array.isArray(policy.excludedFiles) || !Array.isArray(policy.excludedPatterns)) {
    throw new Error('migration-policy.json must define excludedFiles and excludedPatterns arrays.');
  }
  if (!policy.legacyDuplicateSequences || typeof policy.legacyDuplicateSequences !== 'object') {
    throw new Error('migration-policy.json must define legacyDuplicateSequences.');
  }
  if (!policy.legacyAliases || typeof policy.legacyAliases !== 'object') {
    throw new Error('migration-policy.json must define legacyAliases.');
  }
  if (!policy.preflightMigrations || typeof policy.preflightMigrations !== 'object') {
    throw new Error('migration-policy.json must define preflightMigrations.');
  }
  if (policy.checksumPolicy !== 'immutable-after-apply') {
    throw new Error('Only checksumPolicy=immutable-after-apply is supported.');
  }
  return policy;
}

function migrationSequence(fileName) {
  const match = path.basename(fileName).match(/^(\d+)_/);
  return match ? Number(match[1]) : null;
}

function compileExcludedPatterns(policy) {
  return policy.excludedPatterns.map(pattern => {
    try { return new RegExp(pattern, 'i'); }
    catch (error) { throw new Error(`Invalid migration exclusion pattern ${pattern}: ${error.message}`); }
  });
}

function validateMigrationPolicy(fileNames, policy) {
  const files = [...fileNames].filter(file => file.toLowerCase().endsWith('.sql')).sort();
  const fileSet = new Set(files);
  const excludedPatterns = compileExcludedPatterns(policy);
  const errors = [];

  for (const file of policy.excludedFiles) {
    if (!fileSet.has(file)) errors.push(`Configured excluded migration is missing: ${file}`);
  }

  const excludedFiles = files.filter(file => policy.excludedFiles.includes(file) || excludedPatterns.some(pattern => pattern.test(file)));
  const excludedSet = new Set(excludedFiles);
  const activeFiles = files.filter(file => !excludedSet.has(file));
  const activeUnsequenced = activeFiles.filter(file => migrationSequence(file) === null);
  if (activeUnsequenced.length) errors.push(`Active migration filename(s) must start with a numeric sequence: ${activeUnsequenced.join(', ')}`);

  const bySequence = new Map();
  for (const file of files) {
    const sequence = migrationSequence(file);
    if (sequence === null) continue;
    const group = bySequence.get(sequence) || [];
    group.push(file);
    bySequence.set(sequence, group);
  }
  const actualDuplicates = new Map([...bySequence].filter(([, group]) => group.length > 1));
  const expectedDuplicates = new Map(Object.entries(policy.legacyDuplicateSequences).map(([sequence, group]) => [Number(sequence), [...group].sort()]));
  const duplicateSequences = new Set([...actualDuplicates.keys(), ...expectedDuplicates.keys()]);
  for (const sequence of [...duplicateSequences].sort((a, b) => a - b)) {
    const actual = [...(actualDuplicates.get(sequence) || [])].sort();
    const expected = [...(expectedDuplicates.get(sequence) || [])].sort();
    if (actual.join('\n') !== expected.join('\n')) {
      errors.push(`Migration sequence ${sequence} does not match the approved legacy group (actual: ${actual.join(', ') || 'none'}; expected: ${expected.join(', ') || 'none'}).`);
    }
  }

  for (const [currentFile, alias] of Object.entries(policy.legacyAliases || {})) {
    if (!activeFiles.includes(currentFile)) errors.push(`Legacy alias target is not an active migration: ${currentFile}`);
    if (!/^[a-f0-9]{64}$/i.test(String(alias.currentChecksum || ''))) errors.push(`Legacy alias currentChecksum is invalid: ${currentFile}`);
    if (!Array.isArray(alias.legacyFiles) || alias.legacyFiles.length === 0) errors.push(`Legacy alias has no legacyFiles: ${currentFile}`);
    if (!Array.isArray(alias.probes) || alias.probes.length === 0) errors.push(`Legacy alias has no required probes: ${currentFile}`);
  }

  for (const file of Object.keys(policy.preflightMigrations || {})) {
    if (!activeFiles.includes(file)) errors.push(`Preflight migration is not active: ${file}`);
  }

  if (errors.length) throw new Error(`Migration policy validation failed:\n- ${errors.join('\n- ')}`);
  return {
    allFiles: files,
    activeFiles,
    excludedFiles,
    legacyDuplicateSequences: [...actualDuplicates].map(([sequence, group]) => ({ sequence, files: [...group] })),
  };
}

function discoverMigrations(directory = MIGRATIONS_DIR, policy = loadPolicy()) {
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map(entry => entry.name);
  return validateMigrationPolicy(files, policy);
}

function classifyMigration(applied, checksum, batchCount) {
  return classifyCurrentMigration(applied, checksum, batchCount).status;
}

async function ensureLedger(pool) {
  await pool.request().query(`
    IF SCHEMA_ID('wf') IS NULL EXEC('CREATE SCHEMA wf AUTHORIZATION dbo');
    IF OBJECT_ID('wf.SchemaMigration','U') IS NULL
      CREATE TABLE wf.SchemaMigration (
        FileName NVARCHAR(255) NOT NULL PRIMARY KEY,
        Checksum CHAR(64) NOT NULL,
        BatchCount INT NOT NULL,
        AppliedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        AppliedBy NVARCHAR(128) NULL DEFAULT SUSER_SNAME()
      );
  `);
}

async function loadApplied(pool) {
  const result = await pool.request().query('SELECT FileName, Checksum, BatchCount, AppliedAt, AppliedBy FROM wf.SchemaMigration');
  return new Map((result.recordset || []).map(row => [row.FileName, {
    checksum: row.Checksum,
    batchCount: row.BatchCount,
    appliedAt: row.AppliedAt,
    appliedBy: row.AppliedBy,
  }]));
}

async function recordApplied(pool, fileName, checksum, batchCount) {
  await pool.request()
    .input('f', fileName)
    .input('c', checksum)
    .input('b', batchCount)
    .query('INSERT INTO wf.SchemaMigration (FileName, Checksum, BatchCount) VALUES (@f, @c, @b);');
}

const IGNORABLE_CODES = [1913, 2714, 2705];

function sqlErrorCode(error) {
  return error?.originalError?.info?.number
    ?? error?.originalError?.number
    ?? error?.number
    ?? error?.originalError?.code;
}

async function runFile(pool, fileName, batches) {
  let successCount = 0;
  let ignoredCount = 0;
  for (let index = 0; index < batches.length; index += 1) {
    try {
      await pool.request().query(batches[index]);
      successCount += 1;
    } catch (error) {
      const code = sqlErrorCode(error);
      if (IGNORABLE_CODES.includes(code)) {
        ignoredCount += 1;
        continue;
      }
      const wrapped = new Error(`${fileName} batch ${index + 1}/${batches.length} failed${code ? ` (SQL ${code})` : ''}: ${error.message}`);
      wrapped.cause = error;
      throw wrapped;
    }
  }
  return { successCount, ignoredCount, batchCount: batches.length };
}

function buildPlan(inventory, applied, directory = MIGRATIONS_DIR, policy = { legacyAliases: {}, preflightMigrations: {} }, probeState = {}) {
  const aliasResults = probeState.aliases || new Map();
  const preflightResults = probeState.preflight || new Map();
  const entries = inventory.activeFiles.map(file => {
    const sql = fs.readFileSync(path.join(directory, file), 'utf8');
    const checksum = sha256(sql);
    const batches = splitBatches(sql);
    const appliedRow = applied.get(file) || null;
    let detail = classifyCurrentMigration(appliedRow, checksum, batches.length);
    if (detail.status === STATUSES.PENDING) {
      detail = statusForPendingFile({
        file,
        currentChecksum: checksum,
        policy,
        applied,
        aliasProbeResults: aliasResults.get(file),
        preflightProbeResults: preflightResults.get(file),
      });
    }
    return {
      file,
      batches,
      checksum,
      batchCount: batches.length,
      status: detail.status,
      reason: detail.reason || null,
      evidence: detail,
      applied: appliedRow,
      historicalEvidence: policy.driftEvidence?.[file]?.historicalEvidence || detail.historicalEvidence || null,
    };
  });
  const diskSet = new Set(inventory.allFiles);
  const recognizedLegacy = knownLegacyFiles(policy);
  return {
    entries,
    excludedEntries: inventory.excludedFiles.map(file => ({ file, status: STATUSES.EXCLUDED, applied: applied.get(file) || null })),
    legacyLedger: [...applied.keys()].filter(file => recognizedLegacy.has(file)).sort(),
    ledgerOnly: [...applied.keys()].filter(file => !diskSet.has(file) && !recognizedLegacy.has(file)).sort(),
    excludedApplied: inventory.excludedFiles.filter(file => applied.has(file)).sort(),
  };
}

async function collectPlanProbeState(pool, policy) {
  return {
    aliases: await collectProbeResults(pool, policy.legacyAliases),
    preflight: await collectProbeResults(pool, policy.preflightMigrations),
  };
}

function parseArgs(argv) {
  const options = { plan: false, help: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--plan' || arg === '--verify-only') options.plan = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printPlan(plan, inventory, target, readOnly) {
  const counts = plan.entries.reduce((acc, entry) => {
    acc[entry.status] = (acc[entry.status] || 0) + 1;
    return acc;
  }, {});
  console.log(`\nMigration ${readOnly ? 'read-only plan' : 'preflight'} for ${String(target).toUpperCase()}`);
  console.log(`  active: ${inventory.activeFiles.length}; excluded: ${inventory.excludedFiles.length}`);
  for (const status of Object.values(STATUSES)) {
    const count = status === STATUSES.EXCLUDED ? inventory.excludedFiles.length : counts[status] || 0;
    if (count > 0) console.log(`  ${status}: ${count}`);
  }
  for (const entry of plan.entries.filter(item => item.status !== STATUSES.APPLIED_CURRENT)) {
    console.log(`  ${entry.status.padEnd(24)} ${entry.file}${entry.reason ? ` (${entry.reason})` : ''}`);
    if (entry.status === STATUSES.CHECKSUM_DRIFT) {
      console.log(`    applied checksum: ${entry.applied?.checksum || 'none'}`);
      console.log(`    current checksum: ${entry.checksum}`);
      if (entry.historicalEvidence) console.log(`    historical evidence: ${entry.historicalEvidence}`);
    }
    if (entry.status === STATUSES.APPLIED_VIA_LEGACY_ALIAS && entry.historicalEvidence) {
      console.log(`    historical evidence: ${entry.historicalEvidence}`);
    }
  }
  for (const file of plan.excludedApplied) console.log(`  ${STATUSES.EXCLUDED.padEnd(24)} ${file} (ledger row exists)`);
  for (const file of plan.legacyLedger) console.log(`  LEGACY_ALIAS_EVIDENCE    ${file}`);
  for (const file of plan.ledgerOnly) console.log(`  UNSAFE_LEDGER_ONLY       ${file}`);
  return counts;
}

async function run(options = parseArgs(process.argv)) {
  if (options.help) {
    console.log('Usage: node run_migrations.js [--plan|--verify-only]');
    return;
  }

  const policy = loadPolicy();
  const inventory = discoverMigrations(MIGRATIONS_DIR, policy);
  const db = require('./db');
  if (options.plan) await db.readerReady;
  else await db.ownerReady;
  const pool = options.plan ? db.readerPool : db.ownerPool;
  const target = db.getTarget();

  if (!options.plan) await ensureLedger(pool);
  const applied = await loadApplied(pool);
  const probeState = await collectPlanProbeState(pool, policy);
  const plan = buildPlan(inventory, applied, MIGRATIONS_DIR, policy, probeState);
  const counts = printPlan(plan, inventory, target, options.plan);

  if (plan.ledgerOnly.length) throw new Error(`Unknown ledger-only migration(s): ${plan.ledgerOnly.join(', ')}`);
  const blockers = plan.entries.filter(entry => [STATUSES.CHECKSUM_DRIFT, STATUSES.PARTIALLY_APPLIED, STATUSES.UNSAFE].includes(entry.status));
  if (blockers.length) {
    throw new Error(`Migration safety blocker(s): ${blockers.map(entry => `${entry.file}:${entry.status}`).join(', ')}`);
  }
  if (options.plan) {
    console.log('  read-only: no schema, data, transaction, or ledger changes were made.');
    return plan;
  }

  for (const entry of plan.entries.filter(item => item.status === STATUSES.PENDING)) {
    console.log(`\nApplying ${entry.file}`);
    const result = await runFile(pool, entry.file, entry.batches);
    await recordApplied(pool, entry.file, entry.checksum, entry.batchCount);
    console.log(`  ${result.successCount} OK; ${result.ignoredCount} recoverable duplicate(s); ledger recorded`);
  }
  console.log(`\nMigration complete: ${counts[STATUSES.APPLIED_CURRENT] || 0} current; ${counts[STATUSES.PENDING] || 0} applied; ${inventory.excludedFiles.length} excluded.`);
  return plan;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`Migration failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  sha256,
  splitBatches,
  loadPolicy,
  migrationSequence,
  validateMigrationPolicy,
  discoverMigrations,
  classifyMigration,
  buildPlan,
  collectPlanProbeState,
  parseArgs,
  runFile,
  STATUSES,
};
