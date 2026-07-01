/**
 * reports.js — รายงาน + export Excel (FR-017)
 *  - GET /api/reports/types           → รายการรายงาน
 *  - GET /api/reports/:type           → { title, columns, rows }
 *  - GET /api/reports/:type/export    → ไฟล์ .xlsx
 * อ่านอย่างเดียว (wf views/tables + dbo ผ่าน wfQuery → ตามปุ่มสลับ DB)
 */
const router = require('express').Router();
const XLSX = require('xlsx');
const { wfQuery } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// นิยามรายงาน: key → { title, columns:[{key,label}], sql }
const REPORTS = {
  'so-status': {
    title: 'สรุปใบสั่งขายตามสถานะ',
    columns: [{ key: 'Status', label: 'สถานะ' }, { key: 'Cnt', label: 'จำนวน' }],
    sql: `SELECT Status, COUNT(*) AS Cnt FROM wf.v_AllSalesOrders GROUP BY Status ORDER BY Cnt DESC`,
  },
  'rebate-pools': {
    title: 'Rebate Pool ต่อพนักงานขาย',
    columns: [
      { key: 'SalesName', label: 'พนักงานขาย' }, { key: 'Period', label: 'งวด' },
      { key: 'AllocatedAmt', label: 'จัดสรร' }, { key: 'AccruedAmt', label: 'สะสม' },
      { key: 'ClaimedAmt', label: 'เคลมแล้ว' }, { key: 'Available', label: 'คงเหลือ' },
    ],
    sql: `SELECT u.DisplayName AS SalesName,
                 CAST(p.PeriodMonth AS VARCHAR)+'/'+CAST(p.PeriodYear AS VARCHAR) AS Period,
                 p.AllocatedAmt, p.AccruedAmt, p.ClaimedAmt,
                 (p.AccruedAmt - p.ClaimedAmt) AS Available
          FROM wf.RebatePool p JOIN wf.AppUser u ON u.Id = p.SalesUserId
          WHERE (p.AccruedAmt > 0 OR p.ClaimedAmt > 0)
          ORDER BY p.PeriodYear DESC, p.PeriodMonth DESC, Available DESC`,
  },
  'giveaway': {
    title: 'ของแถม — งบ/เบิก/คงเหลือ รายภาค',
    columns: [
      { key: 'Region', label: 'ภาค' }, { key: 'Brand', label: 'ตรา' }, { key: 'ItemName', label: 'รายการ' },
      { key: 'BudgetQty', label: 'งบ' }, { key: 'WithdrawnQty', label: 'เบิกแล้ว' }, { key: 'RemainingQty', label: 'คงเหลือ' },
    ],
    sql: `SELECT Region, Brand, ItemName, BudgetQty, WithdrawnQty, RemainingQty
          FROM wf.v_GiveawayBudgetStatus ORDER BY Region, Brand, ItemName`,
  },
  'paper-status': {
    title: 'สถานะเอกสาร (Paper Trail)',
    columns: [{ key: 'Status', label: 'สถานะ' }, { key: 'Cnt', label: 'จำนวนสำเนา' }],
    sql: `SELECT Status, COUNT(*) AS Cnt FROM wf.PaperCopy GROUP BY Status ORDER BY Cnt DESC`,
  },
  'cn-rebate': {
    title: 'CN รีเบท ที่ออกแล้ว (Winspeed)',
    columns: [
      { key: 'SalesName', label: 'พนักงานขาย' }, { key: 'CNCount', label: 'จำนวน CN' },
      { key: 'CustCount', label: 'ลูกค้า' }, { key: 'TotalRebate', label: 'รวมรีเบท (฿)' },
    ],
    sql: `SELECT ISNULL(e.EmpName, CAST(cn.EmpID AS NVARCHAR(20))) AS SalesName,
                 COUNT(DISTINCT cn.SOInvID) AS CNCount, COUNT(DISTINCT cn.CustID) AS CustCount,
                 SUM(d.GoodAmnt) AS TotalRebate
          FROM dbo.SOInvHD cn JOIN dbo.SOInvDT d ON d.SOInvID = cn.SOInvID
          LEFT JOIN dbo.EMEmp e ON e.EmpID = cn.EmpID
          WHERE cn.Docutype = 109 AND cn.CNRemarkTypeID IN (6001, 1001)
          GROUP BY cn.EmpID, e.EmpName ORDER BY TotalRebate DESC`,
  },
};

router.get('/types', (req, res) => {
  res.json(Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title })));
});

async function runReport(type) {
  const def = REPORTS[type];
  if (!def) return null;
  const r = await wfQuery(def.sql);
  return { type, title: def.title, columns: def.columns, rows: r.recordset || [] };
}

router.get('/:type', async (req, res) => {
  try {
    const data = await runReport(req.params.type);
    if (!data) return res.status(404).json({ message: 'ไม่พบรายงาน' });
    res.json(data);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

router.get('/:type/export', async (req, res) => {
  try {
    const data = await runReport(req.params.type);
    if (!data) return res.status(404).json({ message: 'ไม่พบรายงาน' });
    // map rows → ภาษาไทย header ตาม columns
    const aoa = [data.columns.map(c => c.label)];
    for (const row of data.rows) aoa.push(data.columns.map(c => row[c.key] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fname = `${data.type}_${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(buf);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

module.exports = router;
