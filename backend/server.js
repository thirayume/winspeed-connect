/**
 * WS-Sale-App — Express API Server
 * ─────────────────────────────────────────────────────────────────
 * ⚠ IRON RULES:
 *   1. dbo = READ-ONLY — ห้าม CREATE/ALTER/DROP/INSERT/UPDATE/DELETE บน dbo เด็ดขาด
 *   2. เขียนได้เฉพาะ schema wf เท่านั้น
 *   3. ก่อนรัน query ที่ไม่ใช่ SELECT ต้องถามยืนยัน (ทำในส่วน UI)
 * ─────────────────────────────────────────────────────────────────
 */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const http = require('http');

const app = express();
const server = http.createServer(app);
const { initSocket } = require('./services/socket');
const { startPolling } = require('./services/polling');

// Initialize Socket.IO
initSocket(server);

// Start Database Polling
startPolling();
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


app.use(express.json({ limit: '2mb' }));

// ── DB target switch (per-request) ────────────────────────────
// frontend (ADMIN) ส่ง header X-DB-Target: local|remote → เลือก pool
const { runWithTarget, getTarget, DEFAULT_TARGET } = require('./db');
app.use((req, res, next) => {
  const t = String(req.headers['x-db-target'] || '').toLowerCase();
  if (t === 'remote' || t === 'local') return runWithTarget(t, next);
  return next();
});
app.get('/api/dbinfo', (req, res) => res.json({ target: getTarget(), default: DEFAULT_TARGET }));

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/master', require('./routes/master'));
app.use('/api/so',     require('./routes/so'));
app.use('/api/rebate', require('./routes/rebate'));
app.use('/api/giveaway', require('./routes/giveaway'));
app.use('/api/quotation', require('./routes/quotation'));
app.use('/api/papertrail', require('./routes/papertrail'));

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

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
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 WS-Sale-App API listening on :${PORT}`));
