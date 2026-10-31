'use strict';
/**
 * พิมพ์เอกสาร WinSpeed จาก Sale-App (W2, plan v2, owner 31/10/2569)
 *
 *   GET /api/native-print/104/:docuNo — ใบสั่งจ่ายสินค้า (ตำแหน่งตามฟอร์มกระดาษพิมพ์หัวของ WinSpeed)
 *   GET /api/native-print/116/:docuNo — ใบขน / ใบตัดตั๋วปุ๋ย (WinSpeed ไม่มีฟอร์มลงทะเบียนให้ 116)
 *   GET /api/native-print/107/:docuNo — ใบส่งของ (ตาม "ฟอร์มใบส่งของ" ของ WinSpeed; ปุ๋ยยกเว้น VAT จึงไม่ใช่ใบกำกับภาษี)
 *
 * อ่านจาก dbo ของ WinSpeed อย่างเดียว ใช้ได้ทั้งเอกสารที่ Sale-App ออกและที่ทำใน WinSpeed เอง
 * เลขที่ซ้ำ (พบได้ในข้อมูลเก่า) ต้องแจ้งว่าซ้ำ ไม่เลือกใบใดใบหนึ่งให้เอง
 * หัวบริษัทของใบส่งของมาจาก Header Master (แม่แบบ native-107 หรือ default)
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { getVisibleScope, inScope } = require('../services/visible-scope');

router.use(requireAuth);

const DOCU_NO = /^[A-Za-z0-9-]{3,25}$/;

const noInput = no => ({ no: { type: sql.VarChar(25), value: no } });
const idInput = id => ({ id: { type: sql.Int, value: id } });
const rows = r => r.recordset || [];

// ผู้ใช้ที่เห็นเฉพาะทีมตัวเอง เห็นได้เฉพาะเอกสารของพนักงานขาย/ผู้ใช้ในทีม
async function allowed(user, { empId = null, bookingSoid = null }) {
  const scope = await getVisibleScope(user);
  if (scope.all) return true;
  let salesUserId = null;
  if (bookingSoid != null) {
    salesUserId = rows(await wfQuery('SELECT SalesUserId FROM wf.SalesOrderExt WHERE SOID=@soid',
      { soid: { type: sql.VarChar(50), value: String(bookingSoid) } }))[0]?.SalesUserId ?? null;
  }
  return inScope(scope, { userId: salesUserId, empId });
}

async function load116(no) {
  const heads = rows(await wfQuery(`
    SELECT h.RedemtionID, RTRIM(h.DocuNo) AS DocuNo, CONVERT(varchar(10),h.DocuDate,120) AS DocuDate,
           RTRIM(h.IssueName) AS Receiver, RTRIM(h.CarLicense) AS Plate, h.SumGoodQty, h.DocuStatus, h.IsCheckAll,
           se.EmpCode AS RecorderCode, RTRIM(se.EmpName) AS RecorderName,
           ae.EmpCode AS NativeApproverCode, RTRIM(ae.EmpName) AS NativeApproverName
      FROM dbo.WFRedemtionHD h
      LEFT JOIN dbo.EMEmp se ON se.EmpID=h.SaveEmpID
      LEFT JOIN dbo.EMEmp ae ON ae.EmpID=h.AppvEmpID
     WHERE h.DocuType=116 AND h.DocuNo=@no`, noInput(no)));
  if (heads.length !== 1) return { count: heads.length };
  const head = heads[0];
  const items = rows(await wfQuery(`
    SELECT d.Listno, RTRIM(d.CouponNo) AS CouponNo, RTRIM(g.GoodCode) AS GoodCode,
           RTRIM(COALESCE(c.GoodName, g.GoodName1)) AS GoodName, RTRIM(i.InveName) AS InveName, RTRIM(l.LocaName) AS LocaName,
           d.GoodQty, d.RemaQty, d.PostInv, RTRIM(so.DocuNo) AS DeliveryNo, so.EmpID AS SalesEmpID,
           RTRIM(so.CustName) AS CustName, RTRIM(cu.CustCode) AS CustCode, RTRIM(inv.DocuNo) AS InvoiceNo,
           RTRIM(bk.DocuNo) AS BookingNo, bk.SOID AS BookingSOID
      FROM dbo.WFRedemtionDT d
      LEFT JOIN dbo.WFCoupon c ON c.CouponID=d.CouponID
      LEFT JOIN dbo.EMGood g ON g.GoodID=d.GoodID
      LEFT JOIN dbo.EMInve i ON i.InveID=d.InveID
      LEFT JOIN dbo.EMLoca l ON l.LocaID=d.LocaID
      LEFT JOIN dbo.SOHD so ON so.SOID=c.DocuID AND c.Docutype=104
      LEFT JOIN dbo.EMCust cu ON cu.CustID=so.CustID
      LEFT JOIN dbo.SOInvHD inv ON inv.SOInvID=d.SOInvID
      OUTER APPLY (SELECT TOP 1 b.DocuNo, b.SOID FROM dbo.SODT sd JOIN dbo.SOHD b ON b.SOID=sd.RefSOID AND b.DocuType=103
                    WHERE sd.SOID=so.SOID ORDER BY sd.ListNo) bk
     WHERE d.RedemtionID=@id ORDER BY d.Listno`, idInput(head.RedemtionID)));
  const scales = rows(await wfQuery(`
    SELECT TOP 2 Id, RTRIM(CarNo) AS CarNo, WeightIn, WeightOut, WeightNet, RTRIM(Status) AS Status,
           CONVERT(varchar(16),DateIn,120) AS DateIn, CONVERT(varchar(16),DateOut,120) AS DateOut
      FROM dbo.WGHD WHERE WGType='SO' AND RTRIM(MoveBill)=@no`, noInput(no)));
  const approval = rows(await wfQuery(`
    SELECT TOP 1 e.EmpCode AS ApproverCode, RTRIM(e.EmpName) AS ApproverName, r.SlipSource, r.ExceptionRequired, na.SelfApproval
      FROM wf.NativeDocumentApproval na
      LEFT JOIN dbo.EMEmp e ON e.EmpID=na.ApproverEmpID
      LEFT JOIN wf.NativeManualRedemptionRequest r ON r.RequestId=na.RequestId
     WHERE na.DocuType=116 AND na.NativeDocID=@id`, idInput(head.RedemtionID)))[0] || null;
  return { count: 1, doc: { ...head, items, scale: scales.length === 1 ? scales[0] : null, appApproval: approval } };
}

// ช่องข้อมูลตามฟอร์มเริ่มต้นของ WinSpeed "ใบส่งของ" (soworldfartform.pbl@dr_so_saleorder_tax_worldfart):
// นามผู้ซื้อ = CustBillName หรือคำนำหน้า+ชื่อลูกหนี้ · ที่อยู่ = ที่อยู่ลูกหนี้ · สถานที่ส่งของ = ที่อยู่ในบิล
// วันครบกำหนด = วันที่เอกสาร + เครดิต · ท้ายใบ = ทะเบียนรถ เลขตั๋ว และเลขใบเคลื่อนย้าย (เลขใบ 116) ที่ผูกกับใบนี้
async function load107(no) {
  const heads = rows(await wfQuery(`
    SELECT h.SOInvID, RTRIM(h.DocuNo) AS DocuNo, CONVERT(varchar(10),h.DocuDate,120) AS DocuDate,
           RTRIM(cu.CustCode) AS CustCode,
           RTRIM(CASE ISNULL(cu.CustBillName,'') WHEN '' THEN ISNULL(NULLIF(RTRIM(cu.CustTitle),'')+' ','')+ISNULL(cu.CustName,'')
                 ELSE cu.CustBillName END) AS CustName,
           LTRIM(RTRIM(ISNULL(cu.CustAddr1,'')+' '+ISNULL(cu.CustAddr2,''))) AS CustAddr1,
           LTRIM(RTRIM(ISNULL(cu.District,'')+' '+ISNULL(cu.Amphur,'')+' '+ISNULL(cu.Province,'')+' '+ISNULL(cu.PostCode,''))) AS CustAddr2,
           LTRIM(RTRIM(ISNULL(h.BillAddr1,'')+'  '+ISNULL(h.BillAddr2,''))) AS ShipAddr1,
           LTRIM(RTRIM(ISNULL(h.District,'')+' '+ISNULL(h.Amphur,'')+' '+ISNULL(h.Province,'')+' '+ISNULL(h.PostCode,''))) AS ShipAddr2,
           RTRIM(cu.ContTel) AS Tel, RTRIM(cu.ContFax) AS Fax, RTRIM(h.ContactName) AS ContactName,
           RTRIM(h.InvNo) AS InvNo, CONVERT(varchar(10),h.InvDate,120) AS InvDate, RTRIM(h.CustPONo) AS CustPONo, RTRIM(h.SONo) AS SONo,
           h.CreditDays, CONVERT(varchar(10),DATEADD(day,h.CreditDays,h.DocuDate),120) AS DueDate, CONVERT(varchar(10),h.SendDate,120) AS SendDate,
           h.SumGoodAmnt, RTRIM(h.BillDiscFormula) AS BillDiscFormula, h.BillDiscAmnt, h.BillAftrDiscAmnt, h.AdvnAmnt, h.AftrAdvnAmnt,
           h.VATType, h.VATRate, h.VATAmnt, h.NetAmnt, h.DocuStatus, h.PostGL, h.CouponFlag,
           h.EmpID AS SalesEmpID, RTRIM(e.EmpCode) AS SalesCode,
           RTRIM(ISNULL(NULLIF(RTRIM(e.EmpTitle),'')+' ','')+ISNULL(e.EmpName,'')) AS SalesName,
           RTRIM(b.BrchName) AS BrchName,
           (SELECT RTRIM(r.Remark) FROM dbo.SOInvHDRemark r WHERE r.SOInvID=h.SOInvID AND r.ListNo=1) AS Remark1,
           (SELECT RTRIM(r.Remark) FROM dbo.SOInvHDRemark r WHERE r.SOInvID=h.SOInvID AND r.ListNo=2) AS Remark2,
           (SELECT RTRIM(r.Remark) FROM dbo.SOInvHDRemark r WHERE r.SOInvID=h.SOInvID AND r.ListNo=3) AS Remark3
      FROM dbo.SOInvHD h
      LEFT JOIN dbo.EMCust cu ON cu.CustID=h.CustID
      LEFT JOIN dbo.EMEmp e ON e.EmpID=h.EmpID
      LEFT JOIN dbo.EMBrch b ON b.BrchID=h.BrchID
     WHERE h.DocuType=107 AND h.DocuNo=@no`, noInput(no)));
  if (heads.length !== 1) return { count: heads.length };
  const head = heads[0];
  const items = rows(await wfQuery(`
    SELECT d.ListNo, RTRIM(g.GoodCode) AS GoodCode, RTRIM(COALESCE(d.GoodName, g.GoodName1)) AS GoodName,
           d.GoodQty2, RTRIM(u.GoodUnitName) AS UnitName, d.GoodPrice2, RTRIM(d.GoodDiscFomula) AS GoodDiscFormula, d.GoodAmnt,
           RTRIM(COALESCE(ref.DocuNo, d.RefDocuno)) AS RefDocuNo, RTRIM(i.InveName) AS InveName
      FROM dbo.SOInvDT d
      LEFT JOIN dbo.SOHD ref ON ref.SOID=d.RefID AND ref.DocuType=104
      LEFT JOIN dbo.EMGood g ON g.GoodID=d.GoodID
      LEFT JOIN dbo.EMGoodUnit u ON u.GoodUnitID=d.GoodUnitID2
      LEFT JOIN dbo.EMInve i ON i.InveID=d.InveID
     WHERE d.SOInvID=@id ORDER BY d.ListNo`, idInput(head.SOInvID)));
  const refs = rows(await wfQuery(`
    SELECT DISTINCT RTRIM(r.DocuNo) AS SlipNo, RTRIM(rd.CouponNo) AS CouponNo, RTRIM(r.CarLicense) AS Plate
      FROM dbo.WFRedemtionDT rd
      JOIN dbo.WFRedemtionHD r ON r.RedemtionID=rd.RedemtionID AND r.DocuType=116
     WHERE rd.SOInvID=@id`, idInput(head.SOInvID)));
  const uniq = key => [...new Set(refs.map(r => r[key]).filter(Boolean))];
  const { resolveReportTemplate } = require('./reports').__testing;
  const header = (await resolveReportTemplate('native-107').catch(() => null))?.header || null;
  return { count: 1, doc: { ...head, items, slips: uniq('SlipNo'), coupons: uniq('CouponNo'), plates: uniq('Plate'), company: header } };
}

// ช่องข้อมูลตามฟอร์มเริ่มต้นของ WinSpeed "ใบสั่งจ่ายสินค้า" (worldfertdaotai.pbl@dr_so_delivery_order_pre)
// ซึ่งพิมพ์เฉพาะข้อมูลลงกระดาษที่พิมพ์หัวไว้แล้ว · ใบที่ ClearSO = 'Y' ไม่แสดง เหมือนในฟอร์ม
// D/O = เลขตั๋วของใบนี้ต่อกันด้วยจุลภาค (เท่ากับ dbo.ufn_GetCouponNo) · ข้อความใต้ D/O มาจาก dbo.Define_104
async function load104(no) {
  const heads = rows(await wfQuery(`
    SELECT h.SOID, RTRIM(h.DocuNo) AS DocuNo, CONVERT(varchar(10),h.DocuDate,120) AS DocuDate,
           RTRIM(cu.CustCode) AS CustCode,
           RTRIM(CASE ISNULL(cu.CustBillName,'') WHEN '' THEN ISNULL(cu.CustTitle+' ',' ')+ISNULL(cu.CustName,' ')
                 ELSE cu.CustBillName END) AS CustName,
           RTRIM(ISNULL(cu.CustAddr1+' ','')+ISNULL(cu.CustAddr2,'')) AS Address1,
           RTRIM(ISNULL(cu.District+' ','')+ISNULL(cu.Amphur+' ','')+ISNULL(cu.Province+' ','')+ISNULL(cu.PostCode,'')) AS Address2,
           RTRIM(ISNULL(h.ShipToAddr1+' ','')+ISNULL(h.ShipToAddr2,'')) AS ShipToAddress1,
           RTRIM(ISNULL(h.District+' ','')+ISNULL(h.Amphur+' ','')+ISNULL(h.Province+' ','')+ISNULL(h.PostCode,'')) AS ShipToAddress2,
           RTRIM(cu.ContTel) AS ContTel, RTRIM(h.CustPONo) AS CustPONo, RTRIM(ISNULL(e.EmpName,'')) AS EmpName, h.EmpID AS SalesEmpID,
           h.CreditDays, CONVERT(varchar(10),h.ShipDate,120) AS ShipDate, RTRIM(h.RefNo) AS RefNo, CONVERT(varchar(10),h.RefDate,120) AS RefDate,
           h.SumGoodAmnt, h.NetAmnt, h.DocuStatus,
           (SELECT RTRIM(r.Remark) FROM dbo.SOHDRemark r WHERE r.SOID=h.SOID AND r.ListNo=1) AS Remark1,
           (SELECT RTRIM(r.Remark) FROM dbo.SOHDRemark r WHERE r.SOID=h.SOID AND r.ListNo=2) AS Remark2,
           (SELECT RTRIM(r.Remark) FROM dbo.SOHDRemark r WHERE r.SOID=h.SOID AND r.ListNo=3) AS Remark3,
           (SELECT TOP 1 RTRIM(d4.difine1) FROM dbo.Define_104 d4 WHERE d4.ID=h.SOID) AS Define1,
           ISNULL((SELECT TOP 1 RTRIM(ISNULL(rh.CarLicense,'')) FROM dbo.WFRedemtionDT rd
                     LEFT JOIN dbo.WFRedemtionHD rh ON rh.RedemtionID=rd.RedemtionID
                     LEFT JOIN dbo.WFCoupon c ON c.CouponID=rd.CouponID
                    WHERE c.DocuID=h.SOID),'') AS CarLicense,
           STUFF((SELECT ', '+RTRIM(c.CouponNo) FROM dbo.SODT sd
                    JOIN dbo.WFCoupon c ON c.DocuID=h.SOID AND c.RefListNo=sd.ListNo
                   WHERE sd.SOID=h.SOID AND NULLIF(RTRIM(c.CouponNo),'') IS NOT NULL
                   ORDER BY sd.ListNo FOR XML PATH('')),1,2,'') AS CouponNo,
           (SELECT TOP 1 b.SOID FROM dbo.SODT sd JOIN dbo.SOHD b ON b.SOID=sd.RefSOID AND b.DocuType=103
             WHERE sd.SOID=h.SOID ORDER BY sd.ListNo) AS BookingSOID
      FROM dbo.SOHD h
      LEFT JOIN dbo.EMCust cu ON cu.CustID=h.CustID
      LEFT JOIN dbo.EMEmp e ON e.EmpID=h.EmpID
     WHERE h.DocuType=104 AND h.DocuNo=@no AND ISNULL(h.ClearSO,'N')<>'Y'`, noInput(no)));
  if (heads.length !== 1) return { count: heads.length };
  const head = heads[0];
  const items = rows(await wfQuery(`
    SELECT d.ListNo, d.GoodQty2, RTRIM(u.GoodUnitName) AS UnitName, RTRIM(g.GoodCode) AS GoodCode,
           RTRIM(COALESCE(d.GoodName, g.GoodName1)) AS GoodName, d.GoodPrice2, d.GoodAmnt
      FROM dbo.SODT d
      LEFT JOIN dbo.EMGood g ON g.GoodID=d.GoodID
      LEFT JOIN dbo.EMGoodUnit u ON u.GoodUnitID=d.GoodUnitID2
     WHERE d.SOID=@id ORDER BY d.ListNo`, idInput(head.SOID)));
  return { count: 1, doc: { ...head, items } };
}

function handler(type, loader) {
  return async (req, res) => {
    const no = String(req.params.docuNo || '').trim();
    if (!DOCU_NO.test(no)) return res.status(400).json({ code: 'DOC_NO_INVALID', message: 'เลขที่เอกสารไม่ถูกต้อง' });
    try {
      const r = await loader(no);
      if (r.count === 0) return res.status(404).json({ code: 'DOC_NOT_FOUND', message: `ไม่พบใบ ${type} เลขที่ ${no}` });
      if (r.count > 1) return res.status(409).json({ code: 'DOC_AMBIGUOUS', message: `พบใบ ${type} เลขที่ ${no} มากกว่าหนึ่งใบ กรุณาตรวจใน WinSpeed` });
      const empId = type === 116 ? r.doc.items[0]?.SalesEmpID : r.doc.SalesEmpID;
      const bookingSoid = type === 116 ? r.doc.items[0]?.BookingSOID : type === 104 ? r.doc.BookingSOID : null;
      if (!(await allowed(req.user, { empId, bookingSoid })))
        return res.status(404).json({ code: 'DOC_NOT_FOUND', message: `ไม่พบใบ ${type} เลขที่ ${no}` });
      res.json({ type, ...r.doc });
    } catch (e) {
      console.error(`[native-print/${type}]`, e.message);
      res.status(500).json({ code: 'DOC_PRINT_FAILED', message: 'โหลดเอกสารไม่สำเร็จ' });
    }
  };
}

// who may print: services/role-capabilities.js (native.print-104 / native.print-116 / native.print-107)
router.get('/104/:docuNo', requireCapability('native.print-104'), handler(104, load104));
router.get('/116/:docuNo', requireCapability('native.print-116'), handler(116, load116));
router.get('/107/:docuNo', requireCapability('native.print-107'), handler(107, load107));

module.exports = router;
module.exports.__testing = { load104, load116, load107 };
