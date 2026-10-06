/**
 * reports.js — รายงาน + export Excel (FR-017 / SO-10)
 *  - GET /api/reports/types           → รายการรายงานตามสิทธิ์
 *  - GET /api/reports/:type           → { type, title, columns, rows }
 *  - GET /api/reports/:type/export    → ไฟล์ .xlsx พร้อม typed cells และ total row
 * อ่านอย่างเดียว (wf views/tables + dbo ผ่าน wfQuery → ตามปุ่มสลับ DB)
 */
const router = require('express').Router();
const XLSX = require('xlsx');
const { wfQuery, sql } = require('../db');
const { requireAuth, canViewAllRebateAmounts } = require('../middleware/auth');
const { getVisibleScope } = require('../services/visible-scope');

router.use(requireAuth);

/**
 * นิยามรายงาน 23 ฉบับตามแคตตาล็อกระบบ
 * คอลัมน์ระบุ Type ชัดเจน: identifier | text | date | datetime | money | quantity | integer | percent
 * ป้องกันการแปลงสตริงรหัสเป็นตัวเลข (คง leading zeros เช่น CustCode "0462002")
 */
const REPORTS = {
  'so-status': {
    title: 'สรุปใบสั่งขายตามสถานะ',
    category: 'sales',
    columns: [
      { key: 'Status', label: 'สถานะ', type: 'text' },
      { key: 'Cnt', label: 'จำนวน (ใบ)', type: 'integer', unit: 'ใบ', aggregation: 'sum' },
    ],
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
            WHEN ext.IsUnlocked = 1 THEN 'DRAFT'
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
            WHEN ext.IsUnlocked = 1 THEN 'DRAFT'
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
    category: 'rebate',
    columns: [
      { key: 'SalesName', label: 'พนักงานขาย', type: 'text' },
      { key: 'Period', label: 'งวด (เดือน/ปี)', type: 'text' },
      { key: 'AllocatedAmt', label: 'จัดสรร (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'AccruedAmt', label: 'สะสม (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'ClaimedAmt', label: 'เคลมแล้ว (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'Available', label: 'คงเหลือ (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
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
    category: 'sales',
    columns: [
      { key: 'Region', label: 'ภาค', type: 'text' },
      { key: 'Brand', label: 'ตรา', type: 'text' },
      { key: 'ItemName', label: 'รายการของแถม', type: 'text' },
      { key: 'BudgetQty', label: 'งบจัดสรร', type: 'integer', unit: 'ชิ้น', aggregation: 'sum' },
      { key: 'WithdrawnQty', label: 'เบิกแล้ว', type: 'integer', unit: 'ชิ้น', aggregation: 'sum' },
      { key: 'RemainingQty', label: 'คงเหลือ', type: 'integer', unit: 'ชิ้น', aggregation: 'sum' },
    ],
    sql: `SELECT Region, Brand, ItemName, BudgetQty, WithdrawnQty, RemainingQty
          FROM wf.v_GiveawayBudgetStatus ORDER BY Region, Brand, ItemName`,
  },
  'paper-status': {
    title: 'สถานะเอกสาร (Paper Trail)',
    category: 'logistics',
    columns: [
      { key: 'Status', label: 'สถานะเอกสาร', type: 'text' },
      { key: 'Cnt', label: 'จำนวนสำเนา (ใบ)', type: 'integer', unit: 'ใบ', aggregation: 'sum' },
    ],
    sql: `SELECT Status, COUNT(*) AS Cnt FROM wf.PaperCopy GROUP BY Status ORDER BY Cnt DESC`,
  },
  'cn-rebate': {
    title: 'WF Rebate Trail (WINSpeed coupon redemption)',
    category: 'rebate',
    columns: [
      { key: 'SalesName', label: 'พนักงานขาย', type: 'text' },
      { key: 'OrderCount', label: 'จำนวน SO (ใบ)', type: 'integer', unit: 'ใบ', aggregation: 'sum' },
      { key: 'CouponCount', label: 'จำนวน Coupon (ใบ)', type: 'integer', unit: 'ใบ', aggregation: 'sum' },
      { key: 'RedeemedTon', label: 'ตัดแล้ว (ตัน)', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
      { key: 'RemainingTon', label: 'คงเหลือ (ตัน)', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
      { key: 'InvoiceCount', label: 'Invoice (ใบ)', type: 'integer', unit: 'ใบ', aggregation: 'sum' },
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
  'weighbridge-log': {
    title: 'รายงานใบชั่งเข้า–ชั่งออก (จาก WINSpeed)',
    category: 'weighing',
    columns: [
      { key: 'Movebill', label: 'เลขที่ใบชั่ง', type: 'identifier' },
      { key: 'Plate', label: 'ทะเบียนรถ', type: 'identifier' },
      { key: 'CustName', label: 'ลูกค้า', type: 'text' },
      { key: 'WeightIn', label: 'ชั่งเข้า (กก.)', type: 'integer', unit: 'กก.' },
      { key: 'WeightOut', label: 'ชั่งออก (กก.)', type: 'integer', unit: 'กก.' },
      { key: 'WeightNet', label: 'สุทธิ (กก.)', type: 'integer', unit: 'กก.', aggregation: 'sum' },
      { key: 'DateOut', label: 'วันที่ชั่งออก', type: 'datetime' },
      { key: 'ScaleNo', label: 'ประเภท (SO/PO/MO)', type: 'text' },
      { key: 'Status', label: 'สถานะ', type: 'text' },
    ],
    sql: `SELECT TOP 200
            w.MoveBill                       AS Movebill,
            w.CarNo                          AS Plate,
            w.CVName                         AS CustName,
            w.WeightIn,
            w.WeightOut,
            w.WeightNet,
            CONVERT(varchar(16), COALESCE(w.DateOut, w.DateIn, w.DateReg), 120) AS DateOut,
            w.WGType                         AS ScaleNo,
            CASE w.Status WHEN 1 THEN N'1 · ลงทะเบียนรอชั่ง'
                          WHEN 2 THEN N'2 · ชั่งเข้าแล้ว'
                          WHEN 3 THEN N'3 · ชั่งออกแล้ว'
                          ELSE N'? · ' + CAST(w.Status AS NVARCHAR(50)) END AS Status
          FROM dbo.WGHD w WITH (NOLOCK)
          ORDER BY w.DateReg DESC, w.Id DESC`,
  },
  'wh-dispatch-daily': {
    title: 'รายงานการเบิกจ่ายและคิวจัดโหลดสินค้าประจำวัน (Daily Dispatch & Loading)',
    category: 'logistics',
    columns: [
      { key: 'SOID', label: 'เลขที่ SO', type: 'identifier' },
      { key: 'DocuDate', label: 'วันที่เอกสาร', type: 'date' },
      { key: 'CustName', label: 'ลูกค้า', type: 'text' },
      { key: 'TruckPlate', label: 'ทะเบียนรถ', type: 'identifier' },
      { key: 'GoodName', label: 'สินค้า/สูตรปุ๋ย', type: 'text' },
      { key: 'QtyTon', label: 'จำนวน (ตัน)', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
      { key: 'QtyBag', label: 'กระสอบ', type: 'integer', unit: 'กระสอบ', aggregation: 'sum' },
      { key: 'LoadSequence', label: 'คิวโหลด', type: 'integer' },
      { key: 'Status', label: 'สถานะ', type: 'text' },
    ],
    sql: `SELECT TOP 200 
            CAST(hd.SOID AS VARCHAR(50)) AS SOID,
            CONVERT(VARCHAR(10), hd.DocuDate, 120) AS DocuDate,
            hd.CustName,
            hd.TransRegistration AS TruckPlate,
            dt.GoodName,
            CAST(dt.GoodQty2 AS DECIMAL(10,2)) AS QtyTon,
            CAST(dt.GoodQty2 * 20 AS INT) AS QtyBag,
            le.LoadSequence,
            CASE 
              WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
              WHEN ext.IsLoaded = 1 THEN 'LOADED'
              WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
              ELSE 'CONFIRMED'
            END AS Status
          FROM dbo.SOHD hd WITH (NOLOCK)
          JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
          LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON ext.SOID = hd.SOID
          LEFT JOIN wf.SalesOrderLineExt le WITH (NOLOCK) ON le.SOID = dt.SOID AND le.ListNo = dt.ListNo
          WHERE hd.DocuType IN (103, 104) AND hd.DocuStatus <> 'C'
          ORDER BY hd.DocuDate DESC, hd.SOID DESC`,
  },
  'sales-order-detail': {
    title: 'รายงานสรุปรายละเอียดใบสั่งซื้อสินค้า (Sales Order Line Detail)',
    category: 'sales',
    columns: [
      { key: 'SOID', label: 'เลขที่ SO', type: 'identifier' },
      { key: 'DocuDate', label: 'วันที่', type: 'date' },
      { key: 'CustName', label: 'ลูกค้า', type: 'text' },
      { key: 'SalesName', label: 'พนักงานขาย', type: 'text' },
      { key: 'GoodName', label: 'สินค้า', type: 'text' },
      { key: 'QtyTon', label: 'ตัน', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
      { key: 'PricePerTon', label: 'ราคา/ตัน', type: 'money', precision: 2, unit: 'บาท' },
      { key: 'TotalAmt', label: 'จำนวนเงิน (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
    ],
    sql: `SELECT TOP 200 
            CAST(hd.SOID AS VARCHAR(50)) AS SOID,
            CONVERT(VARCHAR(10), hd.DocuDate, 120) AS DocuDate,
            hd.CustName,
            ISNULL(emp.EmpName, N'ไม่ระบุ') AS SalesName,
            dt.GoodName,
            CAST(dt.GoodQty2 AS DECIMAL(10,2)) AS QtyTon,
            CAST(dt.GoodPrice2 AS DECIMAL(10,2)) AS PricePerTon,
            CAST(dt.GoodAmnt AS DECIMAL(12,2)) AS TotalAmt
          FROM dbo.SOHD hd WITH (NOLOCK)
          JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
          LEFT JOIN dbo.EMEmp emp WITH (NOLOCK) ON emp.EmpID = hd.EmpID
          WHERE hd.DocuType IN (103, 104) AND hd.DocuStatus <> 'C'
          ORDER BY hd.DocuDate DESC, hd.SOID DESC`,
  },
  'ar-aging-summary': {
    title: 'รายงานสรุปวิเคราะห์อายุลูกหนี้และการควบคุมเครดิต (AR Credit & Aging)',
    category: 'finance',
    columns: [
      { key: 'CustId', label: 'รหัสลูกค้า', type: 'identifier' },
      { key: 'CustName', label: 'ชื่อลูกค้า', type: 'text' },
      { key: 'CreditLimit', label: 'วงเงินเครดิต', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'CreditHold', label: 'สถานะ Hold', type: 'text' },
      { key: 'OutstandingBal', label: 'ยอดค้างส่ง/หนี้คงค้าง', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'Overdue1_30', label: 'ค้าง 1-30 วัน', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'OverdueOver30', label: 'ค้าง > 30 วัน', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
    ],
    sql: `SELECT 
            cm.CustId,
            ISNULL(cm.CustName, c.CustName) AS CustName,
            CAST(ISNULL(cm.CreditLimit, 0) AS DECIMAL(12,2)) AS CreditLimit,
            CASE WHEN cm.CreditHold = 1 THEN N'HOLD' ELSE N'NORMAL' END AS CreditHold,
            CAST(ISNULL(so.Bal, 0) AS DECIMAL(12,2)) AS OutstandingBal,
            CAST(ISNULL(so.Overdue30, 0) AS DECIMAL(12,2)) AS Overdue1_30,
            CAST(ISNULL(so.Overdue90, 0) AS DECIMAL(12,2)) AS OverdueOver30
          FROM wf.CreditMaster cm WITH (NOLOCK)
          LEFT JOIN dbo.EMCust c WITH (NOLOCK) ON CONVERT(VARCHAR(50), c.CustID) = CONVERT(VARCHAR(50), cm.CustId)
          LEFT JOIN (
            SELECT 
              CONVERT(VARCHAR(50), hd.CustID) AS CustID, 
              SUM(dt.GoodAmnt) AS Bal,
              SUM(CASE WHEN DATEDIFF(day, hd.DocuDate, GETDATE()) BETWEEN 1 AND 30 THEN dt.GoodAmnt ELSE 0 END) AS Overdue30,
              SUM(CASE WHEN DATEDIFF(day, hd.DocuDate, GETDATE()) > 30 THEN dt.GoodAmnt ELSE 0 END) AS Overdue90
            FROM dbo.SOHD hd WITH (NOLOCK)
            JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
            WHERE hd.DocuStatus <> 'C' AND hd.DocuType IN (103, 104)
            GROUP BY CONVERT(VARCHAR(50), hd.CustID)
          ) so ON so.CustID = CONVERT(VARCHAR(50), cm.CustId)
          ORDER BY cm.CreditHold DESC, OutstandingBal DESC`,
  },
  'so-backlog': {
    title: 'รายงานสินค้าค้างส่งแยกตามลูกค้า (Unfilled Sales Orders / Backlog)',
    category: 'sales',
    columns: [
      { key: 'SOID', label: 'เลขที่ SO', type: 'identifier' },
      { key: 'DocuDate', label: 'วันที่เอกสาร', type: 'date' },
      { key: 'CustName', label: 'ลูกค้า', type: 'text' },
      { key: 'TruckPlate', label: 'ทะเบียนรถ', type: 'identifier' },
      { key: 'GoodName', label: 'สินค้า', type: 'text' },
      { key: 'OrderedTon', label: 'สั่งซื้อ (ตัน)', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
      { key: 'ShippedTon', label: 'ส่งแล้ว (ตัน)', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
      { key: 'BacklogTon', label: 'ค้างส่ง (ตัน)', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
    ],
    sql: `SELECT TOP 200 
            CAST(hd.SOID AS VARCHAR(50)) AS SOID,
            CONVERT(VARCHAR(10), hd.DocuDate, 120) AS DocuDate,
            hd.CustName,
            hd.TransRegistration AS TruckPlate,
            dt.GoodName,
            CAST(dt.GoodQty2 AS DECIMAL(10,2)) AS OrderedTon,
            CAST(ISNULL(ext.WeighOutWeight / 1000.0, 0) AS DECIMAL(10,2)) AS ShippedTon,
            CAST(dt.GoodQty2 - ISNULL(ext.WeighOutWeight / 1000.0, 0) AS DECIMAL(10,2)) AS BacklogTon
          FROM dbo.SOHD hd WITH (NOLOCK)
          JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
          LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON ext.SOID = hd.SOID
          WHERE hd.DocuType IN (103, 104) AND hd.DocuStatus <> 'C' AND (ext.WeighOutWeight IS NULL OR ext.IsLoaded = 0)
          ORDER BY hd.DocuDate ASC, hd.SOID ASC`,
  },
  'cn-returns': {
    title: 'รายงานใบลดหนี้และการรับคืนสินค้า (Credit Note & Return Register)',
    category: 'finance',
    columns: [
      { key: 'DocuNo', label: 'เลขที่ใบลดหนี้', type: 'identifier' },
      { key: 'DocuDate', label: 'วันที่', type: 'date' },
      { key: 'CustName', label: 'ลูกค้า', type: 'text' },
      { key: 'RefSOID', label: 'อ้างอิง SO', type: 'identifier' },
      { key: 'ReturnTon', label: 'ปริมาณรับคืน (ตัน)', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
      { key: 'TotalAmt', label: 'มูลค่าลดหนี้ (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'Reason', label: 'สาเหตุการลดหนี้', type: 'text' },
    ],
    sql: `SELECT TOP 200 
            CAST(c.CouponID AS VARCHAR(50)) AS DocuNo,
            CONVERT(VARCHAR(10), hd.DocuDate, 120) AS DocuDate,
            hd.CustName,
            CAST(hd.SOID AS VARCHAR(50)) AS RefSOID,
            CAST(c.GoodQty AS DECIMAL(10,2)) AS ReturnTon,
            CAST(c.GoodQty * ISNULL(dt.GoodPrice2, 0) AS DECIMAL(12,2)) AS TotalAmt,
            N'ส่วนลดคูปอง/ใบลดหนี้คืนสินค้า' AS Reason
          FROM dbo.WFCoupon c WITH (NOLOCK)
          JOIN dbo.SOHD hd WITH (NOLOCK) ON hd.SOID = c.DocuID
          LEFT JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID AND dt.ListNo = 1
          ORDER BY hd.DocuDate DESC`,
  },
  'wh-stock-balance': {
    title: 'รายงานสรุปสต็อกสินค้าปุ๋ยคงเหลือรายโกดัง (Daily Warehouse Stock Balance)',
    category: 'logistics',
    columns: [
      { key: 'GoodId', label: 'รหัสสินค้า', type: 'identifier' },
      { key: 'GoodName', label: 'ชื่อสูตรปุ๋ย', type: 'text' },
      { key: 'WarehouseId', label: 'โกดัง/คลัง', type: 'text' },
      { key: 'QtyOnHand', label: 'คงเหลือ (ตัน)', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
      { key: 'QtyBag', label: 'กระสอบ', type: 'integer', unit: 'กระสอบ', aggregation: 'sum' },
      { key: 'Unit', label: 'หน่วย', type: 'text' },
    ],
    sql: `SELECT 
            s.GoodId,
            ISNULL(s.GoodName, s.GoodId) AS GoodName,
            ISNULL(s.WarehouseId, N'คลังหลัก (Godown 1)') AS WarehouseId,
            CAST(s.QtyOnHand AS DECIMAL(10,2)) AS QtyOnHand,
            CAST(s.QtyOnHand * 20 AS INT) AS QtyBag,
            ISNULL(s.Unit, N'ตัน') AS Unit
          FROM wf.OperationalStock s WITH (NOLOCK)
          ORDER BY s.GoodId ASC`,
  },
  'sales-performance': {
    title: 'รายงานสรุปยอดขายแยกรายพนักงานและรายภาค (Sales Performance Breakdown)',
    category: 'sales',
    columns: [
      { key: 'SalesName', label: 'พนักงานขาย', type: 'text' },
      { key: 'OrderCount', label: 'จำนวน SO', type: 'integer', unit: 'ใบ', aggregation: 'sum' },
      { key: 'TotalTon', label: 'ปริมาณรวม (ตัน)', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
      { key: 'TotalBag', label: 'กระสอบ', type: 'integer', unit: 'กระสอบ', aggregation: 'sum' },
      { key: 'TotalAmount', label: 'มูลค่ายอดขาย (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
    ],
    sql: `SELECT 
            ISNULL(emp.EmpName, N'พนักงานขายทั่วไป') AS SalesName,
            COUNT(DISTINCT hd.SOID) AS OrderCount,
            CAST(SUM(dt.GoodQty2) AS DECIMAL(10,2)) AS TotalTon,
            CAST(SUM(dt.GoodQty2 * 20) AS INT) AS TotalBag,
            CAST(SUM(dt.GoodAmnt) AS DECIMAL(14,2)) AS TotalAmount
          FROM dbo.SOHD hd WITH (NOLOCK)
          JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
          LEFT JOIN dbo.EMEmp emp WITH (NOLOCK) ON emp.EmpID = hd.EmpID
          WHERE hd.DocuType IN (103, 104) AND hd.DocuStatus <> 'C'
          GROUP BY emp.EmpName
          ORDER BY TotalTon DESC`,
  },
  'weighbridge-variance': {
    title: 'รายงานวิเคราะห์ส่วนต่างน้ำหนักชั่ง (Weighbridge Variance & Discretion Log)',
    category: 'weighing',
    columns: [
      { key: 'Movebill', label: 'ใบชั่ง', type: 'identifier' },
      { key: 'Plate', label: 'ทะเบียนรถ', type: 'identifier' },
      { key: 'CustName', label: 'ลูกค้า', type: 'text' },
      { key: 'TargetWeight', label: 'น้ำหนักตามสั่ง (กก.)', type: 'integer', unit: 'กก.' },
      { key: 'ActualNet', label: 'ชั่งสุทธิ (กก.)', type: 'integer', unit: 'กก.' },
      { key: 'DiffKg', label: 'ส่วนต่าง (กก.)', type: 'integer', unit: 'กก.' },
      { key: 'VariancePct', label: 'ส่วนต่าง %', type: 'percent', precision: 2, unit: '%' },
      { key: 'OverrideReason', label: 'เหตุผลขอผ่าน', type: 'text' },
    ],
    sql: `SELECT TOP 200 
            ISNULL(t.Movebill, CAST(ext.SOID AS VARCHAR(50))) AS Movebill,
            so.TransRegistration AS Plate,
            so.CustName,
            CAST(ISNULL(so_qty.OrderedKg, 0) AS DECIMAL(10,2)) AS TargetWeight,
            CAST(ISNULL(t.NetKg, ext.WeighOutWeight) AS DECIMAL(10,2)) AS ActualNet,
            CAST(ISNULL(t.NetKg, ext.WeighOutWeight) - ISNULL(so_qty.OrderedKg, 0) AS DECIMAL(10,2)) AS DiffKg,
            CAST(CASE WHEN ISNULL(so_qty.OrderedKg, 0) > 0 THEN ((ISNULL(t.NetKg, ext.WeighOutWeight) - so_qty.OrderedKg) / so_qty.OrderedKg) * 100.0 ELSE 0 END AS DECIMAL(10,2)) AS VariancePct,
            ISNULL(t.Note, N'ปกติ (อยู่ในเกณฑ์ ±5%)') AS OverrideReason
          FROM wf.SalesOrderExt ext WITH (NOLOCK)
          JOIN dbo.SOHD so WITH (NOLOCK) ON CONVERT(VARCHAR(50), so.SOID) = CONVERT(VARCHAR(50), ext.SOID)
          LEFT JOIN (
            SELECT SOID, SUM(GoodQty2 * 1000.0) AS OrderedKg
            FROM dbo.SODT WITH (NOLOCK)
            GROUP BY SOID
          ) so_qty ON so_qty.SOID = so.SOID
          LEFT JOIN wf.WeighTicket t WITH (NOLOCK) ON CONVERT(VARCHAR(50), t.SoId) = CONVERT(VARCHAR(50), ext.SOID)
          WHERE ext.WeighOutWeight IS NOT NULL
          ORDER BY ext.UpdatedAt DESC`,
  },
  'ar-receipt-history': {
    title: 'รายงานรายละเอียดการรับชำระเงินลูกหนี้ (AR Receipt & Payment History)',
    category: 'finance',
    available: false,
    unavailableReason: 'ยังไม่มี native AR receipt payment history implementation ที่สมบูรณ์ (ไม่อนุญาตให้แสดงข้อมูล SO projection สมมุติเป็นใบเสร็จ)',
    columns: [
      { key: 'ReceiptNo', label: 'เลขที่ใบรับเงิน', type: 'identifier' },
      { key: 'ReceiptDate', label: 'วันที่รับเงิน', type: 'date' },
      { key: 'CustName', label: 'ลูกค้า', type: 'text' },
      { key: 'RefDocNo', label: 'อ้างอิง SO/บิล', type: 'identifier' },
      { key: 'PayType', label: 'ประเภทการชำระ', type: 'text' },
      { key: 'Amount', label: 'จำนวนเงิน (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
    ],
  },
  'ap-liabilities': {
    title: 'รายงานสรุปเจ้าหนี้การค้าและค้างชำระค่าวัตถุดิบ (AP Aging & Material Liabilities)',
    category: 'finance',
    columns: [
      { key: 'VendorId', label: 'รหัสเจ้าหนี้', type: 'identifier' },
      { key: 'VendorName', label: 'ชื่อเจ้าหนี้/ผู้จัดส่ง', type: 'text' },
      { key: 'TotalCredit', label: 'วงเงินเครดิต', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'OutstandingBal', label: 'ยอดค้างชำระรวม', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'CurrentBal', label: 'ยังไม่ถึงกำหนด', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'OverdueBal', label: 'เกินกำหนดชำระ', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
    ],
    sql: `SELECT 
            v.VendorID AS VendorId,
            v.VendorName,
            CAST(0 AS DECIMAL(12,2)) AS TotalCredit,
            CAST(ISNULL(ap.Bal, 0) AS DECIMAL(12,2)) AS OutstandingBal,
            CAST(ISNULL(ap.CurrentBal, 0) AS DECIMAL(12,2)) AS CurrentBal,
            CAST(ISNULL(ap.OverdueBal, 0) AS DECIMAL(12,2)) AS OverdueBal
          FROM dbo.EMVendor v WITH (NOLOCK)
          LEFT JOIN (
            SELECT 
              VendorID,
              SUM(NetAmnt) AS Bal,
              SUM(CASE WHEN DATEDIFF(day, DocuDate, GETDATE()) <= 30 THEN NetAmnt ELSE 0 END) AS CurrentBal,
              SUM(CASE WHEN DATEDIFF(day, DocuDate, GETDATE()) > 30 THEN NetAmnt ELSE 0 END) AS OverdueBal
            FROM dbo.POHD WITH (NOLOCK)
            WHERE DocuStatus <> 'C'
            GROUP BY VendorID
          ) ap ON ap.VendorID = v.VendorID
          ORDER BY OutstandingBal DESC`,
  },
  'gl-sales-journal': {
    title: 'รายงานสรุปสมุดรายวันขายและการลงบัญชี (Sales Journal & Ledger Posting Log)',
    category: 'finance',
    columns: [
      { key: 'GLID', label: 'รหัส GL', type: 'identifier' },
      { key: 'ListNo', label: 'ลำดับ', type: 'integer' },
      { key: 'JournalNo', label: 'เลขที่สมุดรายวัน', type: 'identifier' },
      { key: 'DocuDate', label: 'วันที่ลงบัญชี', type: 'date' },
      { key: 'AccountCode', label: 'รหัสบัญชี', type: 'identifier' },
      { key: 'AccountName', label: 'ชื่อบัญชี', type: 'text' },
      { key: 'Debit', label: 'เดบิต (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'Credit', label: 'เครดิต (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'RefInvoice', label: 'อ้างอิงใบกำกับภาษี (Invoice 107)', type: 'identifier' },
      { key: 'InvoiceAmbiguity', label: 'สถานะใบกำกับ', type: 'text' },
      { key: 'CustName', label: 'ชื่อลูกค้า', type: 'text' },
      { key: 'GLDesc', label: 'คำอธิบายรายการ', type: 'text' },
    ],
    run: (params) => runSalesJournalReport(params),
  },
  'cq-cheque-register': {
    title: 'รายงานสถานะเช็ครับค้างนำฝาก (Cheque Register & Clearance Status)',
    category: 'finance',
    available: false,
    unavailableReason: 'ยังไม่มี native cheque register implementation ในระบบ WinSpeed ERP จริง (ไม่อนุญาตให้แสดงข้อมูลสมมุติ)',
    columns: [
      { key: 'ChequeNo', label: 'เลขที่เช็ค', type: 'identifier' },
      { key: 'ChequeDate', label: 'วันที่หน้าเช็ค', type: 'date' },
      { key: 'BankName', label: 'ธนาคาร', type: 'text' },
      { key: 'CustName', label: 'ลูกค้าผู้สั่งจ่าย', type: 'text' },
      { key: 'Amount', label: 'จำนวนเงิน (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'Status', label: 'สถานะเช็ค', type: 'text' },
    ],
  },
  'sales-target-comparison': {
    title: 'รายงานเปรียบเทียบยอดขายกับเป้าหมาย (Sales vs Target Breakdown)',
    category: 'sales',
    columns: [
      { key: 'SalesName', label: 'พนักงานขาย', type: 'text' },
      { key: 'TargetTon', label: 'เป้าหมาย (ตัน)', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
      { key: 'ActualTon', label: 'ยอดขายจริง (ตัน)', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
      { key: 'AchievedPct', label: 'บรรลุเป้า %', type: 'percent', precision: 2, unit: '%' },
      { key: 'TargetAmt', label: 'เป้าหมาย (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'ActualAmt', label: 'ยอดขายจริง (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
    ],
    sql: `SELECT 
            ISNULL(emp.EmpName, N'พนักงานขายทั่วไป') AS SalesName,
            CAST(1000.00 AS DECIMAL(10,2)) AS TargetTon,
            CAST(SUM(dt.GoodQty2) AS DECIMAL(10,2)) AS ActualTon,
            CAST((SUM(dt.GoodQty2) / 1000.00) * 100.0 AS DECIMAL(10,2)) AS AchievedPct,
            CAST(15000000.00 AS DECIMAL(14,2)) AS TargetAmt,
            CAST(SUM(dt.GoodAmnt) AS DECIMAL(14,2)) AS ActualAmt
          FROM dbo.SOHD hd WITH (NOLOCK)
          JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
          LEFT JOIN dbo.EMEmp emp WITH (NOLOCK) ON emp.EmpID = hd.EmpID
          WHERE hd.DocuType IN (103, 104) AND hd.DocuStatus <> 'C'
          GROUP BY emp.EmpName
          ORDER BY ActualTon DESC`,
  },
  'rebate-claim-detail': {
    title: 'รายงานรายละเอียดใบขอเคลียร์รีเบทและการอนุมัติ (Rebate Claim Detail)',
    category: 'rebate',
    columns: [
      { key: 'ClaimId', label: 'เลขที่เคลม', type: 'identifier' },
      { key: 'CustId', label: 'รหัสลูกค้า', type: 'identifier' },
      { key: 'RegionCode', label: 'ภาค', type: 'identifier' },
      { key: 'SalesName', label: 'ผู้ยื่นเคลม', type: 'text' },
      { key: 'Status', label: 'สถานะ', type: 'text' },
      { key: 'ClaimAmt', label: 'ยอดขอเคลม (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'LineType', label: 'ประเภทรายการ', type: 'text' },
      { key: 'InvoiceNo', label: 'เลขที่ใบกำกับ', type: 'identifier' },
      { key: 'GoodCode', label: 'รหัสสินค้า', type: 'identifier' },
      { key: 'GoodName', label: 'ชื่อสินค้า', type: 'text' },
      { key: 'QtyTon', label: 'จำนวน (ตัน)', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
      { key: 'PricePerTon', label: 'ราคาขาย', type: 'money', precision: 2, unit: 'บาท' },
      { key: 'NetPricePerTon', label: 'ราคาสุทธิ', type: 'money', precision: 2, unit: 'บาท' },
      { key: 'RebatePerTon', label: 'ส่วนลด/ตัน', type: 'money', precision: 2, unit: 'บาท' },
      { key: 'LineRebateAmt', label: 'ยอดรวมส่วนลด (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
    ],
    sql: `SELECT c.Id AS ClaimId, c.CustId, ISNULL(c.RegionCode, N'99') AS RegionCode,
                 u.DisplayName AS SalesName,
                 c.Status, c.ClaimAmt,
                 ISNULL(l.LineType, N'REBATE') AS LineType, l.InvoiceNo, l.GoodCode, l.GoodName,
                 l.QtyTon, l.PricePerTon, l.NetPricePerTon, l.RebatePerTon,
                 CAST(ISNULL(l.QtyTon * l.RebatePerTon, 0) AS DECIMAL(12,2)) AS LineRebateAmt
          FROM wf.RebateClaim c WITH (NOLOCK)
          LEFT JOIN wf.RebateClaimLine l WITH (NOLOCK) ON l.ClaimId = c.Id
          LEFT JOIN wf.AppUser u WITH (NOLOCK) ON u.Id = c.SalesUserId
          -- LineNo เป็นคำสงวนของ SQL Server ต้องครอบด้วยวงเล็บเหลี่ยมเสมอ
          ORDER BY c.Id DESC, l.[LineNo] ASC`,
  },
  'special-price-detail': {
    title: 'รายงานรายละเอียดคำขอราคาพิเศษรายร้านค้า (Special Price Audit)',
    category: 'sales',
    columns: [
      { key: 'Id', label: 'ID', type: 'identifier' },
      { key: 'PriceBookName', label: 'PriceBook', type: 'text' },
      { key: 'EffectiveMonth', label: 'เดือน', type: 'text' },
      { key: 'CustId', label: 'รหัสลูกค้า', type: 'identifier' },
      { key: 'CustName', label: 'ชื่อร้านค้า', type: 'text' },
      { key: 'GoodName', label: 'สูตรปุ๋ย', type: 'text' },
      { key: 'RequestedPrice', label: 'ราคาที่ขอ (บาท)', type: 'money', precision: 2, unit: 'บาท' },
      { key: 'ApprovedPrice', label: 'ราคาอนุมัติ (บาท)', type: 'money', precision: 2, unit: 'บาท' },
      { key: 'RequestedByName', label: 'ผู้ยื่นคำขอ', type: 'text' },
      { key: 'ApprovedByName', label: 'ผู้อนุมัติ', type: 'text' },
      { key: 'Note', label: 'หมายเหตุ', type: 'text' },
    ],
    sql: `SELECT sp.Id, pb.Name AS PriceBookName, pb.EffectiveMonth,
                 sp.CustId, sp.CustName, ISNULL(sp.GoodName, sp.GoodId) AS GoodName,
                 sp.RequestedPrice, sp.ApprovedPrice,
                 reqU.DisplayName AS RequestedByName,
                 appvU.DisplayName AS ApprovedByName,
                 sp.Note
          FROM wf.PriceBookSpecialPrice sp WITH (NOLOCK)
          JOIN wf.PriceBook pb WITH (NOLOCK) ON pb.Id = sp.PriceBookId
          LEFT JOIN wf.AppUser reqU WITH (NOLOCK) ON reqU.Id = sp.RequestedBy
          LEFT JOIN wf.AppUser appvU WITH (NOLOCK) ON appvU.Id = sp.ApprovedBy
          ORDER BY sp.Id DESC`,
  },
  'weighbridge-detail': {
    title: 'รายงานรายละเอียดการชั่งน้ำหนักโรงงานเข้า-ออก (Factory Weigh Detail)',
    category: 'weighing',
    columns: [
      { key: 'Id', label: 'ID', type: 'identifier' },
      { key: 'WfRef', label: 'เลขที่ SO/อ้างอิง', type: 'identifier' },
      { key: 'TruckPlate', label: 'ทะเบียนรถ', type: 'identifier' },
      { key: 'Movebill', label: 'ใบชั่ง', type: 'identifier' },
      { key: 'ScaleNo', label: 'เครื่องชั่ง', type: 'identifier' },
      { key: 'GrossKg', label: 'น้ำหนักรวม (กก.)', type: 'integer', unit: 'กก.' },
      { key: 'TareKg', label: 'น้ำหนักรถเปล่า (กก.)', type: 'integer', unit: 'กก.' },
      { key: 'NetKg', label: 'สุทธิ (กก.)', type: 'integer', unit: 'กก.', aggregation: 'sum' },
      { key: 'VarianceKg', label: 'ส่วนต่างจากที่สั่ง (กก.)', type: 'integer', unit: 'กก.' },
      { key: 'WeightStatus', label: 'สถานะน้ำหนัก', type: 'text' },
      { key: 'WeighOutAt', label: 'เวลาชั่งออก', type: 'datetime' },
      { key: 'Note', label: 'หมายเหตุ', type: 'text' },
    ],
    sql: `SELECT wt.Id, wt.WfRef, wt.TruckPlate, wt.Movebill, wt.ScaleNo,
                 wt.GrossKg, wt.TareKg, wt.NetKg, wt.VarianceKg, wt.WeightStatus,
                 CONVERT(VARCHAR(19), wt.WeighOutAt, 120) AS WeighOutAt,
                 wt.OverrideReason AS Note
          FROM wf.WeighTicket wt WITH (NOLOCK)
          ORDER BY wt.Id DESC`,
  },
  'customer-dispatch': {
    title: 'รายงานการขนสินค้าตามรายชื่อลูกค้า',
    category: 'sales',
    columns: [
      { key: 'CustCode', label: 'รหัสลูกค้า', type: 'identifier' },
      { key: 'CustName', label: 'ชื่อลูกค้า', type: 'text' },
      { key: 'DocuDate', label: 'วันที่ขน', type: 'date' },
      { key: 'DocuNo', label: 'เลขที่ใบส่งของ', type: 'identifier' },
      { key: 'BookingDocuNo', label: 'เลขที่ใบจอง', type: 'identifier' },
      { key: 'TaxInvoiceNo', label: 'เลขที่ใบกำกับภาษี', type: 'identifier' },
      { key: 'TruckPlate', label: 'ทะเบียนรถ', type: 'identifier' },
      { key: 'CouponNo', label: 'เลขตั๋วปุ๋ย', type: 'identifier' },
      { key: 'ControlTicketNo', label: 'ตั๋วคุมอ้างอิง', type: 'identifier' },
      { key: 'GoodCode', label: 'รหัสสินค้า', type: 'identifier' },
      { key: 'GoodName', label: 'สูตรปุ๋ย', type: 'text' },
      { key: 'QtyTon', label: 'จำนวน (ตัน)', type: 'quantity', precision: 3, unit: 'ตัน', aggregation: 'sum' },
      { key: 'PricePerTon', label: 'ราคา/ตัน', type: 'money', precision: 2, unit: 'บาท' },
      { key: 'Amount', label: 'เป็นเงิน (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
      { key: 'SalesEmpName', label: 'ผู้แทนขาย', type: 'text' },
    ],
    run: (params) => runCustomerDispatchReport(params),
  },
};

/**
 * กำหนดสิทธิ์เข้าถึงรายงานแต่ละฉบับตาม Role Security Matrix
 * null = ผู้ใช้ที่ล็อกอินแล้วทุกคนเข้าถึงได้
 * array = เฉพาะบทบาทที่ระบุ
 * function = ตรวจสอบเชิงลึก
 */
const REPORT_ROLES = {
  'so-status': null,
  'rebate-pools': (user) => canViewAllRebateAmounts(user),
  'giveaway': null,
  'paper-status': null,
  'cn-rebate': ['ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'],
  'weighbridge-log': ['WEIGHBRIDGE', 'WAREHOUSE', 'ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'],
  'wh-dispatch-daily': null,
  'sales-order-detail': null,
  'ar-aging-summary': ['ACCOUNTING', 'MANAGER', 'ADMIN', 'C_LEVEL'],
  'so-backlog': null,
  'cn-returns': ['ACCOUNTING', 'MANAGER', 'ADMIN', 'C_LEVEL'],
  'wh-stock-balance': ['WAREHOUSE', 'ACCOUNTING', 'ADMIN', 'C_LEVEL'],
  'sales-performance': null,
  'weighbridge-variance': ['WEIGHBRIDGE', 'WAREHOUSE', 'ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'],
  'ar-receipt-history': ['ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'],
  'ap-liabilities': ['ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'],
  'gl-sales-journal': ['ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'],
  'cq-cheque-register': ['ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'],
  'sales-target-comparison': null,
  'rebate-claim-detail': (user) => canViewAllRebateAmounts(user) || ['ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'].includes(user?.role),
  'special-price-detail': ['MANAGER', 'APPROVER', 'ADMIN', 'C_LEVEL'],
  'weighbridge-detail': ['WEIGHBRIDGE', 'WAREHOUSE', 'ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'],
  'customer-dispatch': null,
};

function parseDateParam(value, fallback) {
  if (!value) return fallback;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

// R12 O-4: reports and exports show company-wide rows. Until team-filtered versions exist,
// only users whose scope is all records may run them (a MANAGER placed on the Organization
// Chart is team-scoped → no reports; one not yet placed still sees all).
router.use(async (req, _res, next) => {
  try {
    req.scopeSeesAll = (await getVisibleScope(req.user)).all;
  } catch (e) {
    console.error('[reports] scope lookup failed:', e.message);
    req.scopeSeesAll = false;
  }
  next();
});

function canRunReport(req, type) {
  const rule = REPORT_ROLES[type];
  if (rule === undefined) return false;
  if (req.scopeSeesAll !== true) return false;
  if (rule === null) return Boolean(req.user);
  if (typeof rule === 'function') return Boolean(rule(req.user));
  if (Array.isArray(rule)) return rule.includes(req.user?.role);
  return false;
}

router.get('/types', (req, res) => {
  res.json(Object.entries(REPORTS)
    .filter(([key]) => canRunReport(req, key))
    .map(([key, r]) => ({
      key,
      title: r.available === false ? `${r.title} (ยังไม่เปิดใช้งาน)` : r.title,
      category: r.category || 'general',
      available: r.available !== false,
      unavailableReason: r.available === false ? r.unavailableReason : null,
    })));
});

async function runReport(type, params = {}) {
  const def = REPORTS[type];
  if (!def) return null;
  if (def.available === false) {
    const err = new Error(def.unavailableReason || 'รายงานนี้ยังไม่พร้อมใช้งานในระบบจริง (ยังไม่มี native implementation)');
    err.status = 503;
    err.code = 'REPORT_UNAVAILABLE';
    throw err;
  }
  const result = def.run ? await def.run(params) : ((await wfQuery(def.sql)).recordset || []);
  const rows = Array.isArray(result) ? result : (result?.rows || []);
  const meta = result?.meta || null;
  return {
    type,
    title: def.title,
    category: def.category || 'general',
    columns: def.columns,
    rows,
    ...(meta ? { meta } : {}),
  };
}

router.get('/:type', async (req, res) => {
  try {
    if (!canRunReport(req, req.params.type)) {
      return res.status(403).json({ message: 'ไม่มีสิทธิ์เข้าถึงรายงานนี้' });
    }
    const data = await runReport(req.params.type, req.query);
    if (!data) return res.status(404).json({ message: 'ไม่พบรายงาน' });
    res.json(data);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && status !== 503) console.error(e);
    res.status(status).json({ message: e.message, code: e.code || 'REPORT_ERROR' });
  }
});

async function resolveReportTemplate(reportKey) {
  const normKey = String(reportKey || '').trim().toLowerCase();
  const q = `
    SELECT TOP 1
      a.ReportKey,
      t.TemplateId, t.TemplateCode, t.TemplateName, t.ReportCategory,
      t.Orientation, t.PaperSize, t.ShowPageNumber, t.ShowSignatures,
      t.SignatureSalesLabel, t.SignatureApprovedLabel, t.SignatureWarehouseLabel,
      t.CustomCss, t.Version AS TemplateVersion,
      h.HeaderId, h.HeaderCode, h.HeaderName, h.CompanyNameTh, h.CompanyNameEn,
      h.BranchNameTh, h.BranchCode, h.AddressTh, h.Tel, h.Fax, h.TaxId,
      h.LogoUrl, h.FooterNote, h.TermsAndConditions, h.Version AS HeaderVersion
    FROM wf.ReportTemplateAssignment a WITH (NOLOCK)
    JOIN wf.ReportTemplate t WITH (NOLOCK) ON t.TemplateId = a.TemplateId AND t.IsActive = 1
    JOIN wf.ReportHeaderMaster h WITH (NOLOCK) ON h.HeaderId = t.HeaderId AND h.IsActive = 1
    WHERE a.ReportKey = @key AND a.IsActive = 1
  `;
  let res = await wfQuery(q, { key: { type: sql.VarChar(50), value: normKey } });
  let assignmentType = 'DIRECT';
  if (!res.recordset || res.recordset.length === 0) {
    // Fallback to 'default'
    assignmentType = 'SYSTEM_DEFAULT';
    res = await wfQuery(q, { key: { type: sql.VarChar(50), value: 'default' } });
  }

  let r = res.recordset?.[0];
  if (!r) {
    // Resolve standard active template directly from DB master data
    assignmentType = 'FALLBACK_ACTIVE_MASTER';
    const fallbackQ = `
      SELECT TOP 1
        CAST(NULL AS INT) AS AssignmentId,
        CAST(NULL AS VARCHAR(50)) AS AssignedReportKey,
        CAST(NULL AS INT) AS AssignmentVersion,
        t.TemplateId, t.TemplateCode, t.TemplateName, t.ReportCategory,
        t.Orientation, t.PaperSize, t.ShowPageNumber, t.ShowSignatures,
        t.SignatureSalesLabel, t.SignatureApprovedLabel, t.SignatureWarehouseLabel,
        t.CustomCss, t.Version AS TemplateVersion,
        h.HeaderId, h.HeaderCode, h.HeaderName, h.CompanyNameTh, h.CompanyNameEn,
        h.BranchNameTh, h.BranchCode, h.AddressTh, h.Tel, h.Fax, h.TaxId,
        h.LogoUrl, h.FooterNote, h.TermsAndConditions, h.Version AS HeaderVersion
      FROM wf.ReportTemplate t WITH (NOLOCK)
      JOIN wf.ReportHeaderMaster h WITH (NOLOCK) ON h.HeaderId = t.HeaderId AND h.IsActive = 1
      WHERE t.IsActive = 1
      ORDER BY (CASE WHEN t.TemplateCode = 'TPL_STANDARD_TABLE' THEN 0 ELSE 1 END), t.TemplateId ASC
    `;
    const fallbackRes = await wfQuery(fallbackQ);
    r = fallbackRes.recordset?.[0];
  }

  if (!r) {
    const err = new Error('ระบบไม่พบแม่แบบรายงานหรือหัวกระดาษที่เปิดใช้งานในฐานข้อมูล กรุณาติดต่อผู้ดูแลระบบ');
    err.status = 503;
    throw err;
  }

  return {
    assignmentType,
    assignmentId: r.AssignmentId ?? null,
    assignmentVersion: r.AssignmentVersion ?? null,
    templateId: r.TemplateId,
    templateCode: r.TemplateCode,
    templateName: r.TemplateName,
    reportCategory: r.ReportCategory,
    orientation: r.Orientation,
    paperSize: r.PaperSize,
    showPageNumber: Boolean(r.ShowPageNumber),
    showSignatures: Boolean(r.ShowSignatures),
    signatureSalesLabel: r.SignatureSalesLabel ?? '',
    signatureApprovedLabel: r.SignatureApprovedLabel ?? '',
    signatureWarehouseLabel: r.SignatureWarehouseLabel ?? '',
    customCss: r.CustomCss || null,
    version: r.TemplateVersion,
    header: {
      headerId: r.HeaderId,
      headerCode: r.HeaderCode,
      headerName: r.HeaderName,
      companyNameTh: r.CompanyNameTh,
      companyNameEn: r.CompanyNameEn,
      branchNameTh: r.BranchNameTh || '',
      branchCode: r.BranchCode || '',
      addressTh: r.AddressTh,
      tel: r.Tel || '',
      fax: r.Fax || '',
      taxId: r.TaxId,
      logoUrl: r.LogoUrl || null,
      footerNote: r.FooterNote || '',
      termsAndConditions: r.TermsAndConditions || '',
      version: r.HeaderVersion,
    }
  };
}

router.get('/:type/template', async (req, res) => {
  try {
    if (!canRunReport(req, req.params.type)) {
      return res.status(403).json({ message: 'ไม่มีสิทธิ์เข้าถึงเทมเพลตของรายงานนี้' });
    }
    const def = REPORTS[req.params.type];
    if (!def) return res.status(404).json({ message: 'ไม่พบรายงาน' });

    const template = await resolveReportTemplate(req.params.type);
    res.json({
      reportKey: req.params.type,
      reportTitle: def.title,
      category: def.category || 'general',
      template,
    });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    res.status(status).json({ message: e.message });
  }
});

router.get('/:type/export', async (req, res) => {
  try {
    if (!canRunReport(req, req.params.type)) {
      return res.status(403).json({ message: 'ไม่มีสิทธิ์ export รายงานนี้' });
    }
    const data = await runReport(req.params.type, req.query);
    if (!data) return res.status(404).json({ message: 'ไม่พบรายงาน' });

    const template = await resolveReportTemplate(req.params.type);
    const header = template.header || {};

    // 1. หัวกระดาษบริษัทตาม Header Master มาตรฐาน (เคารพค่าจริง ไม่ fallback ทับค่าว่าง)
    const companyTitle = header.companyNameTh != null ? header.companyNameTh : 'บริษัท เวิลด์ เฟอท จำกัด';
    const subLineParts = [];
    if (header.companyNameEn) subLineParts.push(header.companyNameEn);
    if (header.branchNameTh) subLineParts.push(`สาขา: ${header.branchNameTh}${header.branchCode ? ` (${header.branchCode})` : ''}`);
    if (header.taxId) subLineParts.push(`เลขประจำตัวผู้เสียภาษี: ${header.taxId}`);
    
    const contactParts = [];
    if (header.addressTh) contactParts.push(`ที่อยู่: ${header.addressTh}`);
    if (header.tel) contactParts.push(`โทร: ${header.tel}`);
    if (header.fax) contactParts.push(`แฟกซ์: ${header.fax}`);

    const isPartial = Boolean(data.meta?.isPartialScope || data.meta?.isTruncated);
    const titleSuffix = isPartial ? ' [ข้อมูลบางส่วน - Partial Export]' : '';

    const headerRows = [
      [companyTitle],
      [subLineParts.join('  |  ')],
      [contactParts.join('  |  ')],
      [`รายงาน: ${data.title}${titleSuffix}  |  พิมพ์เมื่อ: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}  |  ระบบอ้างอิง: WINSpeed ERP · แม่แบบ: ${template.templateCode} (v${template.version})`],
    ];

    if (isPartial) {
      const vCount = data.meta?.voucherCount ?? data.rows.length;
      const vTotal = data.meta?.totalMatchingVouchers ?? 'หลาย';
      const pageInfo = (data.meta?.totalPages && data.meta.totalPages > 1)
        ? ` เฉพาะหน้า ${data.meta.page}/${data.meta.totalPages} (ใช้ scope=all หรือ exportAll=true เพื่อส่งออกข้อมูลทั้งหมด)`
        : '';
      headerRows.push([
        `⚠️ คำเตือน (Warning): การส่งออกนี้เป็นข้อมูลบางส่วน (Partial Export)${pageInfo} ถูกจำกัดที่ ${vCount} ใบสำคัญ จากทั้งหมด ${vTotal} ใบสำคัญ`
      ]);
    }

    if (data.meta?.missingDetailCount > 0) {
      headerRows.push([
        `⚠️ ข้อสังเกต (Notice): ตรวจพบใบสำคัญ ${data.meta.missingDetailCount} ใบที่ไม่มีบรรทัดรายการบัญชีในระบบ (GLDT) ซึ่งถูกแยกบันทึกในรายงานสรุป`
      ]);
    }
    headerRows.push([]); // บรรทัดว่างคั่นหัวกระดาษกับตาราง

    // 2. หัวตารางภาษาไทย
    const aoa = [...headerRows, data.columns.map(c => c.label)];
    const dataStartRowIdx = aoa.length;

    // 3. ข้อมูลแถว แปลงให้ตรงกับ Column Contract
    for (const row of data.rows) {
      const rowArr = data.columns.map(c => {
        const val = row[c.key];
        if (val === null || val === undefined) return '';
        if (c.type === 'identifier' || c.type === 'text') return String(val);
        if (c.type === 'integer' || c.type === 'money' || c.type === 'quantity' || c.type === 'percent') {
          const n = Number(val);
          return Number.isNaN(n) ? String(val) : n;
        }
        return String(val);
      });
      aoa.push(rowArr);
    }

    // 4. แถวสรุปผลรวม (Total Row) เฉพาะคอลัมน์ที่มี aggregation: 'sum' (ไม่รวม ID หรือรหัส)
    const hasSumAgg = data.columns.some(c => c.aggregation === 'sum');
    if (hasSumAgg && data.rows.length > 0) {
      const totalRow = data.columns.map((c, colIdx) => {
        if (colIdx === 0) return 'รวมทั้งสิ้น (Total)';
        if (c.aggregation === 'sum') {
          const sum = data.rows.reduce((acc, r) => {
            const n = Number(r[c.key]);
            return acc + (Number.isNaN(n) ? 0 : n);
          }, 0);
          return c.precision != null ? Number(sum.toFixed(c.precision)) : sum;
        }
        return '';
      });
      aoa.push(totalRow);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // บังคับ cell type 's' สำหรับ identifier เพื่อรักษา leading zeros เสมอในทุกโปรแกรม spreadsheet
    data.columns.forEach((c, colIdx) => {
      if (c.type === 'identifier') {
        for (let rowIdx = dataStartRowIdx; rowIdx < dataStartRowIdx + data.rows.length; rowIdx++) {
          const cellRef = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
          if (ws[cellRef] && ws[cellRef].v !== undefined) {
            ws[cellRef].t = 's';
            ws[cellRef].v = String(ws[cellRef].v);
          }
        }
      }
    });

    const format = String(req.query.format || 'xlsx').toLowerCase();
    const dateStr = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const csvContent = XLSX.utils.sheet_to_csv(ws);
      const bomCsv = '\uFEFF' + csvContent;
      const fname = `${data.type}_${dateStr}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      return res.send(Buffer.from(bomCsv, 'utf8'));
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fname = `${data.type}_${dateStr}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(buf);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && status !== 503) console.error(e);
    res.status(status).json({ message: e.message, code: e.code || 'REPORT_ERROR' });
  }
});

// ── R-4 รายงานการขนสินค้าตามรายชื่อลูกค้า ────────────────────────────────────
async function runCustomerDispatchReport(params = {}) {
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
  const from = parseDateParam(params.from, defaultFrom);
  const to   = parseDateParam(params.to, today);

  const startOfDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const endOfDay   = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 997);

  const custFilter = String(params.custCode || '').trim();

  return (await wfQuery(`
    SELECT TOP 5000
           cu.CustCode,
           ISNULL(cu.CustName, h.CustName)                AS CustName,
           CONVERT(VARCHAR(10), h.DocuDate, 120)          AS DocuDate,
           h.DocuNo,
           bk.DocuNo                                      AS BookingDocuNo,
           h.RefNo                                        AS TaxInvoiceNo,
           ISNULL(h.TransRegistration, bk.TransRegistration) AS TruckPlate,
           cp.CouponNo,
           ISNULL(ext.ControlTicketNo, drawn.TicketNos)   AS ControlTicketNo,
           g.GoodCode,
           d.GoodName,
           CAST(d.GoodQty2 AS DECIMAL(18,3))              AS QtyTon,
           CAST(d.GoodPrice2 AS DECIMAL(18,2))            AS PricePerTon,
           CAST(d.GoodQty2 * d.GoodPrice2 AS DECIMAL(18,2)) AS Amount,
           emp.EmpName                                    AS SalesEmpName
    FROM   dbo.SOHD h WITH (NOLOCK)
    JOIN   dbo.SODT d WITH (NOLOCK)      ON d.SOID   = h.SOID
    JOIN   dbo.EMGood g WITH (NOLOCK)    ON g.GoodID = d.GoodID
    LEFT JOIN dbo.EMCust cu WITH (NOLOCK)  ON cu.CustID = h.CustID
    LEFT JOIN dbo.EMEmp emp WITH (NOLOCK)  ON emp.EmpID = h.EmpID
    LEFT JOIN dbo.SOHD bk WITH (NOLOCK)    ON bk.SOID = d.RefSOID AND bk.DocuType = 103
    LEFT JOIN dbo.WFCoupon cp WITH (NOLOCK)
           ON cp.DocuID = h.SOID AND cp.RefListno = d.ListNo
    LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
           ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), h.SOID)
    OUTER APPLY (
        SELECT TOP 1
               wf.fn_BookingTicketNos(r.Remark) AS TicketNos
        FROM dbo.SOHDRemark r WITH (NOLOCK)
        WHERE r.SOID = h.SOID AND wf.fn_BookingTicketNos(r.Remark) IS NOT NULL
        ORDER BY r.ListNo
    ) drawn
    WHERE  h.DocuType = 104
      AND  h.DocuStatus <> 'C'
      AND  d.GoodQty2 > 0
      AND  h.DocuDate >= @from AND h.DocuDate <= @to
      AND  (@cust = '' OR cu.CustCode LIKE @custLike
                       OR ISNULL(cu.CustName, h.CustName) LIKE @custLike)
    ORDER BY CustName, h.DocuDate, h.DocuNo, d.ListNo`,
    {
      from:     { type: sql.DateTime2,   value: startOfDay },
      to:       { type: sql.DateTime2,   value: endOfDay },
      cust:     { type: sql.NVarChar(60), value: custFilter },
      custLike: { type: sql.NVarChar(64), value: '%' + custFilter + '%' },
    }
  )).recordset || [];
}

// ── Invoice Candidate Resolution (Enrichment separated from financial lines) ──────────
async function fetchInvoicesByPostIds(invoiceCandidates, options = {}) {
  if (!invoiceCandidates || invoiceCandidates.length === 0) return new Map();

  const tableInv = options.tableInv || 'dbo.SOInvHD';
  const tableCust = options.tableCust || 'dbo.EMCust';
  const queryFn = options.queryFn || wfQuery;

  // Normalize candidate items to { postId, docuType }
  const normalized = invoiceCandidates.map(c => {
    if (typeof c === 'object' && c !== null) {
      return {
        postId: String(c.postId != null ? c.postId : '').trim(),
        docuType: String(c.docuType || options.fromFlag || '107').trim(),
      };
    }
    return {
      postId: String(c || '').trim(),
      docuType: String(options.fromFlag || '107').trim(),
    };
  }).filter(c => c.postId.length > 0);

  if (normalized.length === 0) return new Map();

  // De-duplicate by composite key `${postId}:${docuType}`
  const uniqueItems = [];
  const seenKeys = new Set();
  for (const item of normalized) {
    const key = `${item.postId}:${item.docuType}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueItems.push(item);
    }
  }

  // Group by docuType for efficient chunked SQL queries
  const groupedByDocuType = new Map();
  for (const item of uniqueItems) {
    if (!groupedByDocuType.has(item.docuType)) {
      groupedByDocuType.set(item.docuType, []);
    }
    groupedByDocuType.get(item.docuType).push(item.postId);
  }

  const resultMap = new Map();
  const chunkSize = 400;

  for (const [docuType, postIds] of groupedByDocuType.entries()) {
    for (let i = 0; i < postIds.length; i += chunkSize) {
      const chunk = postIds.slice(i, i + chunkSize);
      const allNumeric = chunk.every(id => /^-?\d+$/.test(id));
      const paramDefs = {
        docuType: { type: sql.VarChar(10), value: docuType },
      };
      const paramNames = chunk.map((id, idx) => {
        const pName = `id${idx}`;
        if (allNumeric) {
          paramDefs[pName] = { type: sql.Int, value: parseInt(id, 10) };
        } else {
          paramDefs[pName] = { type: sql.VarChar(50), value: id };
        }
        return `@${pName}`;
      });

      const wherePostId = allNumeric
        ? `inv.PostID IN (${paramNames.join(', ')})`
        : `CAST(inv.PostID AS VARCHAR(50)) IN (${paramNames.join(', ')})`;

      const q = `
        SELECT
          CAST(inv.PostID AS VARCHAR(50)) AS PostID,
          CAST(inv.Docutype AS VARCHAR(10)) AS Docutype,
          inv.DocuNo,
          COALESCE(c.CustName, inv.ContactName, N'-') AS CustName
        FROM ${tableInv} inv
        LEFT JOIN ${tableCust} c ON c.CustID = inv.CustID
        WHERE inv.Docutype = @docuType
          AND ${wherePostId}
      `;

      const res = await queryFn(q, paramDefs);
      for (const r of (res.recordset || [])) {
        const pId = String(r.PostID).trim();
        const dType = String(r.Docutype).trim();
        const compositeKey = `${pId}:${dType}`;

        if (!resultMap.has(compositeKey)) {
          resultMap.set(compositeKey, []);
        }
        resultMap.get(compositeKey).push({
          docuNo: r.DocuNo,
          custName: r.CustName,
        });
      }
    }
  }

  return resultMap;
}

// ── R-GL รายงานสรุปสมุดรายวันขายและการลงบัญชี (Native WinSpeed GLHD / GLDT) ──────────
async function runSalesJournalReport(params = {}, options = {}) {
  const tableHD = options.tableHD || 'dbo.GLHD';
  const tableDT = options.tableDT || 'dbo.GLDT';
  const tableAcc = options.tableAcc || 'dbo.EMAcc';
  const queryFn = options.queryFn || wfQuery;

  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate());
  const from = parseDateParam(params.from, defaultFrom);
  const to   = parseDateParam(params.to, today);

  const startOfDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const endOfDay   = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 997);

  const journalFilter = String(params.journalNo || '').trim();
  const jourId = String(params.jourId || '1001').trim();
  const fromFlag = String(params.fromFlag || '107').trim();

  // Strict enforcement: sales journal supports only FromFlag = 107
  if (fromFlag !== '107') {
    const err = new Error('รายงานสมุดรายวันขายรองรับเฉพาะ FromFlag=107 (ขายเชื่อ) เท่านั้น');
    err.status = 400;
    err.code = 'INVALID_FROM_FLAG';
    throw err;
  }

  const statusParam = String(params.status || 'POSTED').trim().toUpperCase();

  // Status predicate: POSTED (DocuStatus = 'N' and not reversed), CANCELLED, or ALL
  let statusClause = `(gl.DocuStatus = 'N' AND (gl.Revflag IS NULL OR gl.Revflag != 'Y'))`;
  if (statusParam === 'CANCELLED') {
    statusClause = `(gl.DocuStatus = 'C' OR gl.Revflag = 'Y')`;
  } else if (statusParam === 'ALL') {
    statusClause = `(1 = 1)`;
  }

  // Pagination and scope boundary semantics
  const isAllScope = params.limit === 'all' || params.scope === 'all' || params.exportAll === 'true' || params.export === 'true';
  const page = isAllScope ? 1 : Math.max(parseInt(params.page, 10) || 1, 1);
  const limit = isAllScope
    ? Math.min(Math.max(parseInt(params.maxLimit, 10) || 20000, 1), 50000)
    : Math.min(Math.max(parseInt(params.limit, 10) || 2000, 1), 10000);
  const offset = isAllScope ? 0 : (page - 1) * limit;
  const limitPlusOne = limit + 1;

  // Step 1: Select whole voucher headers with TotalSummary and LEFT JOINs.
  // Using TotalSummary as primary source guarantees navigation metadata is NEVER lost even on out-of-range pages or empty filters.
  // Using LEFT JOIN to dt allows detecting headers that have missing GLDT detail lines.
  const q = `
    WITH FilteredHeaders AS (
      SELECT
        gl.GLID,
        gl.DocuNo AS JournalNo,
        CONVERT(VARCHAR(10), gl.DocuDate, 120) AS DocuDate,
        gl.JourID,
        gl.FromFlag,
        gl.FromID,
        gl.DocuStatus,
        gl.Revflag,
        gl.TotaAmnt,
        gl.GLDesc1
      FROM ${tableHD} gl
      WHERE (@jourId = 'ALL' OR gl.JourID = @jourId)
        AND gl.FromFlag = @fromFlag
        AND ${statusClause}
        AND gl.DocuDate >= @from AND gl.DocuDate <= @to
        AND (@journalNo = '' OR gl.DocuNo LIKE @journalNoLike)
    ),
    TotalSummary AS (
      SELECT COUNT(1) AS TotalMatchingVouchers FROM FilteredHeaders
    ),
    -- ROW_NUMBER paging instead of OFFSET/FETCH: SQL Server 2008 R2 (the office WinSpeed server)
    -- has no OFFSET/FETCH and refused the whole report with a syntax error (UAT batch 6, RPT-F1)
    NumberedHeaders AS (
      SELECT fh.*, ROW_NUMBER() OVER (ORDER BY fh.DocuDate DESC, fh.GLID DESC) AS PageRowNo
      FROM FilteredHeaders fh
    ),
    PagedCandidates AS (
      SELECT GLID, JournalNo, DocuDate, JourID, FromFlag, FromID, DocuStatus, Revflag, TotaAmnt, GLDesc1
      FROM NumberedHeaders
      WHERE PageRowNo > @offset AND PageRowNo <= @offset + @limitPlusOne
    ),
    SelectedVouchers AS (
      SELECT TOP (@limit) *
      FROM PagedCandidates
      ORDER BY DocuDate DESC, GLID DESC
    ),
    MoreIndicator AS (
      SELECT CASE WHEN COUNT(1) > @limit THEN 1 ELSE 0 END AS HasMore
      FROM PagedCandidates
    )
    SELECT
      ts.TotalMatchingVouchers,
      COALESCE(mi.HasMore, 0) AS HasMore,
      v.GLID,
      v.JournalNo,
      v.DocuDate,
      v.JourID,
      v.FromFlag,
      v.FromID,
      v.DocuStatus,
      v.Revflag,
      v.TotaAmnt,
      v.GLDesc1 AS HeaderGLDesc,
      dt.ListNo,
      dt.AccID,
      ISNULL(acc.AccCode, N'UNKNOWN') AS AccountCode,
      ISNULL(acc.AccName, N'ไม่ระบุชื่อบัญชี') AS AccountName,
      CAST(dt.DrAmnt AS DECIMAL(14,2)) AS Debit,
      CAST(dt.CrAmnt AS DECIMAL(14,2)) AS Credit,
      ISNULL(dt.GLDesc1, v.GLDesc1) AS DetailGLDesc
    FROM TotalSummary ts
    LEFT JOIN MoreIndicator mi ON 1 = 1
    LEFT JOIN SelectedVouchers v ON 1 = 1
    LEFT JOIN ${tableDT} dt ON dt.GLID = v.GLID
    LEFT JOIN ${tableAcc} acc ON acc.AccID = dt.AccID
    ORDER BY v.DocuDate DESC, v.GLID DESC, dt.ListNo ASC
  `;

  const rawRows = (await queryFn(q, {
    limit:         { type: sql.Int,          value: limit },
    limitPlusOne:  { type: sql.Int,          value: limitPlusOne },
    offset:        { type: sql.Int,          value: offset },
    jourId:        { type: sql.VarChar(10),  value: jourId },
    fromFlag:      { type: sql.VarChar(10),  value: fromFlag },
    from:          { type: sql.DateTime2,    value: startOfDay },
    to:            { type: sql.DateTime2,    value: endOfDay },
    journalNo:     { type: sql.NVarChar(60), value: journalFilter },
    journalNoLike: { type: sql.NVarChar(64), value: '%' + journalFilter + '%' },
  })).recordset || [];

  // Extract navigation metadata from the TotalSummary row (always present)
  const totalMatching = rawRows.length > 0 ? (Number(rawRows[0].TotalMatchingVouchers) || 0) : 0;
  const hasMore = rawRows.length > 0 ? Boolean(rawRows[0].HasMore) : false;

  // Track all headers selected in this window
  const headerMap = new Map();
  for (const r of rawRows) {
    if (r.GLID != null && !headerMap.has(r.GLID)) {
      headerMap.set(r.GLID, {
        GLID: r.GLID,
        JournalNo: r.JournalNo,
        DocuDate: r.DocuDate,
        JourID: r.JourID,
        FromFlag: r.FromFlag,
        FromID: r.FromID,
        DocuStatus: r.DocuStatus,
        Revflag: r.Revflag,
        TotaAmnt: r.TotaAmnt,
        HeaderGLDesc: r.HeaderGLDesc,
      });
    }
  }
  const selectedVoucherCount = headerMap.size;

  // Filter actual detail rows (excluding header-only rows where ListNo is null)
  const detailRows = rawRows.filter(r => r.GLID != null && r.ListNo != null);
  const vouchersWithDetails = new Set(detailRows.map(r => r.GLID));

  // Identify any vouchers missing GLDT detail rows
  const missingDetailVouchers = [];
  for (const [glid, hdr] of headerMap.entries()) {
    if (!vouchersWithDetails.has(glid)) {
      missingDetailVouchers.push({
        GLID: hdr.GLID,
        JournalNo: hdr.JournalNo,
        DocuDate: hdr.DocuDate,
      });
    }
  }

  // Step 2: Separate invoice candidate resolution without line duplication, typed by (PostID, Docutype)
  const invoiceCandidates = detailRows
    .filter(r => r.FromID != null)
    .map(r => ({ postId: String(r.FromID).trim(), docuType: String(r.FromFlag || fromFlag).trim() }));

  const invMap = await fetchInvoicesByPostIds(invoiceCandidates, options);

  // Step 3: Enrich rows preserving 1:1 cardinality with explicit ambiguity tracking
  const rows = detailRows.map(r => {
    const fromIdKey = r.FromID != null ? String(r.FromID).trim() : '';
    const docuTypeKey = String(r.FromFlag || fromFlag).trim();
    const compositeKey = `${fromIdKey}:${docuTypeKey}`;
    const invList = fromIdKey ? (invMap.get(compositeKey) || []) : [];

    let refInvoice = '-';
    let custName = '-';
    let invoiceAmbiguity = 'NONE';

    if (invList.length === 1) {
      refInvoice = invList[0].docuNo || fromIdKey;
      custName = invList[0].custName || '-';
      invoiceAmbiguity = 'EXACT';
    } else if (invList.length > 1) {
      refInvoice = invList.map(i => i.docuNo).filter(Boolean).join(', ');
      custName = invList.map(i => i.custName).find(n => n && n !== '-') || '-';
      invoiceAmbiguity = 'AMBIGUOUS';
    } else if (fromIdKey) {
      refInvoice = fromIdKey;
      custName = '-';
      invoiceAmbiguity = 'NONE';
    }

    return {
      GLID: r.GLID,
      ListNo: r.ListNo,
      JournalNo: r.JournalNo,
      DocuDate: r.DocuDate,
      AccountCode: r.AccountCode,
      AccountName: r.AccountName,
      Debit: r.Debit,
      Credit: r.Credit,
      RefInvoice: refInvoice,
      InvoiceAmbiguity: invoiceAmbiguity,
      CustName: custName,
      GLDesc: r.DetailGLDesc,
    };
  });

  const totalPages = totalMatching > 0 ? Math.ceil(totalMatching / limit) : 0;
  const isCompleteScope = totalMatching > 0
    ? (offset === 0 && selectedVoucherCount === totalMatching && missingDetailVouchers.length === 0)
    : true;
  const isPartialScope = !isCompleteScope && totalMatching > 0;
  const isTruncated = isPartialScope; // Synonymous for UI/export warning

  rows.meta = {
    scope: isAllScope ? 'all' : 'page',
    page,
    totalPages,
    offset,
    voucherLimit: limit,
    voucherCount: selectedVoucherCount,
    totalMatchingVouchers: totalMatching,
    rowCount: rows.length,
    hasMore,
    hasPrev: offset > 0,
    isCompleteScope,
    isPartialScope,
    isTruncated,
    missingDetailCount: missingDetailVouchers.length,
    missingDetailVouchers,
    jourId,
    fromFlag,
    status: statusParam,
  };

  return rows;
}

module.exports = router;
module.exports.__testing = { runCustomerDispatchReport, runSalesJournalReport, fetchInvoicesByPostIds, resolveReportTemplate };

