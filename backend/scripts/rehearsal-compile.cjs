'use strict';
const runner = require('../run_migrations');
const { withSession, cli } = require('./rehearsal-session.cjs');
async function runCompile(options = {}) {
  return withSession(options, 'local_rehearsal', async pool => {
    const result = await runner.run({ plan: true, profile: 'local_rehearsal' }, pool);
    const entries = result.plan?.entries;
    if (!entries?.length) throw new Error('Missing compile inventory');
    const tx = pool.transaction(); // Pins a connection until rollback.
    await tx.begin();
    const checked = [];
    let failure;
    try {
      await tx.request().batch('SET NOEXEC ON;');
      for (const e of entries) {
        for (let i = 0; i < e.batches.length; i++) {
          // Exact resolver batches: never prepend controls before CREATE/ALTER.
          if (/\bSET\s+(?:NOEXEC|PARSEONLY)\s+OFF\b/i.test(e.batches[i])) throw new Error('Unsafe compile control in migration');
          await tx.request().batch(e.batches[i]);
          checked.push({ file: e.file, hash: e.checksum, batch: i + 1 });
        }
      }
    } catch (error) { failure = error; }
    finally {
      try { await tx.request().batch('SET NOEXEC OFF;'); } catch (error) { failure ||= error; }
      try { await tx.rollback(); } catch (error) { failure ||= error; }
    }
    if (failure) throw failure;
    return { success: true, totalFilesCompiled: entries.length, totalBatchesCompiled: checked.length,
      checked, excludedFiles: result.inventory.excludedFiles,
      status: 'BATCH_COMPILE_CHECK_ONLY', dynamicExecution: 'NOT_RUN', deferredNameResolution: 'NOT_PROVEN',
      note: 'NOEXEC does not execute dynamic SQL or prove dependencies/data semantics; engine apply/oracle remains mandatory.' };
  });
}
if (require.main === module) cli(runCompile);
module.exports = { runCompile };

