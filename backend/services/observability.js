/**
 * observability.js — FR-030 Operational telemetry & alerting
 * ───────────────────────────────────────────────────────────────
 *  - นับ request/error + เก็บ error ล่าสุดใน ring buffer (in-memory)
 *  - persist error ลง wf.ErrorLog (best-effort, ไม่โยน throw)
 *  - ส่ง alert ไป webhook (Slack/Discord/Teams/generic) ถ้าตั้ง ALERT_WEBHOOK_URL
 *  - release signal ตอน start
 * ทั้งหมด fail-safe: ถ้า observability พัง ต้องไม่ทำให้ request/แอปล้ม
 */
const path = require('path');

let VERSION = process.env.APP_VERSION || 'unknown';
try { VERSION = require(path.join(__dirname, '..', 'package.json')).version || VERSION; } catch { /* ignore */ }

const RING_MAX = 100;
const state = {
  startedAt: Date.now(),
  version: VERSION,
  env: process.env.NODE_ENV || 'development',
  requests: 0,
  errors: 0,
  byStatus: {},               // { '500': n, '404': n, ... }
  recentErrors: [],           // [{ at, level, source, message, method, path, status, userId }]
  lastErrorAt: null,
};

const _alertGate = new Map();   // key → lastSentMs (rate-limit)
const ALERT_MIN_INTERVAL = 60 * 1000;

function recordRequest(method, pathName, status, ms) {
  try {
    state.requests++;
    const key = String(status);
    state.byStatus[key] = (state.byStatus[key] || 0) + 1;
  } catch { /* ignore */ }
}

async function alert(text, key = 'generic', level = 'error') {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const now = Date.now();
  const last = _alertGate.get(key) || 0;
  if (now - last < ALERT_MIN_INTERVAL) return;  // กัน spam
  _alertGate.set(key, now);
  const emoji = level === 'error' ? '🔴' : level === 'warn' ? '🟠' : '🟢';
  const msg = `${emoji} [WS-Sale-App ${state.version}/${state.env}] ${text}`;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 4000);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg, content: msg }),   // text=Slack/Teams · content=Discord
      signal: ctrl.signal,
    }).catch(() => {});
    clearTimeout(to);
  } catch { /* never throw */ }
}

async function persist(entry) {
  try {
    const { sql, wfQuery } = require('../db');
    await wfQuery(
      `INSERT INTO wf.ErrorLog (Level, Source, Message, Detail, ReqMethod, ReqPath, StatusCode, UserId, AppVersion)
       VALUES (@lv,@src,@msg,@det,@m,@p,@st,@uid,@ver)`,
      {
        lv:  { type: sql.NVarChar(10),   value: entry.level },
        src: { type: sql.NVarChar(120),  value: entry.source || null },
        msg: { type: sql.NVarChar(2000), value: (entry.message || '').slice(0, 2000) },
        det: { type: sql.NVarChar(sql.MAX), value: entry.detail || null },
        m:   { type: sql.NVarChar(10),   value: entry.method || null },
        p:   { type: sql.NVarChar(400),  value: entry.path || null },
        st:  { type: sql.Int,            value: entry.status || null },
        uid: { type: sql.Int,            value: entry.userId || null },
        ver: { type: sql.NVarChar(20),   value: state.version },
      });
  } catch { /* best-effort; ห้ามทำให้ request ล้ม */ }
}

function recordError(entry) {
  try {
    const e = {
      at: new Date().toISOString(),
      level: entry.level || 'ERROR',
      source: entry.source || null,
      message: entry.message || 'Unknown error',
      method: entry.method || null,
      path: entry.path || null,
      status: entry.status || 500,
      userId: entry.userId || null,
    };
    state.errors++;
    state.lastErrorAt = e.at;
    state.recentErrors.unshift(e);
    if (state.recentErrors.length > RING_MAX) state.recentErrors.length = RING_MAX;
    // persist + alert (async, ไม่ await — fire & forget)
    persist({ ...e, detail: entry.detail });
    if (e.status >= 500) alert(`${e.method || ''} ${e.path || e.source || ''} → ${e.message}`, `err:${e.path || e.source}`, 'error');
  } catch { /* never throw */ }
}

function releaseSignal() {
  console.log(`[obs] release ${state.version} (${state.env}) started`);
  alert(`🚀 service started — version ${state.version}`, 'release', 'info');
}

function getStatus() {
  return {
    version: state.version,
    env: state.env,
    startedAt: new Date(state.startedAt).toISOString(),
    uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
    requests: state.requests,
    errors: state.errors,
    lastErrorAt: state.lastErrorAt,
    byStatus: state.byStatus,
    alertConfigured: !!process.env.ALERT_WEBHOOK_URL,
  };
}

function getRecentErrors(limit = 50) {
  return state.recentErrors.slice(0, limit);
}

// middleware: นับ request + เวลา
function requestTimer(req, res, next) {
  const start = Date.now();
  res.on('finish', () => recordRequest(req.method, req.path, res.statusCode, Date.now() - start));
  next();
}

module.exports = { recordError, recordRequest, releaseSignal, getStatus, getRecentErrors, alert, requestTimer, _state: state };
