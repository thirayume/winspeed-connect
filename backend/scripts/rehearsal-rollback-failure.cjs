'use strict';
const crypto = require('crypto');
const runner = require('../run_migrations');
const { withSession, cli } = require('./rehearsal-session.cjs');
const ledgerJson = ledger => JSON.stringify([...ledger].sort(([a], [b]) => a.localeCompare(b)));
async function runRollbackFailure(options = {}) {
  return withSession(options, 'local_rehearsal', async (pool, target) => {
    const plan = await runner.run({ plan: true, profile: 'local_rehearsal' }, pool);
    if (!plan.plan?.entries?.length || plan.plan.entries.some(e => e.status !== 'UNCHANGED')) throw new Error('Rollback rehearsal requires fully applied, unchanged ledger');
    const before = await runner.loadApplied(pool);
    const suffix = crypto.randomBytes(12).toString('hex');
    const table = 'Rehearsal_' + suffix;
    const file = '999_rehearsal_' + suffix + '.sql';
    const batches = [`CREATE TABLE wf.[${table}] (Token INT NOT NULL); INSERT INTO wf.[${table}] VALUES (1);`];
    const checksum = runner.sha256(batches.join('\n'));
    const entry = { file, checksum, batchCount: 1, effective: { dialect: 'standard',
      original: { hash: checksum, batchCount: 1 }, executed: { hash: checksum, batchCount: 1, fileName: file } } };
    const tx = pool.transaction();
    await tx.begin();
    let injected = false;
    try {
      await runner.runFile(pool, file, batches, tx);
      await runner.recordApplied(tx, entry, target.targetDatabase, 'local_rehearsal');
      await tx.request().batch("RAISERROR ('REHEARSAL_EXPECTED_FAILURE',16,1);");
    } catch (error) {
      if (!/REHEARSAL_EXPECTED_FAILURE/.test(error.message)) throw error;
      injected = true;
    } finally { await tx.rollback(); }
    if (!injected) throw new Error('Expected engine failure not observed');
    const request = pool.request(); request.input('objectName', 'wf.' + table);
    const absent = (await request.query("SELECT OBJECT_ID(@objectName,'U') AS ObjectId")).recordset?.[0];
    if (!absent || absent.ObjectId !== null) throw new Error('DDL rollback failed');
    const after = await runner.loadApplied(pool);
    if (ledgerJson(before) !== ledgerJson(after) || after.has(file)) throw new Error('Ledger rollback failed');
    // Exercise the actual runner bootstrap error contract with no pending migrations.
    let bootstrapError;
    try {
      await runner.run({ plan: false, profile: 'local_rehearsal' }, pool, null, {
        bootstrapSequenceHighWater: async () => { const error = new Error('REHEARSAL_BOOTSTRAP_FAILURE'); throw error; }
      });
    } catch (error) { bootstrapError = error; }
    if (bootstrapError?.code !== 'SEQUENCE_BOOTSTRAP_FAILURE' || bootstrapError.incomplete !== true ||
        !Array.isArray(bootstrapError.appliedList) || bootstrapError.appliedList.length !== 0) throw new Error('Bootstrap failure contract lost');
    const final = await runner.loadApplied(pool);
    if (ledgerJson(after) !== ledgerJson(final)) throw new Error('Bootstrap failure changed applied ledger');
    return { allPassed: true, runId: suffix, checks: ['DDL/DML + ledger rolled back', 'Bootstrap error propagated, committed ledger retained'],
      bootstrapFailure: 'INJECTED_RUNNER_FAILURE', cleanup: 'Owned transaction rolled back; no broad delete' };
  });
}
if (require.main === module) cli(runRollbackFailure);
module.exports = { runRollbackFailure };

