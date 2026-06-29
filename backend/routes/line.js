/**
 * line.js — FR-016 LINE intake / notify (scaffold, gated by env)
 *   - POST /webhook : รับ event จาก LINE (verify signature ด้วย LINE_CHANNEL_SECRET)
 *   - POST /notify  : push ข้อความผ่าน LINE Messaging API (LINE_CHANNEL_ACCESS_TOKEN)
 *   ต้องตั้ง channel จริงก่อนใช้งานเต็มรูป · ถ้าไม่ตั้ง env → endpoints ตอบ not-configured
 * webhook ใช้ raw body (ตั้ง express.raw ที่ server.js ก่อน express.json)
 */
const router = require('express').Router();
const crypto = require('crypto');
const { enqueue } = require('../services/outbox');
const { requireAuth } = require('../middleware/auth');

// POST /api/line/webhook — req.body = Buffer (raw)
router.post('/webhook', async (req, res) => {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return res.status(200).json({ ok: true, note: 'LINE not configured' });
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const sig = crypto.createHmac('sha256', secret).update(raw).digest('base64');
    if (sig !== req.headers['x-line-signature']) return res.status(401).json({ message: 'invalid signature' });
    const body = JSON.parse(raw.toString('utf8') || '{}');
    for (const ev of body.events || []) {
      await enqueue('LINE_INBOUND', ev.source?.userId || null, ev, ev.webhookEventId || null);
    }
    res.json({ ok: true });
  } catch (e) { console.error('[line] webhook', e.message); res.status(200).json({ ok: false }); }
});

// helper push
async function pushLine(to, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw Object.assign(new Error('LINE_CHANNEL_ACCESS_TOKEN ยังไม่ตั้งค่า'), { status: 400 });
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
  });
  if (!r.ok) throw new Error(`LINE push failed: ${r.status} ${await r.text().catch(() => '')}`);
}

// POST /api/line/notify  { to, text } (auth)
router.post('/notify', requireAuth, async (req, res) => {
  try {
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ message: 'to และ text จำเป็น' });
    await pushLine(to, text);
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// GET /api/line/status — สถานะการตั้งค่า (auth)
router.get('/status', requireAuth, (req, res) => res.json({
  webhookConfigured: !!process.env.LINE_CHANNEL_SECRET,
  pushConfigured: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
}));

module.exports = { router, pushLine };
