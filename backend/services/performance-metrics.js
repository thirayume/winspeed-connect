'use strict';
// Fixed buckets and bounded labels: no SQL text, parameters, credentials or personal data.
const bounds = [100, 500, 1000, 3000, 10000, 30000, 60000, Infinity];
const rows = new Map();
let active = 0, peak = 0;
function startRequest() {
  active++; peak = Math.max(peak, active);
  let done = false;
  return () => { if (!done) { done = true; active--; } };
}
function record(label, ms) {
  if (!rows.has(label) && rows.size >= 100) label = 'other';
  if (!rows.has(label)) rows.set(label, { count: 0, totalMs: 0, maxMs: 0, slow: 0, buckets: bounds.map(() => 0) });
  const row = rows.get(label);
  row.count++; row.totalMs += ms; row.maxMs = Math.max(row.maxMs, ms);
  if (ms >= 3000) row.slow++;
  row.buckets[bounds.findIndex(n => ms <= n)]++;
}
async function measure(label, work) {
  const start = Date.now();
  try { return await work(); } finally { record(label, Date.now() - start); }
}
function snapshot() {
  return { activeRequests: active, peakRequests: peak, sampleSince: 'process start',
    timings: [...rows].map(([operation, row]) => {
      let sum = 0, p95 = bounds[bounds.length - 1];
      for (let i = 0; i < bounds.length; i++) { sum += row.buckets[i]; if (sum >= Math.ceil(row.count * .95)) { p95 = bounds[i]; break; } }
      return { operation, count: row.count, averageMs: Math.round(row.totalMs / row.count), maxMs: row.maxMs, slowCount: row.slow,
        p95UpperBoundMs: Number.isFinite(p95) ? p95 : '>60000' };
    }) };
}
module.exports = { startRequest, record, measure, snapshot };
