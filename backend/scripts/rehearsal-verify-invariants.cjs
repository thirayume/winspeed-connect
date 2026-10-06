'use strict';
const fs = require('fs');
const runner = require('../run_migrations');
const { withSession, cli } = require('./rehearsal-session.cjs');
const { snapshot, digestRows, stable } = require('./rehearsal-baseline.cjs');
const { safeIntSql } = require('../services/sql-conversion-helpers');
function highWaterSql(sequence) {
  const suffix = col => safeIntSql(`SUBSTRING(${col}, CHARINDEX('-', ${col})+1, LEN(${col}))`);
  const source = sequence === 'WfRefSeq'
    ? `SELECT ${suffix('WfRef')} AS n FROM wf.SalesOrder WHERE WfRef LIKE '%-%'
       UNION ALL SELECT ${suffix('DocuNo')} FROM dbo.SOHD WHERE DocuType=103 AND DocuNo LIKE '%-%'`
    : `SELECT ${suffix('QuoteNo')} AS n FROM wf.Quotation WHERE QuoteNo LIKE '%-%'`;
  return `SELECT CONVERT(VARCHAR(40), ISNULL(MAX(n),0)) AS HighWater FROM (${source}) refs`;
}
async function runVerifyInvariants(options = {}) {
  const receipt = typeof options.baseline === 'string' ? JSON.parse(fs.readFileSync(options.baseline,'utf8').replace(/^\uFEFF/,'')) : options.baseline;
  const before = receipt?.report?.baseline || receipt?.baseline || receipt;
  if (!before || before.schemaVersion !== 1) throw new Error('Pre-apply baseline required');
  if (options.mode === 'live' && (receipt?.report?.evidence || receipt?.evidence) !== 'ENGINE_EXECUTED') throw new Error('Live verification requires an engine baseline receipt');
  return withSession(options, 'local_rehearsal', async (pool, target) => {
    const after = await snapshot(pool, target, options.backupSha256);
    if (stable(before.target) !== stable(after.target) || before.backupSha256 !== after.backupSha256) throw new Error('Baseline target/backup mismatch');
    const checks = [];
    checks.push({ name: 'dbo data multiset preserved', passed: stable(before.data) === stable(after.data) });
    checks.push({ name: 'dbo trigger definitions/state preserved', passed: digestRows(before.triggers) === digestRows(after.triggers) });
    checks.push({ name: 'dbo indexes preserved including historical D3', passed: digestRows(before.indexes) === digestRows(after.indexes) });
    const oldLedger = new Map(before.ledger);
    const current = new Map(after.ledger);
    checks.push({ name: 'historical ledger rows preserved', passed: [...oldLedger].every(([k,v]) => stable(current.get(k)) === stable(v)) });
    const policy = runner.loadPolicy();
    const inventory = runner.discoverMigrations(undefined, policy, 'local_rehearsal');
    const plan = runner.buildPlan(inventory, current, undefined, 'local_rehearsal', policy);
    const pendingOrDrift = plan.entries.filter(e => e.status !== 'UNCHANGED');
    checks.push({ name: 'canonical active ledger provenance', passed: pendingOrDrift.length === 0, unresolved: pendingOrDrift.map(e => ({ file:e.file,status:e.status })) });
    const unproven = plan.entries.filter(e => e.applied?.dialect === 'LEGACY_UNKNOWN').map(e => e.file);
    if (unproven.length) throw new Error('Historical provenance unknown; preserve ledger and review, never invent executed hashes: ' + unproven.join(', '));
    checks.push({ name: 'exclusions never newly applied (including 074)', passed: inventory.excludedFiles.every(f => oldLedger.has(f) || !current.has(f)) });
    const counters = (await pool.request().query('SELECT SequenceName, CONVERT(VARCHAR(40),CurrentValue) AS CurrentValue FROM wf.SequenceCounter')).recordset;
    for (const sequence of ['WfRefSeq','QuoteRefSeq']) {
      const row = counters?.find(r => r.SequenceName === sequence);
      const high = (await pool.request().query(highWaterSql(sequence))).recordset?.[0]?.HighWater;
      const valid = typeof row?.CurrentValue === 'string' && /^\d+$/.test(row.CurrentValue) && typeof high === 'string' && /^\d+$/.test(high);
      checks.push({ name: sequence + ' actual document high-water', passed: Boolean(valid && BigInt(row.CurrentValue) >= BigInt(high)) });
    }
    if (checks.some(c => !c.passed)) {
      const error = new Error('Rehearsal invariant verification failed: ' + checks.filter(c => !c.passed).map(c => c.name).join('; '));
      error.checks = checks; throw error;
    }
    return { allPassed: true, checks, scope: 'Quiesced before/after native dbo tables, metadata, ledger and counters' };
  });
}
if (require.main === module) cli(runVerifyInvariants);
module.exports = { runVerifyInvariants, highWaterSql };

