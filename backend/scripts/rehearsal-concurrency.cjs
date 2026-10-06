'use strict';
const { withSession, query, cli } = require('./rehearsal-session.cjs');
const { getNextSequenceValue } = require('../services/sequence-service');
async function runConcurrency(options = {}) {
  const workers = options.workers ?? 25;
  if (!Number.isInteger(workers) || workers < 2 || workers > 50) throw new Error('workers must be 2..50');
  return withSession(options, 'local_rehearsal', async pool => {
    const results = [];
    for (const sequence of ['WfRefSeq','QuoteRefSeq']) {
      const allocate = () => getNextSequenceValue((text, params) => query(pool, text, params), sequence);
      const values = await Promise.all(Array.from({ length: workers }, allocate));
      if (values.some(n => !Number.isSafeInteger(n) || n <= 0) || new Set(values).size !== workers) throw new Error('Duplicate or invalid sequence allocation');
      // Allocation is committed outside the consumer transaction, as in runtime.
      const abandoned = await allocate();
      const tx = pool.transaction();
      await tx.begin();
      try {
        const { randomUUID } = require('crypto');
        const token = randomUUID();
        const r = tx.request(); r.input('token', token); r.input('allocated', abandoned);
        await r.query('CREATE TABLE #RehearsalConsumer (Token UNIQUEIDENTIFIER, Allocated BIGINT); INSERT INTO #RehearsalConsumer VALUES (@token,@allocated);');
      } finally { await tx.rollback(); }
      const next = await allocate();
      if (values.includes(abandoned) || next <= Math.max(...values, abandoned)) throw new Error('Sequence reused after consumer rollback');
      results.push({ sequence, workers, uniqueCount: new Set(values).size, min: Math.min(...values), max: Math.max(...values), abandoned, next });
    }
    return { success: true, results, note: 'Sequence values intentionally consumed, never decremented; no native documents written.' };
  });
}
if (require.main === module) cli(runConcurrency);
module.exports = { runConcurrency };

