/**
 * ops.js — FR-030 Ops dashboard (ADMIN)
 * status / recent errors / test alert · อ่าน wf.ErrorLog + in-memory telemetry
 */
const router = require('express').Router();
const { query, wfQuery } = require('../db');
const { getPool, tsQuery } = require('../services/truckscale-db');
const obs = require('../services/observability');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('ADMIN', 'MANAGER'));

// GET /api/ops/status — telemetry + DB health รวม
router.get('/status', async (req, res) => {
  const db = { sqlserver: 'unknown', mysql: 'unknown' };
  try { await query('SELECT 1 AS ok'); db.sqlserver = 'up'; } catch { db.sqlserver = 'down'; }
  try {
    if (!getPool()) db.mysql = 'not-configured';
    else { await tsQuery('SELECT 1 AS ok'); db.mysql = 'up'; }
  } catch { db.mysql = 'down'; }
  res.json({ ...obs.getStatus(), db });
});

// GET /api/ops/errors?limit= — error log ถาวร (fallback in-memory)
router.get('/errors', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const r = await wfQuery(
      `SELECT TOP (${limit}) Id, OccurredAt, Level, Source, Message, ReqMethod, ReqPath, StatusCode, UserId, AppVersion
       FROM wf.ErrorLog ORDER BY OccurredAt DESC`);
    res.json({ source: 'db', errors: r.recordset || [] });
  } catch {
    res.json({ source: 'memory', errors: obs.getRecentErrors(limit) });
  }
});

// POST /api/ops/test-alert — ทดสอบ webhook (ADMIN)
router.post('/test-alert', requireRole('ADMIN'), async (req, res) => {
  if (!process.env.ALERT_WEBHOOK_URL)
    return res.status(400).json({ ok: false, message: 'ยังไม่ได้ตั้ง ALERT_WEBHOOK_URL' });
  // bypass rate-limit ด้วย key ไม่ซ้ำ
  await obs.alert(`ทดสอบการแจ้งเตือนโดย ${req.user.displayName || req.user.username}`, `test:${Date.now()}`, 'info');
  res.json({ ok: true, message: 'ส่งการแจ้งเตือนทดสอบแล้ว' });
});

module.exports = router;
