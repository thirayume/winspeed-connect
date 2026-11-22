'use strict';
// Owner, 22 Nov 2026: Rebate ticket lines deduct their tickets when the 103 is issued (RESERVED). This worker reads
// WinSpeed and makes the deduction FINAL once the line's 116 is cut, gives the tickets back when the 103 was cancelled
// in WinSpeed, and records a REBATE_TICKET_DOCUMENT_MISMATCH incident when the 103 or 104 line no longer matches.
// On PROD the 104 and 116 are made in WinSpeed by staff, so there is no Sale-App event to hook. Runs only with the
// Rebate Pool on; DISABLE_BACKGROUND_WORKERS stops it.
const { resolvePhysicalResetTargets } = require('./rebate-reset-targets');
const { settleReservedTickets } = require('./rebate-ticket-lines');
const { transactionQuery, rebateQuery } = require('./rebate-sql');

function createWorker({ env = process.env, db = require('../db'), targets = resolvePhysicalResetTargets,
  settle = settleReservedTickets, interval = setInterval, logger = console } = {}) {
  let timer = null, running = false;
  function intervalMs() {
    const ms = Number(env.REBATE_TICKET_SETTLE_INTERVAL_MS || 60000);
    if (!Number.isSafeInteger(ms) || ms < 10000 || ms > 3600000)
      throw Object.assign(Error('Invalid ticket settlement interval'), { code: 'REBATE_TICKET_SETTLE_SETTINGS_INVALID' });
    return ms;
  }
  async function runOnce() {
    if (running) return { skipped: true };
    running = true;
    try {
      const results = [];
      for (const target of targets(env)) {
        // Do not log target tuples or credentials.
        results.push(await db.runWithTarget('onprem', () => settle({
          runTx: fn => db.wfTransaction(tx => fn(transactionQuery(tx, db.sql))),
          listQuery: rebateQuery(db.wfQuery, db.sql),
          recordIncident: require('./rule-incidents').recordIncident,
          env,
        }), target.name));
      }
      return { skipped: false, targets: results.length, results };
    } finally { running = false; }
  }
  function start() {
    if (timer || String(env.DISABLE_BACKGROUND_WORKERS || '').toLowerCase() === 'true' ||
        env.REBATE_POOL_103_ENABLED !== 'true') return false;
    targets(env); // fail closed at startup for an unpinned manifest
    timer = interval(() => { runOnce().catch(e => logger.error('[rebate-ticket-settle]', String(e?.code || 'SETTLE_FAILED'))); }, intervalMs());
    timer.unref?.();
    return true;
  }
  return { start, runOnce };
}
module.exports = { createWorker };
