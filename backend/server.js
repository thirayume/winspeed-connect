/**
 * WS-Sale-App — Express API Server
 * ─────────────────────────────────────────────────────────────────
 * ⚠ IRON RULES:
 *   1. dbo = READ-ONLY — ห้าม CREATE/ALTER/DROP/INSERT/UPDATE/DELETE บน dbo เด็ดขาด
 *   2. เขียนได้เฉพาะ schema wf เท่านั้น
 *   3. ก่อนรัน query ที่ไม่ใช่ SELECT ต้องถามยืนยัน (ทำในส่วน UI)
 * ─────────────────────────────────────────────────────────────────
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');

// ── Global error guards — exit so Railway can restart cleanly ─
function fatal(kind, info) {
  console.error(`[FATAL] ${kind}:`, info);
  try { require('./services/observability').alert(`💥 ${kind}: ${info?.message || info}`, 'fatal', 'error'); } catch { /* ignore */ }
  setTimeout(() => process.exit(1), 600);  // ให้ alert มีเวลายิงก่อน restart
}
process.on('uncaughtException',  (err)    => fatal('uncaughtException', err));
process.on('unhandledRejection', (reason) => fatal('unhandledRejection', reason));

const app = express();
const server = http.createServer(app);
const { initSocket } = require('./services/socket');
const { startPolling } = require('./services/polling');

// Initialize Socket.IO
initSocket(server);

// Start Database Polling
startPolling();

// FR-029 — start integration outbox worker
require('./services/outbox').startWorker();

// TruckScale pull/sync worker — ดึงข้อมูลชั่งกลับเข้า wf.WeighInbox
require('./services/truckscale-sync').startSync();
// CORS — supports comma-separated origins or '*'
// Set CORS_ORIGIN in env, e.g.: https://winspeed-connect.vercel.app,http://localhost:5173
const rawOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
const isWildcard = rawOrigins.includes('*');

const corsOptions = {
  origin: isWildcard ? true : rawOrigins,  // true = reflect request origin (for credentials)
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-DB-Target'],
  credentials: true,
  optionsSuccessStatus: 200, // some legacy browsers choke on 204
};
app.use(cors(corsOptions));

// ── Security headers (P1) ─────────────────────────────────────
// API ล้วน ไม่ serve HTML → ปิด CSP/COEP ที่ไม่จำเป็น เพื่อไม่บล็อก cross-origin frontend
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// LINE webhook ต้องใช้ raw body (verify signature) — ต้องมาก่อน express.json
app.use('/api/line/webhook', express.raw({ type: '*/*' }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(require('path').join(__dirname, 'uploads')));

// ── Observability (FR-030) — นับ request/error + telemetry ─────
const obs = require('./services/observability');
app.use(obs.requestTimer);

// ── Rate limiting (P1) ────────────────────────────────────────
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000, max: 2000,
  standardHeaders: true, legacyHeaders: false,
  message: { message: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่' },
}));
app.use('/api/auth/line/link', rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { message: 'พยายามผูก LINE บ่อยเกินไป กรุณารอสักครู่' },
}));

// ── DB target switch (per-request) ────────────────────────────
// frontend (ADMIN) ส่ง header X-DB-Target: local|remote → เลือก pool
const { runWithTarget, getTarget, DEFAULT_TARGET } = require('./db');
app.use((req, res, next) => {
  const t = String(req.headers['x-db-target'] || '').toLowerCase();
  if (t === 'remote' || t === 'local') return runWithTarget(t, next);
  return next();
});
app.get('/api/dbinfo', (req, res) => res.json({ target: getTarget(), default: DEFAULT_TARGET }));
app.use(require('./middleware/apiAudit')());

