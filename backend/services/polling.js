const { query, wfQuery } = require('../db');
const { broadcast } = require('./socket');

let pollingInterval = null;
const INTERVAL_MS = 5000;

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
  
  // Initial check to populate state without broadcasting
  Promise.all([checkControlTickets(), checkAgingOrders()])
    .catch((e) => console.error('[Polling] Initial check error:', e.message))
    .then(() => {
      pollingInterval = setInterval(() => {
        checkControlTickets();
        checkAgingOrders();
      }, INTERVAL_MS);
    });
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
  stopPolling
};
