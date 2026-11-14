'use strict';

/**
 * Closes a bill from the scale (owner, 3 November 2026). When the scale has weighed out a bill's truck and the record
 * checks out, the bill becomes SHIPPED by itself, weigh ticket and rebate accrual included. When it does not check
 * out, the bill stays open and an incident says why; the warehouse confirms it or a manager records the weights.
 */
const { findPendingScaleEvents } = require('./scale-events');
const { getWeightSettings } = require('./weight-reconciliation');
const { recordIncident, detectIncidents, plateMatches, localToUtc } = require('./rule-incidents');
const { syncStockFromWinSpeed } = require('./stock-sync');

const SHIP_INTERVAL_MS = 60 * 1000;
const INCIDENT_INTERVAL_MS = 5 * 60 * 1000;
const STOCK_INTERVAL_MS = 30 * 60 * 1000;

/** What stops a scale record from closing its bill by itself. */
function scaleProblems(row, tolerance) {
  const problems = [];
  const billTon = Number(row.BillTon) || 0;
  const plannedTon = Number(row.PlannedTon) || billTon;
  const plannedKg = plannedTon * 1000;
  const net = Number(row.NetKg) || 0;
  if (!plateMatches(row.TruckPlate, row.BillPlate)) {
    problems.push({ type: 'PLATE_MISMATCH', detail: `ตาชั่ง ${row.TruckPlate || '-'} · บิล ${row.BillPlate || '-'}` });
  }
  if (plannedKg > 0 && (net < plannedKg * (1 + tolerance.minPct / 100) || net > plannedKg * (1 + tolerance.maxPct / 100))) {
    problems.push({
      type: 'WEIGHT_OUT_OF_TOLERANCE',
      detail: `ชั่งได้ ${net.toLocaleString('en-US')} กก. จากที่จะขน ${plannedKg.toLocaleString('en-US')} กก.`,
    });
  }
  if (billTon > 0 && Math.abs(plannedTon - billTon) > billTon * 0.02) {
    problems.push({ type: 'SCALE_TONS_MISMATCH', detail: `บันทึกชั่ง ${plannedTon} ตัน · บิล ${billTon} ตัน` });
  }
  return problems;
}

async function runOnce() {
  const { autoShipFromScale } = require('../routes/so');
  const tolerance = await getWeightSettings();
  const pending = await findPendingScaleEvents();
  let shipped = 0;
  for (const row of pending) {
    try {
      const problems = scaleProblems(row, tolerance);
      if (problems.length) {
        for (const p of problems) {
          await recordIncident({
            key: `${p.type}:${row.EventId}`, type: p.type, soid: row.SOID, docuNo: row.DocuNo,
            wghdId: row.EventId, occurredAt: localToUtc(row.WeighOutAt), detail: p.detail,
          });
        }
        continue;
      }
      const result = await autoShipFromScale(row.SOID, row);
      if (result.shipped) shipped += 1;
    } catch (e) {
      console.error(`[scale-ship-sync] ${row.DocuNo}: ${e.message}`);
    }
  }
  return { checked: pending.length, shipped };
}

let timers = [];
function start() {
  if (timers.length || String(process.env.DISABLE_BACKGROUND_WORKERS || '').toLowerCase() === 'true' ||
      String(process.env.SCALE_SHIP_SYNC_DISABLED || '').toLowerCase() === 'true') return;
  const guard = (name, fn) => () => fn().catch(e => console.error(`[${name}] ${e.message}`));
  const ship = guard('scale-ship-sync', runOnce);
  const incidents = guard('rule-incidents', detectIncidents);
  const stock = guard('stock-sync', syncStockFromWinSpeed);
  timers = [setInterval(ship, SHIP_INTERVAL_MS), setInterval(incidents, INCIDENT_INTERVAL_MS), setInterval(stock, STOCK_INTERVAL_MS)];
  timers.forEach(t => t.unref());
  setTimeout(() => { ship(); incidents(); stock(); }, 20 * 1000).unref();
  console.log('[scale-ship-sync] started');
}

module.exports = { start, runOnce, scaleProblems };
