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
const { requireAuth } = require('../middleware/auth');

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

// GET /api/truckscale/for-so/:soId — หาน้ำหนักชั่งที่ match SO (ด้วยทะเบียนรถ)
router.get('/for-so/:soId', async (req, res) => {
  try {
    const so = (await wfQuery(`SELECT TOP 1 Id, WfRef, TruckPlate, CustName FROM wf.v_AllSalesOrders WHERE Id=@id`,
      { id: { type: sql.VarChar(50), value: String(req.params.soId) } })).recordset[0];
    if (!so) return res.status(404).json({ message: 'ไม่พบ SO' });
    if (!so.TruckPlate) return res.json({ so, candidates: [], note: 'SO ไม่มีทะเบียนรถ' });
    // ดึงเลขทะเบียนหลัก (ตัดช่องว่าง) → match แบบ LIKE
    const plate = String(so.TruckPlate).trim();
    const candidates = await tsQuery(
      `SELECT ${SCALE_COLS} FROM tblscale WHERE one_car_regis LIKE ? AND weight_net > 0 ORDER BY s_id DESC LIMIT 20`,
      [`%${plate}%`]);
    res.json({ so, candidates });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

module.exports = router;
