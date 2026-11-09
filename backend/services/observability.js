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
const performanceMetrics = require('./performance-metrics');

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
    performance: performanceMetrics.snapshot(),
  };
}

function getRecentErrors(limit = 50) {
  return state.recentErrors.slice(0, limit);
}

// User activity 15-minute timeslots (Observability & HR Analytics)
const userActivityBuffer = new Map(); // key: `${dateStr}_${slot}_${userId}` -> { dateStr, slot, userId, count, lastActive }

function getBkkDateAndSlot(d = new Date()) {
  const bkkMs = d.getTime() + (7 * 60 * 60 * 1000);
  const bkkDate = new Date(bkkMs);
  const dateStr = bkkDate.toISOString().slice(0, 10);
  const hours = bkkDate.getUTCHours();
  const minutes = bkkDate.getUTCMinutes();
  const slot = hours * 4 + Math.floor(minutes / 15);
  return { dateStr, slot, lastActive: d.toISOString() };
}

function recordUserActivity(userId) {
  const uid = Number(userId);
  if (!uid || !Number.isInteger(uid)) return;
  try {
    const { dateStr, slot, lastActive } = getBkkDateAndSlot();
    const key = `${dateStr}_${slot}_${uid}`;
    const existing = userActivityBuffer.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastActive = lastActive;
    } else {
      userActivityBuffer.set(key, { dateStr, slot, userId: uid, count: 1, lastActive });
    }
  } catch { /* ignore */ }
}

async function flushUserActivity() {
  if (userActivityBuffer.size === 0) return;
  const items = Array.from(userActivityBuffer.values());
  userActivityBuffer.clear();
  try {
    const { sql, wfQuery } = require('../db');
    for (const item of items) {
      await wfQuery(`
        MERGE wf.UserActivitySlot AS target
        USING (SELECT @date AS ActivityDate, @slot AS TimeSlot, @uid AS UserId) AS source
        ON target.ActivityDate = source.ActivityDate AND target.TimeSlot = source.TimeSlot AND target.UserId = source.UserId
        WHEN MATCHED THEN
          UPDATE SET RequestCount = target.RequestCount + @cnt, LastActiveAt = @lastActive
        WHEN NOT MATCHED THEN
          INSERT (ActivityDate, TimeSlot, UserId, RequestCount, LastActiveAt)
          VALUES (source.ActivityDate, source.TimeSlot, source.UserId, @cnt, @lastActive);
      `, {
        date: { type: sql.Date, value: item.dateStr },
        slot: { type: sql.TinyInt, value: item.slot },
        uid: { type: sql.Int, value: item.userId },
        cnt: { type: sql.Int, value: item.count },
        lastActive: { type: sql.DateTime2, value: item.lastActive },
      });
    }
  } catch {
    for (const item of items) {
      const key = `${item.dateStr}_${item.slot}_${item.userId}`;
      if (!userActivityBuffer.has(key)) userActivityBuffer.set(key, item);
    }
  }
}

if (process.env.NODE_ENV !== 'test') {
  setInterval(() => flushUserActivity().catch(() => {}), 30000).unref();
}

