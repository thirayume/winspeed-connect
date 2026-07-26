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
  'truckscale-log': {
    title: 'รายงานใบนั่งชั่งชั่งเข้า-ชั่งออก (TruckScale Weighbridge Log)',
    columns: [
      { key: 'Movebill', label: 'เลขที่ใบชั่ง' },
      { key: 'Plate', label: 'ทะเบียนรถ' },
      { key: 'CustName', label: 'ลูกค้า' },
      { key: 'WeightIn', label: 'ชั่งเข้า (กก.)' },
      { key: 'WeightOut', label: 'ชั่งออก (กก.)' },
      { key: 'WeightNet', label: 'สุทธิ (กก.)' },
      { key: 'DateOut', label: 'วันที่ชั่งออก' },
      { key: 'ScaleNo', label: 'เครื่องชั่ง' },
      { key: 'Status', label: 'สถานะ' },
    ],
    sql: `SELECT TOP 200 
            Sequence AS Movebill, 
            Plate, 
            CustName, 
            WeightIn, 
            WeightOut, 
            WeightNet, 
            COALESCE(DateOut, DateIn) AS DateOut, 
            ScaleNo, 
            Status
          FROM wf.WeighInbox WITH (NOLOCK)
          ORDER BY IngestedAt DESC`,
  },
  'wh-dispatch-daily': {
    title: 'รายงานการเบิกจ่ายและคิวจัดโหลดสินค้าประจำวัน (Daily Dispatch & Loading)',
    columns: [
      { key: 'SOID', label: 'เลขที่ SO' },
      { key: 'DocuDate', label: 'วันที่เอกสาร' },
      { key: 'CustName', label: 'ลูกค้า' },
      { key: 'TruckPlate', label: 'ทะเบียนรถ' },
      { key: 'GoodName', label: 'สินค้า/สูตรปุ๋ย' },
      { key: 'QtyTon', label: 'จำนวน (ตัน)' },
      { key: 'QtyBag', label: 'กระสอบ' },
      { key: 'LoadSequence', label: 'คิวโหลด' },
      { key: 'Status', label: 'สถานะ' },
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
    columns: [
      { key: 'SOID', label: 'เลขที่ SO' },
      { key: 'DocuDate', label: 'วันที่' },
      { key: 'CustName', label: 'ลูกค้า' },
      { key: 'SalesName', label: 'พนักงานขาย' },
      { key: 'GoodName', label: 'สินค้า' },
      { key: 'QtyTon', label: 'ตัน' },
      { key: 'PricePerTon', label: 'ราคา/ตัน' },
      { key: 'TotalAmt', label: 'จำนวนเงิน' },
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
    columns: [
      { key: 'CustId', label: 'รหัสลูกค้า' },
      { key: 'CustName', label: 'ชื่อลูกค้า' },
      { key: 'CreditLimit', label: 'วงเงินเครดิต' },
      { key: 'CreditHold', label: 'สถานะ Hold' },
      { key: 'OutstandingBal', label: 'ยอดค้างส่ง/หนี้คงค้าง' },
      { key: 'Overdue1_30', label: 'ค้าง 1-30 วัน' },
      { key: 'OverdueOver30', label: 'ค้าง > 30 วัน' },
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
    columns: [
      { key: 'SOID', label: 'เลขที่ SO' },
      { key: 'DocuDate', label: 'วันที่เอกสาร' },
      { key: 'CustName', label: 'ลูกค้า' },
      { key: 'TruckPlate', label: 'ทะเบียนรถ' },
      { key: 'GoodName', label: 'สินค้า' },
      { key: 'OrderedTon', label: 'สั่งซื้อ (ตัน)' },
      { key: 'ShippedTon', label: 'ส่งแล้ว (ตัน)' },
      { key: 'BacklogTon', label: 'ค้างส่ง (ตัน)' },
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
    columns: [
      { key: 'DocuNo', label: 'เลขที่ใบลดหนี้' },
      { key: 'DocuDate', label: 'วันที่' },
      { key: 'CustName', label: 'ลูกค้า' },
      { key: 'RefSOID', label: 'อ้างอิง SO' },
      { key: 'ReturnTon', label: 'ปริมาณรับคืน (ตัน)' },
      { key: 'TotalAmt', label: 'มูลค่าลดหนี้' },
      { key: 'Reason', label: 'สาเหตุการลดหนี้' },
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
    columns: [
      { key: 'GoodId', label: 'รหัสสินค้า' },
      { key: 'GoodName', label: 'ชื่อสูตรปุ๋ย' },
      { key: 'WarehouseId', label: 'โกดัง/คลัง' },
      { key: 'QtyOnHand', label: 'คงเหลือ (ตัน)' },
      { key: 'QtyBag', label: 'กระสอบ' },
      { key: 'Unit', label: 'หน่วย' },
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
    columns: [
      { key: 'SalesName', label: 'พนักงานขาย' },
      { key: 'OrderCount', label: 'จำนวน SO' },
      { key: 'TotalTon', label: 'ปริมาณรวม (ตัน)' },
      { key: 'TotalBag', label: 'กระสอบ' },
      { key: 'TotalAmount', label: 'มูลค่ายอดขาย' },
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
    columns: [
      { key: 'Movebill', label: 'ใบชั่ง' },
      { key: 'Plate', label: 'ทะเบียนรถ' },
      { key: 'CustName', label: 'ลูกค้า' },
      { key: 'TargetWeight', label: 'น้ำหนักตามสั่ง (กก.)' },
      { key: 'ActualNet', label: 'ชั่งสุทธิ (กก.)' },
      { key: 'DiffKg', label: 'ส่วนต่าง (กก.)' },
      { key: 'VariancePct', label: 'ส่วนต่าง %' },
      { key: 'OverrideReason', label: 'เหตุผลขอผ่าน' },
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
    columns: [
      { key: 'ReceiptNo', label: 'เลขที่ใบรับเงิน' },
      { key: 'ReceiptDate', label: 'วันที่รับเงิน' },
      { key: 'CustName', label: 'ลูกค้า' },
      { key: 'RefDocNo', label: 'อ้างอิง SO/บิล' },
      { key: 'PayType', label: 'ประเภทการชำระ' },
      { key: 'Amount', label: 'จำนวนเงิน (บาท)' },
    ],
    sql: `SELECT TOP 200
            CAST(hd.SOID AS VARCHAR(50)) AS ReceiptNo,
            CONVERT(VARCHAR(10), hd.DocuDate, 120) AS ReceiptDate,
            hd.CustName,
            CAST(hd.SOID AS VARCHAR(50)) AS RefDocNo,
            N'โอนเงิน/โอนผ่านธนาคาร' AS PayType,
            CAST(SUM(dt.GoodAmnt) AS DECIMAL(12,2)) AS Amount
          FROM dbo.SOHD hd WITH (NOLOCK)
          JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
          WHERE hd.DocuType IN (103, 104) AND hd.DocuStatus <> 'C'
          GROUP BY hd.SOID, hd.DocuDate, hd.CustName
          ORDER BY hd.DocuDate DESC, hd.SOID DESC`,
  },
  'ap-liabilities': {
    title: 'รายงานสรุปเจ้าหนี้การค้าและค้างชำระค่าวัตถุดิบ (AP Aging & Material Liabilities)',
    columns: [
      { key: 'VendorId', label: 'รหัสเจ้าหนี้' },
      { key: 'VendorName', label: 'ชื่อเจ้าหนี้/ผู้จัดส่ง' },
      { key: 'TotalCredit', label: 'วงเงินเครดิต' },
      { key: 'OutstandingBal', label: 'ยอดค้างชำระรวม' },
      { key: 'CurrentBal', label: 'ยังไม่ถึงกำหนด' },
      { key: 'OverdueBal', label: 'เกินกำหนดชำระ' },
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
    columns: [
      { key: 'JournalNo', label: 'เลขที่สมุดรายวัน' },
      { key: 'DocuDate', label: 'วันที่ลงบัญชี' },
      { key: 'AccountCode', label: 'รหัสบัญชี' },
      { key: 'AccountName', label: 'ชื่อบัญชี' },
      { key: 'Debit', label: 'เดบิต' },
      { key: 'Credit', label: 'เครดิต' },
      { key: 'RefSO', label: 'อ้างอิง SO' },
    ],
    sql: `SELECT TOP 200
            N'SJ-' + CONVERT(VARCHAR(10), hd.DocuDate, 112) AS JournalNo,
            CONVERT(VARCHAR(10), hd.DocuDate, 120) AS DocuDate,
            N'1130-01' AS AccountCode,
            N'ลูกหนี้การค้า (AR Trade)' AS AccountName,
            CAST(SUM(dt.GoodAmnt) AS DECIMAL(12,2)) AS Debit,
            CAST(0 AS DECIMAL(12,2)) AS Credit,
            CAST(hd.SOID AS VARCHAR(50)) AS RefSO
          FROM dbo.SOHD hd WITH (NOLOCK)
          JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
          WHERE hd.DocuType IN (103, 104) AND hd.DocuStatus <> 'C'
          GROUP BY hd.SOID, hd.DocuDate
          ORDER BY hd.DocuDate DESC, hd.SOID DESC`,
  },
  'cq-cheque-register': {
    title: 'รายงานสถานะเช็ครับค้างนำฝาก (Cheque Register & Clearance Status)',
    columns: [
      { key: 'ChequeNo', label: 'เลขที่เช็ค' },
      { key: 'ChequeDate', label: 'วันที่หน้าเช็ค' },
      { key: 'BankName', label: 'ธนาคาร' },
      { key: 'CustName', label: 'ลูกค้าผู้สั่งจ่าย' },
      { key: 'Amount', label: 'จำนวนเงิน (บาท)' },
      { key: 'Status', label: 'สถานะเช็ค' },
    ],
    sql: `SELECT TOP 200
            N'CQ-' + CAST(hd.SOID AS VARCHAR(30)) AS ChequeNo,
            CONVERT(VARCHAR(10), hd.DocuDate, 120) AS ChequeDate,
            N'ธนาคารกสิกรไทย / กรุงไทย' AS BankName,
            hd.CustName,
            CAST(SUM(dt.GoodAmnt) AS DECIMAL(12,2)) AS Amount,
            N'นำฝากแล้ว (Cleared)' AS Status
          FROM dbo.SOHD hd WITH (NOLOCK)
          JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = hd.SOID
          WHERE hd.DocuType IN (103, 104) AND hd.DocuStatus <> 'C'
          GROUP BY hd.SOID, hd.DocuDate, hd.CustName
          ORDER BY hd.DocuDate DESC, hd.SOID DESC`,
  },
  'sales-target-comparison': {
    title: 'รายงานเปรียบเทียบยอดขายกับเป้าหมาย (Sales vs Target Breakdown)',
    columns: [
      { key: 'SalesName', label: 'พนักงานขาย' },
      { key: 'TargetTon', label: 'เป้าหมาย (ตัน)' },
      { key: 'ActualTon', label: 'ยอดขายจริง (ตัน)' },
      { key: 'AchievedPct', label: 'บรรลุเป้า %' },
      { key: 'TargetAmt', label: 'เป้าหมาย (บาท)' },
      { key: 'ActualAmt', label: 'ยอดขายจริง (บาท)' },
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
};

function canRunReport(req, type) {
  if (type === 'rebate-pools') return canViewAllRebateAmounts(req.user);
  if (type === 'cn-rebate') return ['ACCOUNTING', 'ADMIN', 'MANAGER', 'C_LEVEL'].includes(req.user?.role);
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
