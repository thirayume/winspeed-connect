const { query, wfQuery } = require('../db');
const { broadcast } = require('./socket');
const { reconcileFromWinSpeed } = require('./pricebook-winspeed-sync');

let pollingInterval = null;
let running = false;
const INTERVAL_MS = 5000;
const PRICEBOOK_SYNC_INTERVAL_MS = 15000;
let lastPriceBookSyncAt = 0;

// State to track last seen IDs or timestamps
let state = {
  lastSOHDCount: 0,
  lastMaxSOHD: 0,
  lastAgingUpdate: null,
};

async function checkControlTickets() {
  try {
    // Check if the number of control tickets changed, or the max SOID changed
    const res = await query(`
      SELECT COUNT(*) AS Cnt, ISNULL(MAX(SOID), 0) AS MaxId 
      FROM dbo.SOHD WITH (NOLOCK) 
      WHERE DocuType = 103 AND DocuStatus = 'Y'
    `);
    if (res && res.length > 0) {
      const currentMaxId = res[0].MaxId;
      const currentCount = res[0].Cnt;
      
      if (state.lastSOHDCount !== 0 && (currentMaxId !== state.lastMaxSOHD || currentCount !== state.lastSOHDCount)) {
        console.log(`[Polling] Control Tickets changed (MaxId: ${currentMaxId}, Count: ${currentCount}). Broadcasting...`);
        broadcast('tickets_updated', { maxId: currentMaxId, count: currentCount });
      }
      state.lastMaxSOHD = currentMaxId;
      state.lastSOHDCount = currentCount;
    }
  } catch (error) {
    console.error('[Polling] Error checking control tickets:', error.message);
  }
}

async function checkAgingOrders() {
  try {
    const res = await wfQuery(`
      SELECT ISNULL(MAX(UpdatedAt), MAX(CreatedAt)) AS LastUpdate
      FROM wf.SalesOrder
    `);
    
    if (res && res.recordset && res.recordset.length > 0) {
      const currentUpdate = res.recordset[0].LastUpdate?.getTime() || 0;
      
      if (state.lastAgingUpdate !== null && currentUpdate !== state.lastAgingUpdate) {
        console.log(`[Polling] Aging Orders changed (LastUpdate: ${currentUpdate}). Broadcasting...`);
        broadcast('so_updated', { lastUpdate: currentUpdate });
      }
      state.lastAgingUpdate = currentUpdate;
    }
  } catch (error) {
    console.error('[Polling] Error checking aging orders:', error.message);
  }
}

function startPolling() {
  if (pollingInterval) return;
  console.log(`[Polling] Started background polling every ${INTERVAL_MS}ms`);

  // Start interval immediately so event loop stays alive even if initial checks hang
  pollingInterval = setInterval(() => {
    pollOnce();
  }, INTERVAL_MS);

  // Initial check to populate state without broadcasting (best-effort, non-blocking)
  pollOnce();
}

let lastRebateAlertCheckAt = 0;

async function checkNovember1RebateAlerts() {
  const nowMs = Date.now();
  if (nowMs - lastRebateAlertCheckAt < 15 * 60 * 1000) return;
  lastRebateAlertCheckAt = nowMs;
  try {
    const { wfQuery } = require('../db');
    const { runNovember1ConversionAlertCheck } = require('./rebate-conversion-service');
    await runNovember1ConversionAlertCheck(wfQuery);
  } catch (err) {
    // Non-fatal if migration 187 is not applied yet
    if (!/Invalid object name/i.test(String(err?.message || ''))) {
      console.error('[poll] checkNovember1RebateAlerts failed:', err.message);
    }
  }
}

async function checkPriceBookAutoSync() {
  const now = Date.now();
  if (now - lastPriceBookSyncAt < PRICEBOOK_SYNC_INTERVAL_MS) return;
  lastPriceBookSyncAt = now;
  try {
    const res = await reconcileFromWinSpeed({ force: true });
    if (res?.changed) {
      console.log(`[Polling] PriceBook auto-synced from WinSpeed (updated=${res.updatedBooks}, imported=${res.importedBooks}). Broadcasting...`);
      broadcast('pricebook_updated', res);
    }
  } catch (err) {
    console.warn('[poll] checkPriceBookAutoSync failed:', err.message);
  }
}

async function pollOnce() {
  if (running) return;
  running = true;
  try { await Promise.all([checkControlTickets(), checkAgingOrders(), checkNovember1RebateAlerts(), checkPriceBookAutoSync()]); }
  finally { running = false; }
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('[Polling] Stopped background polling');
  }
}

module.exports = {
  startPolling,
  stopPolling,
  pollOnce
};
