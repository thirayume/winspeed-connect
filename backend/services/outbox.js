/**
 * outbox.js — FR-029 Integration outbox (reliable event)
 *   enqueue()    — เรียกจาก business path (confirm/ship/claim) — fail-safe ไม่โยน throw
 *   processOnce()— worker หยิบ PENDING → handle → DONE | retry (สูงสุด 5 ครั้ง → FAILED)
 *   startWorker()— poll ทุก 10 วินาที
 * handler ปัจจุบัน = broadcast socket + log (จุดต่อ external integration ภายหลัง)
 */
const { sql, wfQuery } = require('../db');

const MAX_RETRY = 5;

async function enqueue(eventType, aggregateId, payload, idempotencyKey = null) {
  try {
    await wfQuery(`
      INSERT INTO wf.OutboxEvent (EventType, AggregateId, Payload, IdempotencyKey)
      VALUES (@t, @a, @p, @k)`,
      {
        t: { type: sql.NVarChar(60),  value: eventType },
        a: { type: sql.NVarChar(60),  value: aggregateId != null ? String(aggregateId) : null },
        p: { type: sql.NVarChar(sql.MAX), value: payload ? JSON.stringify(payload) : null },
        k: { type: sql.NVarChar(120), value: idempotencyKey },
      });
  } catch (e) {
    // 2601/2627 = duplicate idempotency key → ถือว่า enqueue ไปแล้ว (idempotent)
    const code = e?.number ?? e?.originalError?.code;
    if (code !== 2601 && code !== 2627) console.error('[outbox] enqueue failed:', e.message);
  }
}

async function handle(ev) {
  // จุดต่อ delivery จริง (เช่น webhook/queue) — ปัจจุบัน broadcast + log
  try {
    const { broadcast } = require('./socket');
    broadcast('outbox_event', { type: ev.EventType, aggregateId: ev.AggregateId });
  } catch { /* socket optional */ }
}

async function processOnce() {
  let batch;
  try {
    batch = (await wfQuery(`
      SELECT TOP 10 Id, EventType, AggregateId, Payload, RetryCount
      FROM wf.OutboxEvent WHERE Status = 'PENDING' ORDER BY CreatedAt`)).recordset || [];
  } catch { return; }   // ตาราง/DB ไม่พร้อม → ข้ามรอบนี้

  for (const ev of batch) {
    try {
      await wfQuery(`UPDATE wf.OutboxEvent SET Status='PROCESSING' WHERE Id=@id`,
        { id: { type: sql.Int, value: ev.Id } });
      await handle(ev);
      await wfQuery(`UPDATE wf.OutboxEvent SET Status='DONE', ProcessedAt=GETUTCDATE() WHERE Id=@id`,
        { id: { type: sql.Int, value: ev.Id } });
    } catch (e) {
      const retry = (ev.RetryCount || 0) + 1;
      const status = retry >= MAX_RETRY ? 'FAILED' : 'PENDING';
      await wfQuery(`UPDATE wf.OutboxEvent SET Status=@s, RetryCount=@r, LastError=@e WHERE Id=@id`, {
        s: { type: sql.NVarChar(20), value: status },
        r: { type: sql.Int, value: retry },
        e: { type: sql.NVarChar(1000), value: (e.message || '').slice(0, 1000) },
        id:{ type: sql.Int, value: ev.Id },
      }).catch(() => {});
    }
  }
}

function startWorker() {
  const t = setInterval(() => { processOnce().catch(() => {}); }, 10000);
  t.unref();
  console.log('[outbox] worker started (poll 10s)');
}

module.exports = { enqueue, processOnce, startWorker };
