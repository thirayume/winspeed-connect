/**
 * truckscale.js — เชื่อม TruckScale (MySQL) ↔ WINSpeed/App (FR-024/025/026)
 *   - lookup น้ำหนักชั่งจาก db_truckscale ด้วยทะเบียนรถ / movebill
 *   - match กับ SO (ใช้ทะเบียนรถ = key หลัก เพราะ pd_pro_invoid ไม่ reliable)
 *   - ดึงน้ำหนักมากรอก WeighTicket → ยืนยัน Shipped
 * READ-ONLY ต่อ TruckScale · เขียนเฉพาะ wf
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { tsQuery, getPool } = require('../services/truckscale-db');
const { syncOnce, upsertRow } = require('../services/truckscale-sync');
const { requireAuth, requireRole } = require('../middleware/auth');

// ── Push ingest (optional) — agent ฝั่งโรงงาน POST เข้ามา (shared secret, ไม่ต้อง login)
// วางก่อน requireAuth เพื่อให้ webhook/agent เรียกได้ด้วย header X-Ingest-Secret
router.post('/ingest', async (req, res) => {
  const secret = process.env.TS_INGEST_SECRET;
  if (!secret || req.headers['x-ingest-secret'] !== secret) return res.status(401).json({ message: 'invalid ingest secret' });
  try {
    const rows = Array.isArray(req.body) ? req.body : (req.body?.rows || []);
    let n = 0;
    for (const r of rows) { await upsertRow(r); n++; }
    res.json({ ok: true, ingested: n });
  } catch (e) { console.error('[ts ingest]', e.message); res.status(500).json({ message: e.message }); }
});

router.use(requireAuth);

const SCALE_COLS = `sequence AS Sequence, movebill AS Movebill, one_car_regis AS Plate,
  one_cus_name AS CustName, weight_in AS WeightIn, weight_out AS WeightOut, weight_net AS WeightNet,
  Date_In AS DateIn, Time_In AS TimeIn, Date_Out AS DateOut, Time_Out AS TimeOut,
  one_w_type AS WeighType, Computer_w AS ScaleNo, one_num AS OneNum, s_id AS Sid`;

// GET /api/truckscale/ping — สถานะการเชื่อมต่อ
router.get('/ping', async (req, res) => {
  try {
    if (!getPool()) return res.json({ ok: false, configured: false });
    const r = await tsQuery('SELECT COUNT(*) AS n FROM tblscale');
    const today = await tsQuery(`SELECT COUNT(*) AS n FROM tblscale WHERE weight_out > 0 AND Date_Out <> '0' AND Date_Out <> ''`);
    res.json({ ok: true, configured: true, totalWeighings: r[0].n, completed: today[0].n });
  } catch (e) { res.status(e.status || 500).json({ ok: false, message: e.message }); }
});

// GET /api/truckscale/weigh?plate=&movebill=&limit= — ค้นหารายการชั่ง
router.get('/weigh', async (req, res) => {
  try {
    const { plate, movebill, limit } = req.query;
    const lim = Math.min(Number(limit) || 50, 200);
    let where = '1=1', params = [];
    if (movebill) { where = 'movebill = ?'; params = [String(movebill).trim()]; }
    else if (plate) { where = 'one_car_regis LIKE ?'; params = [`%${String(plate).trim()}%`]; }
    else return res.status(400).json({ message: 'ต้องระบุ plate หรือ movebill' });
    const rows = await tsQuery(`SELECT ${SCALE_COLS} FROM tblscale WHERE ${where} ORDER BY s_id DESC LIMIT ${lim}`, params);
    res.json(rows);
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// GET /api/truckscale/scale/:sequence — รายละเอียดใบชั่ง + สินค้า
router.get('/scale/:sequence', async (req, res) => {
  try {
    const head = await tsQuery(`SELECT ${SCALE_COLS} FROM tblscale WHERE sequence = ? ORDER BY s_id DESC LIMIT 1`, [String(req.params.sequence).trim()]);
    if (!head.length) return res.status(404).json({ message: 'ไม่พบใบชั่ง' });
    const products = await tsQuery(
      `SELECT pd_pro_name AS GoodName, pd_pro_formula AS Brand, pd_pro_wantWeight AS WantWeightTon,
              pd_pro_bag AS Bag, pd_Destination AS Destination, one_type AS RecvType
       FROM tblproduct_detail WHERE one_num = ? ORDER BY pd_id`, [head[0].OneNum]);
    res.json({ ...head[0], products });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// GET /api/truckscale/for-so/:soId — หาน้ำหนักชั่งที่ match SO + ranking score (FR-025)
const normPlate = (s) => String(s || '').replace(/[\s-]/g, '').toLowerCase();
const firstToken = (s) => String(s || '').trim().split(/\s+/)[0] || '';

router.get('/for-so/:soId', async (req, res) => {
  try {
    const so = (await wfQuery(`SELECT TOP 1 Id, WfRef, TruckPlate, CustName,
        CONVERT(VARCHAR(10), ISNULL(DeliveryDate, CreatedAt), 120) AS RefDate
      FROM wf.v_AllSalesOrders WHERE Id=@id`,
      { id: { type: sql.VarChar(50), value: String(req.params.soId) } })).recordset[0];
    if (!so) return res.status(404).json({ message: 'ไม่พบ SO' });
    if (!so.TruckPlate) return res.json({ so, candidates: [], note: 'SO ไม่มีทะเบียนรถ' });

    const plate = String(so.TruckPlate).trim();
    const rows = await tsQuery(
      `SELECT ${SCALE_COLS} FROM tblscale WHERE one_car_regis LIKE ? AND weight_net > 0 ORDER BY s_id DESC LIMIT 30`,
      [`%${plate}%`]);

    // คำนวณ score + เหตุผล (evidence) ต่อ candidate
    const soPlate = normPlate(so.TruckPlate);
    const soCust = firstToken(so.CustName);
    const scored = rows.map(r => {
      let score = 0; const reasons = [];
      const cp = normPlate(r.Plate);
      if (cp && cp === soPlate) { score += 60; reasons.push('ทะเบียนตรงพอดี'); }
      else if (cp && (cp.includes(soPlate) || soPlate.includes(cp))) { score += 35; reasons.push('ทะเบียนใกล้เคียง'); }
      if (soCust && r.CustName && (String(r.CustName).includes(soCust) || soCust.includes(firstToken(r.CustName)))) {
        score += 25; reasons.push('ชื่อลูกค้าตรง');
      }
      if (so.RefDate && r.DateOut && String(r.DateOut).slice(0, 10) === so.RefDate) { score += 20; reasons.push('วันที่ชั่งตรงกับ SO'); }
      if (Number(r.WeightNet) > 0) { score += 15; reasons.push('มีน้ำหนักสุทธิ'); }
      return { ...r, matchScore: Math.min(score, 100), matchReasons: reasons };
    }).sort((a, b) => b.matchScore - a.matchScore);

    res.json({
      so, candidates: scored,
      bestSequence: scored[0]?.matchScore >= 60 ? scored[0].Sequence : null,
    });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── Inbox sync (pull) ─────────────────────────────────────────
// GET /api/truckscale/sync/status — watermark + สถิติ + จำนวน inbox
router.get('/sync/status', async (req, res) => {
  try {
    const wm = (await wfQuery(`SELECT LastSid, LastSyncAt, TotalIngested, LastError FROM wf.TruckScaleSync WHERE Id=1`)).recordset[0] || null;
    const counts = (await wfQuery(`SELECT Status, COUNT(*) AS n FROM wf.WeighInbox GROUP BY Status`)).recordset || [];
    const matched = (await wfQuery(`SELECT MatchStatus, COUNT(*) AS n FROM wf.WeighInbox WHERE Status='COMPLETED' GROUP BY MatchStatus`)).recordset || [];
    res.json({ watermark: wm, counts, matched, configured: !!getPool(), intervalMs: Number(process.env.TS_SYNC_INTERVAL_MS) || 60000 });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/truckscale/sync/run — รัน sync เดี๋ยวนี้ (ADMIN/MANAGER/WAREHOUSE)
router.post('/sync/run', requireRole('ADMIN', 'MANAGER', 'WAREHOUSE'), async (req, res) => {
  const r = await syncOnce();
  res.json(r);
});

// GET /api/truckscale/inbox?status=&match= — รายการ inbox
router.get('/inbox', async (req, res) => {
  try {
    const where = ['1=1']; const inp = {};
    if (req.query.status) { where.push('Status=@st'); inp.st = { type: sql.NVarChar(20), value: String(req.query.status) }; }
    if (req.query.match)  { where.push('MatchStatus=@ms'); inp.ms = { type: sql.NVarChar(20), value: String(req.query.match) }; }
    const r = await wfQuery(`SELECT TOP 200 Id, Sequence, Movebill, Plate, CustName, WeightIn, WeightOut, WeightNet,
        DateIn, DateOut, ScaleNo, Status, MatchedSoId, MatchStatus, IngestedAt, UpdatedAt
      FROM wf.WeighInbox WHERE ${where.join(' AND ')} ORDER BY UpdatedAt DESC`, inp);
    res.json(r.recordset || []);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/truckscale/inbox/:id/match/:soId — จับคู่ inbox กับ SO ด้วยมือ
router.post('/inbox/:id/match/:soId', requireRole('ADMIN', 'MANAGER', 'WAREHOUSE', 'COUNTER_SALES'), async (req, res) => {
  try {
    await wfQuery(`UPDATE wf.WeighInbox SET MatchedSoId=@so, MatchStatus='MATCHED', UpdatedAt=GETUTCDATE() WHERE Id=@id`, {
      so: { type: sql.NVarChar(50), value: String(req.params.soId) }, id: { type: sql.BigInt, value: Number(req.params.id) },
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = router;