// ── Global Param Validator ────────────────────────────────────
app.use((req, res, next) => {
  const hasInvalidPath = req.path.includes('/undefined') || req.path.includes('/NaN') || req.path.includes('/null');
  const hasInvalidQuery = Object.values(req.query).some(v => v === 'undefined' || v === 'null' || v === 'NaN');
  
  if (hasInvalidPath || hasInvalidQuery) {
    console.warn(`[Blocked] Invalid parameters: ${req.method} ${req.originalUrl}`);
    return res.status(400).json({ message: 'Invalid URL parameter or query (undefined/NaN/null)' });
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/master', require('./routes/master'));
app.use('/api/so',     require('./routes/so'));
app.use('/api/rebate', require('./routes/rebate'));
app.use('/api/giveaway', require('./routes/giveaway'));
app.use('/api/quotation', require('./routes/quotation'));
app.use('/api/papertrail', require('./routes/papertrail'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/truckscale', require('./routes/truckscale'));
app.use('/api/recon', require('./routes/recon'));
app.use('/api/ops', require('./routes/ops'));
app.use('/api/policy', require('./routes/policy'));
app.use('/api/pricebook', require('./routes/pricebook'));
app.use('/api/credit', require('./routes/credit'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/pdpa', require('./routes/pdpa'));
app.use('/api/line', require('./routes/line').router);

// ── Health check ──────────────────────────────────────────────
// คืน 200 เสมอถ้า backend ยังตอบได้ (docker healthcheck) · แนบสถานะ DB เพื่อ monitor
app.get('/api/health', async (req, res) => {
  const st = obs.getStatus();
  const out = {
    ok: true, ts: new Date().toISOString(),
    version: st.version, env: st.env, uptimeSec: st.uptimeSec,
    requests: st.requests, errors: st.errors, lastErrorAt: st.lastErrorAt,
    db: { sqlserver: 'unknown', mysql: 'unknown' },
  };
  try {
    const { query } = require('./db');
    await query('SELECT 1 AS ok');
    out.db.sqlserver = 'up';
  } catch { out.db.sqlserver = 'down'; }
  try {
    const { getPool, tsQuery } = require('./services/truckscale-db');
    if (!getPool()) out.db.mysql = 'not-configured';
    else { await tsQuery('SELECT 1 AS ok'); out.db.mysql = 'up'; }
  } catch { out.db.mysql = 'down'; }
  res.json(out);
});

// ── Migrate / setup wf schema (DEV only) ─────────────────────
// POST /api/admin/migrate  — รัน DDL สร้าง schema wf
// ⚠ ต้อง wf_owner password ถูกต้อง และต้องยืนยันจากผู้ดูแลระบบก่อนเสมอ
app.post('/api/admin/migrate', async (req, res) => {
  if (process.env.NODE_ENV === 'production')
    return res.status(403).json({ message: 'Disabled in production — run migration manually' });
  const { secret } = req.body;
  if (secret !== process.env.MIGRATE_SECRET)
    return res.status(403).json({ message: 'migrate secret ไม่ถูกต้อง' });
  try {
    const fs = require('fs');
    const path = require('path');
    const { ownerPool } = require('./db');
    const ddl = fs.readFileSync(path.join(__dirname, 'migrations', '001_wf_schema.sql'), 'utf8');
    // split by GO statements
    const batches = ddl.split(/^\s*GO\s*$/im).filter(b => b.trim());
    for (const batch of batches) {
      await ownerPool.request().query(batch);
    }
    res.json({ ok: true, batches: batches.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  obs.recordError({
    level: 'ERROR', source: 'express', message: err.message || 'Internal server error',
    detail: err.stack, method: req.method, path: req.originalUrl, status, userId: req.user?.sub,
  });
  res.locals.__obsLogged = true;   // กัน requestTimer บันทึกซ้ำ
  res.status(status).json({ message: err.message || 'Internal server error' });
});

// Keepalive timer — prevents event loop from draining if all async work resolves
const _keepalive = setInterval(() => {}, 30000);
_keepalive.unref(); // don't block graceful shutdown

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 WS-Sale-App API listening on :${PORT}`);
  obs.releaseSignal();
});
