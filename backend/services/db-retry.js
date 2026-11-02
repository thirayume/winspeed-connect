'use strict';

/**
 * Runs a read again when SQL Server picks it as a deadlock victim (error 1205).
 * Only for reads: running a write again could repeat work that already happened.
 */
async function retryOnDeadlock(run, { tries = 3, waitMs = 150 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (e) {
      const victim = e?.number === 1205 || /deadlock victim/i.test(String(e?.message || ''));
      if (!victim || attempt >= tries) throw e;
      await new Promise(resolve => setTimeout(resolve, waitMs * attempt));
    }
  }
}

module.exports = { retryOnDeadlock };
