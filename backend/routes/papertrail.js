/**
 * papertrail.js — Kanban ติดตามเอกสาร SO ข้าม 5 สถานะ
 * อ่านจาก wf.SalesOrder (advance ใช้ endpoint /so/:id/* เดิม)
 * ⚠ READ-only ที่นี่ (เขียนสถานะผ่าน so.js)
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const STAGES = ['DRAFT', 'CONFIRMED', 'PICKING', 'SHIPPED'];

// GET /api/papertrail/board — SO จัดกลุ่มตามสถานะ + ยอดรวม/ตัน
router.get('/board', async (req, res) => {
  try {
    const r = await wfQuery(`
      WITH RankedSO AS (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY Status ORDER BY CreatedAt DESC, Id DESC) as RN
        FROM wf.v_AllSalesOrders
        WHERE Status IN ('DRAFT', 'CONFIRMED', 'PICKING')
           OR (Status = 'SHIPPED' AND CreatedAt >= DATEADD(day, -3, GETDATE()))
      ),
      ActiveSO AS (
        SELECT * FROM RankedSO WHERE RN <= 100
      )
      SELECT so.Id, so.WfRef, so.CustName, so.Status, so.TruckPlate, so.ControlTicketNo,
             so.ImportedDocuNo, so.CreatedAt, u.DisplayName AS SalesName,
             SUM(CASE WHEN l.IsGiveaway=0 THEN l.QtyTon ELSE 0 END) AS QtyTon,
             COUNT(l.SoId) AS LineCnt
      FROM ActiveSO so
      LEFT JOIN wf.AppUser u ON u.Id = so.SalesUserId
      LEFT JOIN wf.v_AllSalesOrderLines l ON l.SoId = so.Id
      GROUP BY so.Id, so.WfRef, so.CustName, so.Status, so.TruckPlate, so.ControlTicketNo,
               so.ImportedDocuNo, so.CreatedAt, u.DisplayName
      ORDER BY so.CreatedAt DESC
    `);
    const board = {};
    for (const st of STAGES) board[st] = [];
    for (const row of r.recordset || []) {
      const card = {
        id: row.Id, wfRef: row.WfRef, custName: row.CustName, status: row.Status,
        truckPlate: row.TruckPlate, controlTicketNo: row.ControlTicketNo,
        importedDocuNo: row.ImportedDocuNo, createdAt: row.CreatedAt,
        salesName: row.SalesName, qtyTon: row.QtyTon, lineCnt: row.LineCnt,
        daysOpen: row.CreatedAt ? Math.floor((Date.now() - new Date(row.CreatedAt).getTime()) / 86400000) : 0,
      };
      (board[row.Status] ||= []).push(card);
    }
    res.json({ stages: STAGES, board });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