async function getUserActivity(dateStr) {
  await flushUserActivity().catch(() => {});
  const date = dateStr || getBkkDateAndSlot().dateStr;
  const { sql, wfQuery } = require('../db');

  let slotRows = [];
  let userRows = [];
  try {
    slotRows = (await wfQuery(`
      SELECT TimeSlot, COUNT(DISTINCT UserId) AS ActiveUsers, SUM(RequestCount) AS TotalRequests
      FROM wf.UserActivitySlot
      WHERE ActivityDate = @date
      GROUP BY TimeSlot
      ORDER BY TimeSlot
    `, { date: { type: sql.Date, value: date } })).recordset || [];

    userRows = (await wfQuery(`
      SELECT s.UserId, u.Username, u.DisplayName, u.Role, u.RoleCode,
             COUNT(DISTINCT s.TimeSlot) AS ActiveSlotsCount,
             SUM(s.RequestCount) AS TotalRequests,
             MIN(s.TimeSlot) AS FirstSlot,
             MAX(s.TimeSlot) AS LastSlot,
             MAX(s.LastActiveAt) AS LastActiveAt
      FROM wf.UserActivitySlot s
      LEFT JOIN wf.AppUser u ON u.Id = s.UserId
      WHERE s.ActivityDate = @date
      GROUP BY s.UserId, u.Username, u.DisplayName, u.Role, u.RoleCode
      ORDER BY TotalRequests DESC
    `, { date: { type: sql.Date, value: date } })).recordset || [];
  } catch {
    slotRows = [];
    userRows = [];
  }

  const slots = Array.from({ length: 96 }, (_, i) => {
    const found = slotRows.find(r => r.TimeSlot === i);
    const hour = Math.floor(i / 4).toString().padStart(2, '0');
    const min = ((i % 4) * 15).toString().padStart(2, '0');
    return {
      slot: i,
      time: `${hour}:${min}`,
      activeUsers: found ? found.ActiveUsers : 0,
      totalRequests: found ? found.TotalRequests : 0,
    };
  });

  const users = userRows.map(u => {
    const fH = Math.floor((u.FirstSlot || 0) / 4).toString().padStart(2, '0');
    const fM = (((u.FirstSlot || 0) % 4) * 15).toString().padStart(2, '0');
    const lH = Math.floor((u.LastSlot || 0) / 4).toString().padStart(2, '0');
    const lM = (((u.LastSlot || 0) % 4) * 15).toString().padStart(2, '0');
    return {
      userId: u.UserId,
      username: u.Username || `user-${u.UserId}`,
      displayName: u.DisplayName || u.Username || `User ${u.UserId}`,
      role: u.RoleCode || u.Role || 'USER',
      activeSlotsCount: u.ActiveSlotsCount,
      totalRequests: u.TotalRequests,
      firstActiveTime: `${fH}:${fM}`,
      lastActiveTime: `${lH}:${lM}`,
      lastActiveAt: u.LastActiveAt,
    };
  });

  const currentSlot = getBkkDateAndSlot().slot;
  const activeNowCount = slots[currentSlot]?.activeUsers || 0;

  return {
    date,
    currentSlot,
    activeNowCount,
    totalActiveUsersToday: users.length,
    peakConcurrency: Math.max(0, ...slots.map(s => s.activeUsers)),
    totalRequestsToday: slots.reduce((acc, s) => acc + s.totalRequests, 0),
    slots,
    users,
  };
}

async function clearErrors() {
  state.errors = 0;
  state.recentErrors = [];
  state.byStatus = {};
  state.lastErrorAt = null;
  try {
    const { wfQuery } = require('../db');
    await wfQuery('TRUNCATE TABLE wf.ErrorLog');
  } catch {
    try {
      const { wfQuery } = require('../db');
      await wfQuery('DELETE FROM wf.ErrorLog');
    } catch {}
  }
  return { ok: true, message: 'ล้างประวัติ Error สำเร็จ' };
}

// middleware: นับ request + เวลา + จับ 5xx ที่ route จัดการเอง (ไม่ผ่าน global error handler)
function requestTimer(req, res, next) {
  const start = Date.now();
  const endActive = performanceMetrics.startRequest();
  res.once('close', endActive);
  res.on('finish', () => {
    endActive();
    // Record user activity for 15m slot monitoring
    if (req.user?.sub || req.user?.id) {
      recordUserActivity(req.user.sub || req.user.id);
    }
    // Use the Express route template, never originalUrl/query strings or document IDs.
    performanceMetrics.record(`http ${req.method} ${req.baseUrl || ''}${typeof req.route?.path === 'string' ? req.route.path : '/unmatched'}`, Date.now() - start);
    recordRequest(req.method, req.path, res.statusCode, Date.now() - start);
    // route ส่วนใหญ่ try/catch แล้วตอบ 500 เอง → ไม่ถึง error middleware
    // ถ้ายังไม่ถูกบันทึก ให้บันทึกที่นี่ (กันซ้ำด้วย res.locals.__obsLogged)
    if (res.statusCode >= 500 && !res.locals.__obsLogged) {
      recordError({
        level: 'ERROR',
        source: 'http',
        message: `HTTP ${res.statusCode} on ${req.method} ${req.originalUrl}`,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        userId: req.user?.sub,
      });
    }
  });
  next();
}

module.exports = {
  recordError,
  recordRequest,
  recordUserActivity,
  flushUserActivity,
  getUserActivity,
  clearErrors,
  releaseSignal,
  getStatus,
  getRecentErrors,
  alert,
  requestTimer,
  _state: state
};
