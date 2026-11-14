/**
 * ops.js — FR-030 Ops dashboard (ADMIN)
 * status / recent errors / test alert · อ่าน wf.ErrorLog + in-memory telemetry
 */
const router = require('express').Router();
const { sql, query, wfQuery } = require('../db');
const obs = require('../services/observability');
const { requireAuth, requireRole } = require('../middleware/auth');
const { readGlobalDataWindow } = require('../services/global-data-window-store');
const { isValidStartDate } = require('../services/data-window');
const { getBangkokDateString } = require('../services/so-pickup-policy');

router.use(requireAuth, requireRole('ADMIN', 'MANAGER', 'C_LEVEL'));

// GET /api/ops/status — telemetry + DB health รวม
router.get('/status', async (req, res) => {
  // MySQL ถูกลบออกถาวรเมื่อ 04/09/2569 · แหล่งข้อมูลการชั่งคือ dbo.WGHD เท่านั้น
  const db = { sqlserver: 'unknown' };
  try { await query('SELECT 1 AS ok'); db.sqlserver = 'up'; } catch { db.sqlserver = 'down'; }
  db.weighing = db.sqlserver === 'up' ? 'winspeed:WGHD' : 'unknown';
  res.json({ ...obs.getStatus(), db });
});

// GET /api/ops/errors?limit= — error log ถาวร (fallback in-memory)
router.get('/errors', async (req, res) => {
  const limit = Math.min(Math.max(1, Math.trunc(Number(req.query.limit) || 50)), 200);
  let window;
  try { window = await readGlobalDataWindow(); }
  catch { return res.status(503).json({ code: 'DATA_WINDOW_UNAVAILABLE', message: 'ไม่สามารถตรวจวันเริ่มข้อมูลได้' }); }
  try {
    const r = await wfQuery(
      `SELECT TOP (${limit}) Id, OccurredAt, Level, Source, Message, ReqMethod, ReqPath, StatusCode, UserId, AppVersion
       FROM wf.ErrorLog WHERE OccurredAt >= @globalStartUtc ORDER BY OccurredAt DESC`,
      { globalStartUtc: { type: sql.DateTime2, value: window.utcInstant } });
    res.json({ source: 'db', errors: r.recordset || [] });
  } catch {
    const start = window.utcInstant.getTime();
    const errors = obs.getRecentErrors(100).filter(entry => {
      const at = Date.parse(entry.at);
      return Number.isFinite(at) && at >= start;
    }).slice(0, limit);
    res.json({ source: 'memory', errors });
  }
});

// GET /api/ops/outbox — สรุป + รายการล่าสุดของ integration outbox (FR-029)
router.get('/outbox', async (req, res) => {
  let window;
  try { window = await readGlobalDataWindow(); }
  catch { return res.status(503).json({ code: 'DATA_WINDOW_UNAVAILABLE', message: 'ไม่สามารถตรวจวันเริ่มข้อมูลได้' }); }
  try {
    // The summary must retain older pending/failed work; only history is
    // bounded. The worker and underlying events are not altered.
    const summary = (await wfQuery(`SELECT Status, COUNT(*) AS n FROM wf.OutboxEvent GROUP BY Status`)).recordset || [];
    const recent = (await wfQuery(`SELECT TOP 30 Id, EventType, AggregateId, Status, RetryCount, LastError, CreatedAt, ProcessedAt
                                   FROM wf.OutboxEvent WHERE CreatedAt >= @globalStartUtc ORDER BY Id DESC`,
      { globalStartUtc: { type: sql.DateTime2, value: window.utcInstant } })).recordset || [];
    res.json({ summary, recent });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/ops/user-activity?date= — สถิติการใช้งานและ concurrency ราย 15 นาที
router.get('/user-activity', async (req, res) => {
  let window;
  try { window = await readGlobalDataWindow(); }
  catch { return res.status(503).json({ code: 'DATA_WINDOW_UNAVAILABLE', message: 'ไม่สามารถตรวจวันเริ่มข้อมูลได้' }); }
  try {
    const date = req.query.date == null ? getBangkokDateString() : String(req.query.date);
    if (!isValidStartDate(date)) return res.status(400).json({ code: 'INVALID_ACTIVITY_DATE' });
    if (date < window.businessDate) return res.status(400).json({ code: 'BEFORE_DATA_START' });
    const activity = await obs.getUserActivity(date);
    res.json(activity);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST /api/ops/errors/clear — เคลียร์ประวัติ Error Log (ADMIN)
router.post('/errors/clear', requireRole('ADMIN'), async (req, res) => {
  try {
    const r = await obs.clearErrors();
    res.json(r);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST /api/ops/sync-users — ซิงค์ผู้ใช้และบทบาทไปยังฐานข้อมูลปลายทาง (ADMIN)
router.post('/sync-users', requireRole('ADMIN'), async (req, res) => {
  try {
    const { syncUsersToTarget } = require('../services/user-sync');
    const result = await syncUsersToTarget(req.body?.targetDb);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ code: e.code, message: e.message });
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
