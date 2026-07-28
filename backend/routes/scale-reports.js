/**
 * scale-reports.js — รายงานเครื่องชั่งบนเว็บ (T6-02)
 *
 * แทนการเปิดโปรแกรม Crystal Reports เดิม 4 ฉบับที่ใช้บ่อยที่สุด
 *   by-date      สรุปตามวัน            (Report_ByDate)
 *   by-product   สรุปตามสูตรปุ๋ย        (Report_ByProductGroup)
 *   by-movebill  สรุปตามเที่ยว          (ReportByMoveBillGroup)
 *   by-godown    สรุปตามคลัง/โกดัง      (Report_ByGodownGroup)
 *
 * ⚠ อ่านอย่างเดียว ไม่มีคำสั่งเขียนในไฟล์นี้
 *
 * การกรองวันที่ต้องใช้ Date_Out2 ซึ่งเป็น OLE date serial (จำนวนเต็ม) เท่านั้น
 * Date_Out เป็น varchar รูปแบบ DD/MM/YYYY ปี พ.ศ. เรียงลำดับและเทียบช่วงไม่ได้
 */
const router = require('express').Router();
const { tsQuery, getPool } = require('../services/truckscale-db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireRole('ACCOUNTING', 'MANAGER', 'ADMIN', 'C_LEVEL', 'WAREHOUSE', 'WEIGHBRIDGE'));

/** วันที่ ค.ศ. (YYYY-MM-DD) → OLE date serial ที่ tblscale ใช้ใน Date_Out2 */
function oleSerial(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

/** ช่วงวันที่จาก query — ค่าเริ่มต้นคือ 30 วันล่าสุด เพื่อไม่ให้เผลอสแกนทั้งตาราง */
function range(req) {
  const today = new Date();
  const back = new Date(today.getTime() - 30 * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const from = oleSerial(req.query.from || iso(back));
  const to = oleSerial(req.query.to || iso(today));
  if (from == null || to == null) throw Object.assign(new Error('รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)'), { status: 400 });
  if (to < from) throw Object.assign(new Error('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น'), { status: 400 });
  return { from, to };
}

// เฉพาะใบที่ชั่งออกเสร็จแล้ว ใบที่ยังเปิดค้างไม่ควรนับเป็นยอดขน
const DONE = `s.weight_out > 0 AND s.Date_Out2 BETWEEN ? AND ?`;
const LIMIT = 500;

const send = (res, rows, meta) => res.json({ rows, count: rows.length, ...meta });

function guard(handler) {
  return async (req, res) => {
    if (!getPool()) return res.status(503).json({ message: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานเครื่องชั่ง' });
    try { await handler(req, res); }
    catch (e) { res.status(e.status || 500).json({ message: e.message }); }
  };
}

// GET /api/scale-reports/by-date — สรุปตามวัน
router.get('/by-date', guard(async (req, res) => {
  const { from, to } = range(req);
  const rows = await tsQuery(`
    SELECT s.Date_Out AS DateOut, s.Date_Out2 AS DateSerial,
           COUNT(*) AS Trips,
           SUM(s.weight_net) AS NetKg,
           SUM(CASE WHEN s.sequence LIKE 'WF%' THEN 1 ELSE 0 END) AS FromApp
    FROM tblscale s
    WHERE ${DONE}
    GROUP BY s.Date_Out, s.Date_Out2
    ORDER BY s.Date_Out2 DESC
    LIMIT ${LIMIT}`, [from, to]);
  send(res, rows, { from, to });
}));

// GET /api/scale-reports/by-product — สรุปตามสูตรปุ๋ย
// ต้อง join tblproduct_detail เพราะหัวบิลไม่มีสูตร — ข้อมูลนี้เพิ่งครบหลัง T6-01
router.get('/by-product', guard(async (req, res) => {
  const { from, to } = range(req);
  const rows = await tsQuery(`
    SELECT d.pd_pro_name AS Formula,
           COUNT(DISTINCT s.s_id) AS Trips,
           SUM(d.pd_pro_wantWeight) AS Tons,
           SUM(d.pd_pro_bag) AS Bags
    FROM tblscale s
    JOIN tblproduct_detail d ON d.one_num = s.one_num AND s.one_num <> 0
    WHERE ${DONE}
    GROUP BY d.pd_pro_name
    ORDER BY Tons DESC
    LIMIT ${LIMIT}`, [from, to]);
  send(res, rows, { from, to });
}));

// GET /api/scale-reports/by-movebill — สรุปตามเที่ยว
router.get('/by-movebill', guard(async (req, res) => {
  const { from, to } = range(req);
  const rows = await tsQuery(`
    SELECT s.movebill AS Movebill, s.sequence AS Sequence, s.one_car_regis AS Plate,
           s.one_cus_name AS CustName, s.Date_Out AS DateOut, s.one_num AS OneNum,
           s.weight_in AS InKg, s.weight_out AS OutKg, s.weight_net AS NetKg
    FROM tblscale s
    WHERE ${DONE}
    ORDER BY s.Date_Out2 DESC, s.s_id DESC
    LIMIT ${LIMIT}`, [from, to]);

  // นับรายการย่อยแยกเป็นอีกคิวรีเดียวที่จำกัดเฉพาะเที่ยวที่จะแสดง
  // เดิมใช้ subquery ต่อแถว ซึ่งวิ่งบน tblproduct_detail 550,000 แถวที่ไม่มี index
  // ที่ one_num จึงหมดเวลาทุกครั้ง — ไม่แตะ schema ของโรงงานเพื่อเพิ่ม index
  const nums = [...new Set(rows.map(r => Number(r.OneNum)).filter(n => n > 0))];
  if (nums.length) {
    const counts = await tsQuery(
      `SELECT one_num, COUNT(*) AS n FROM tblproduct_detail
       WHERE one_num IN (${nums.map(() => '?').join(',')}) GROUP BY one_num`, nums);
    const byNum = new Map(counts.map(c => [Number(c.one_num), Number(c.n)]));
    for (const r of rows) r.ProductLines = byNum.get(Number(r.OneNum)) || 0;
  } else {
    for (const r of rows) r.ProductLines = 0;
  }
  send(res, rows, { from, to });
}));

// GET /api/scale-reports/by-godown — สรุปตามคลัง/โกดัง
router.get('/by-godown', guard(async (req, res) => {
  const { from, to } = range(req);
  const rows = await tsQuery(`
    SELECT COALESCE(NULLIF(d.pd_pro_Godown, ''), '-') AS Godown,
           COALESCE(NULLIF(d.pd_code_godown, ''), '-') AS GodownCode,
           COUNT(DISTINCT s.s_id) AS Trips,
           SUM(d.pd_pro_wantWeight) AS Tons
    FROM tblscale s
    JOIN tblproduct_detail d ON d.one_num = s.one_num AND s.one_num <> 0
    WHERE ${DONE}
    GROUP BY COALESCE(NULLIF(d.pd_pro_Godown, ''), '-'), COALESCE(NULLIF(d.pd_code_godown, ''), '-')
    ORDER BY Tons DESC
    LIMIT ${LIMIT}`, [from, to]);
  send(res, rows, { from, to });
}));

module.exports = router;
