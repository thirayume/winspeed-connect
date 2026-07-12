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
const { requireAuth, canViewAllRebateAmounts } = require('../middleware/auth');

router.use(requireAuth);

// นิยามรายงาน: key → { title, columns:[{key,label}], sql }
const REPORTS = {
  'so-status': {
    title: 'สรุปใบสั่งขายตามสถานะ',
    columns: [{ key: 'Status', label: 'สถานะ' }, { key: 'Cnt', label: 'จำนวน' }],
    sql: `
      WITH WfDraft AS (
        SELECT Status, COUNT_BIG(*) AS Cnt
        FROM wf.SalesOrder WITH (NOLOCK)
        GROUP BY Status
      ),
      WinspeedBase AS (
        SELECT
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN ext.IsLoaded = 1 THEN 'LOADED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END AS Status,
          COUNT_BIG(*) AS Cnt
        FROM dbo.SOHD hd WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
          ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
        WHERE hd.DocuType IN (103, 104)
        GROUP BY
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN ext.IsLoaded = 1 THEN 'LOADED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END
      )
      SELECT Status, CAST(SUM(Cnt) AS INT) AS Cnt
      FROM (
        SELECT Status, Cnt FROM WfDraft
        UNION ALL
        SELECT Status, Cnt FROM WinspeedBase
      ) x
      GROUP BY Status
      ORDER BY Cnt DESC`,
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
    title: 'WF Rebate Trail (WINSpeed coupon redemption)',
    columns: [
      { key: 'SalesName', label: 'พนักงานขาย' }, { key: 'OrderCount', label: 'จำนวน SO' },
      { key: 'CouponCount', label: 'จำนวน Coupon' }, { key: 'RedeemedTon', label: 'ตัดแล้ว (ตัน)' },
      { key: 'RemainingTon', label: 'คงเหลือ (ตัน)' }, { key: 'InvoiceCount', label: 'Invoice' },
    ],
    sql: `SELECT ISNULL(emp.EmpName, CAST(hd.EmpID AS NVARCHAR(20))) AS SalesName,
                 COUNT(DISTINCT hd.SOID) AS OrderCount,
                 COUNT(c.CouponID) AS CouponCount,
                 SUM(c.GoodQty - c.RemaQty) AS RedeemedTon,
                 SUM(c.RemaQty) AS RemainingTon,
                 COUNT(DISTINCT inv.SOInvID) AS InvoiceCount
          FROM dbo.WFCoupon c
          JOIN dbo.SOHD hd ON hd.SOID = c.DocuID
          LEFT JOIN dbo.EMEmp emp ON emp.EmpID = hd.EmpID
          LEFT JOIN dbo.WFRedemtionDT rd ON rd.CouponID = c.CouponID
          LEFT JOIN dbo.SOInvHD inv ON inv.SOInvID = rd.SOInvID
          WHERE hd.DocuType = 104
          GROUP BY hd.EmpID, emp.EmpName
          ORDER BY RedeemedTon DESC, CouponCount DESC`,
  },
};

function canRunReport(req, type) {
  if (type === 'rebate-pools') return canViewAllRebateAmounts(req.user);
  if (type === 'cn-rebate') return ['ACCOUNTING', 'ADMIN', 'MANAGER'].includes(req.user?.role);
  return true;
}

router.get('/types', (req, res) => {
  res.json(Object.entries(REPORTS)
    .filter(([key]) => canRunReport(req, key))
    .map(([key, r]) => ({ key, title: r.title })));
});

async function runReport(type) {
  const def = REPORTS[type];
  if (!def) return null;
  const r = await wfQuery(def.sql);
  return { type, title: def.title, columns: def.columns, rows: r.recordset || [] };
}

router.get('/:type', async (req, res) => {
  try {
    if (!canRunReport(req, req.params.type)) return res.status(403).json({ message: 'ไม่มีสิทธิ์ดูรายงานนี้' });
    const data = await runReport(req.params.type);
    if (!data) return res.status(404).json({ message: 'ไม่พบรายงาน' });
    res.json(data);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

router.get('/:type/export', async (req, res) => {
  try {
    if (!canRunReport(req, req.params.type)) return res.status(403).json({ message: 'ไม่มีสิทธิ์ export รายงานนี้' });
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
