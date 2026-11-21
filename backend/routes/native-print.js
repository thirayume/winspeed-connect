'use strict';
/**
 * พิมพ์เอกสาร WinSpeed จาก Sale-App (W2, plan v2, owner 31/10/2569)
 *
 *   GET /api/native-print/104/:docuNo — ใบสั่งจ่ายสินค้า (ตำแหน่งตามฟอร์มกระดาษพิมพ์หัวของ WinSpeed)
 *   GET /api/native-print/116/:docuNo — ใบขน / ใบตัดตั๋วปุ๋ย (WinSpeed ไม่มีฟอร์มลงทะเบียนให้ 116)
 *   GET /api/native-print/107/:docuNo — ใบส่งของ (ตาม "ฟอร์มใบส่งของ" ของ WinSpeed; ปุ๋ยยกเว้น VAT จึงไม่ใช่ใบกำกับภาษี)
 *   POST /api/native-print/:type/:docuNo/printed — บันทึกการกดพิมพ์ลง wf.NativePrintLog (migration 164)
 *
 * อ่านจาก dbo ของ WinSpeed อย่างเดียว (บันทึกการพิมพ์เขียนเฉพาะ wf) ใช้ได้ทั้งเอกสารที่ Sale-App ออกและที่ทำใน WinSpeed เอง
 * เลขที่ซ้ำ (พบได้ในข้อมูลเก่า) ต้องแจ้งว่าซ้ำ ไม่เลือกใบใดใบหนึ่งให้เอง
 * หัวบริษัทของใบส่งของมาจาก Header Master (แม่แบบ native-107 หรือ default)
 */
const router = require('express').Router();
const { sql, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { getVisibleScope, inScope } = require('../services/visible-scope');
const { businessIds, actorPerspective } = require('../services/business-identity');

router.use(requireAuth);

const DOCU_NO = /^[A-Za-z0-9-]{3,25}$/;

const noInput = no => ({ no: { type: sql.VarChar(25), value: no } });
const idInput = id => ({ id: { type: sql.Int, value: id } });
const rows = r => r.recordset || [];

// ผู้ใช้ที่เห็นเฉพาะทีมตัวเอง เห็นได้เฉพาะเอกสารของพนักงานขาย/ผู้ใช้ในทีม
async function allowed(user, owners, query = wfQuery) {
  const scope = await getVisibleScope(user, query);
  const actor = actorPerspective(user);
  const actorScope = actor === user ? scope : await getVisibleScope(actor, query);
  if (scope.all && actorScope.all) return true;
  if (!Array.isArray(owners) || !owners.length) return false;

  // Fetch booking owners once per batch instead of querying per print line.
  const bookingIds = [...new Set(owners.map(o => o.bookingSoid)
    .filter(id => id != null && String(id).trim() !== '').map(String))];
  const salesByBooking = new Map();
  for (let offset = 0; offset < bookingIds.length; offset += 500) {
    const batch = bookingIds.slice(offset, offset + 500);
    const inputs = {}, names = batch.map((id, index) => {
      const key = `booking${index}`;
      inputs[key] = { type: sql.VarChar(50), value: id };
      return `@${key}`;
    });
    const found = rows(await query(`SELECT SOID, SalesUserId FROM wf.SalesOrderExt WHERE SOID IN (${names.join(',')})`, inputs));
    for (const row of found) salesByBooking.set(String(row.SOID), row.SalesUserId);
  }
  return owners.every(owner => {
    const identity = { userId: salesByBooking.get(String(owner.bookingSoid)) ?? null, empId: owner.empId };
    return inScope(scope, identity) && inScope(actorScope, identity);
  });
}

async function load116(no, dataWindow, query = wfQuery) {
  const heads = rows(await query(`
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
  const items = rows(await query(`
    SELECT d.Listno, RTRIM(d.CouponNo) AS CouponNo, RTRIM(g.GoodCode) AS GoodCode,
           RTRIM(COALESCE(c.GoodName, g.GoodName1)) AS GoodName, RTRIM(i.InveName) AS InveName, RTRIM(l.LocaName) AS LocaName,
           d.GoodQty, d.RemaQty, d.PostInv, RTRIM(so.DocuNo) AS DeliveryNo,
           CONVERT(varchar(10),so.DocuDate,120) AS DeliveryDocuDate, so.EmpID AS SalesEmpID,
           RTRIM(so.CustName) AS CustName, RTRIM(cu.CustCode) AS CustCode, RTRIM(inv.DocuNo) AS InvoiceNo,
           CONVERT(varchar(10),inv.DocuDate,120) AS InvoiceDocuDate,
           RTRIM(bk.DocuNo) AS BookingNo, bk.SOID AS BookingSOID, CONVERT(varchar(10),bk.DocuDate,120) AS BookingDocuDate
      FROM dbo.WFRedemtionDT d
      LEFT JOIN dbo.WFCoupon c ON c.CouponID=d.CouponID
      LEFT JOIN dbo.EMGood g ON g.GoodID=d.GoodID
      LEFT JOIN dbo.EMInve i ON i.InveID=d.InveID
      LEFT JOIN dbo.EMLoca l ON l.LocaID=d.LocaID
      LEFT JOIN dbo.SOHD so ON so.SOID=c.DocuID AND c.Docutype=104
      LEFT JOIN dbo.EMCust cu ON cu.CustID=so.CustID
      LEFT JOIN dbo.SOInvHD inv ON inv.SOInvID=d.SOInvID
      OUTER APPLY (SELECT TOP 1 b.DocuNo, b.SOID, b.DocuDate FROM dbo.SODT sd JOIN dbo.SOHD b ON b.SOID=sd.RefSOID AND b.DocuType=103
                    WHERE sd.SOID=so.SOID ORDER BY sd.ListNo) bk
     WHERE d.RedemtionID=@id ORDER BY d.Listno`, idInput(head.RedemtionID)));
  const scales = rows(await query(`
    SELECT TOP 2 Id, RTRIM(CarNo) AS CarNo, WeightIn, WeightOut, WeightNet, RTRIM(Status) AS Status,
           CONVERT(varchar(16),DateIn,120) AS DateIn, CONVERT(varchar(16),DateOut,120) AS DateOut
      FROM dbo.WGHD WHERE WGType='SO' AND RTRIM(MoveBill)=@no
       AND COALESCE(DateOut,DateIn)>=@globalStartDate`, { ...noInput(no), globalStartDate: { type: sql.Date, value: dataWindow.businessDate } }));
  const approval = rows(await query(`
    SELECT TOP 1 COALESCE(RTRIM(e.EmpCode), CASE WHEN na.ApproverEmpID IS NULL THEN 'ADMIN' END) AS ApproverCode,
           COALESCE(RTRIM(e.EmpName), CASE WHEN na.ApproverEmpID IS NULL THEN RTRIM(au.DisplayName) END) AS ApproverName,
           r.SlipSource, r.ExceptionRequired, na.SelfApproval
      FROM wf.NativeDocumentApproval na
      LEFT JOIN dbo.EMEmp e ON e.EmpID=na.ApproverEmpID
      -- an ADMIN approver without a WinSpeed employee (migration 257) prints as ADMIN and its Sale-App name
      LEFT JOIN wf.AppUser au ON au.Id=na.ApproverUserId
      LEFT JOIN wf.NativeManualRedemptionRequest r ON r.RequestId=na.RequestId
     WHERE na.DocuType=116 AND na.NativeDocID=@id`, idInput(head.RedemtionID)))[0] || null;
  return { count: 1, doc: { ...head, items, scale: scales.length === 1 ? scales[0] : null, appApproval: approval } };
}

// ช่องข้อมูลตามฟอร์มเริ่มต้นของ WinSpeed "ใบส่งของ" (soworldfartform.pbl@dr_so_saleorder_tax_worldfart):
// นามผู้ซื้อ = CustBillName หรือคำนำหน้า+ชื่อลูกหนี้ · ที่อยู่ = ที่อยู่ลูกหนี้ · สถานที่ส่งของ = ที่อยู่ในบิล
// วันครบกำหนด = วันที่เอกสาร + เครดิต · ท้ายใบ = ทะเบียนรถ เลขตั๋ว และเลขใบเคลื่อนย้าย (เลขใบ 116) ที่ผูกกับใบนี้
async function load107(no, dataWindow, query = wfQuery) {
  const heads = rows(await query(`
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
           (SELECT CASE WHEN COUNT(*)=1 THEN CONVERT(varchar(10),MIN(s.DocuDate),120) ELSE NULL END FROM dbo.SOHD s WHERE s.DocuNo=h.SONo AND s.DocuType IN (103,104)) AS SONoDocuDate,
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
  const items = rows(await query(`
    SELECT d.ListNo, RTRIM(g.GoodCode) AS GoodCode, RTRIM(COALESCE(d.GoodName, g.GoodName1)) AS GoodName,
           d.GoodQty2, RTRIM(u.GoodUnitName) AS UnitName, d.GoodPrice2, RTRIM(d.GoodDiscFomula) AS GoodDiscFormula, d.GoodAmnt,
           RTRIM(COALESCE(ref.DocuNo, d.RefDocuno)) AS RefDocuNo, CONVERT(varchar(10),ref.DocuDate,120) AS RefDocuDate, RTRIM(i.InveName) AS InveName
      FROM dbo.SOInvDT d
      LEFT JOIN dbo.SOHD ref ON ref.SOID=d.RefID AND ref.DocuType=104
      LEFT JOIN dbo.EMGood g ON g.GoodID=d.GoodID
      LEFT JOIN dbo.EMGoodUnit u ON u.GoodUnitID=d.GoodUnitID2
      LEFT JOIN dbo.EMInve i ON i.InveID=d.InveID
     WHERE d.SOInvID=@id ORDER BY d.ListNo`, idInput(head.SOInvID)));
  const refs = rows(await query(`
    SELECT DISTINCT RTRIM(r.DocuNo) AS SlipNo, RTRIM(rd.CouponNo) AS CouponNo, RTRIM(r.CarLicense) AS Plate
      FROM dbo.WFRedemtionDT rd
      JOIN dbo.WFRedemtionHD r ON r.RedemtionID=rd.RedemtionID AND r.DocuType=116
     WHERE rd.SOInvID=@id AND r.DocuDate>=@globalStartDate`, { ...idInput(head.SOInvID), globalStartDate: { type: sql.Date, value: dataWindow.businessDate } }));
  const uniq = key => [...new Set(refs.map(r => r[key]).filter(Boolean))];
  const { resolveReportTemplate } = require('./reports').__testing;
  const header = (await resolveReportTemplate('native-107').catch(() => null))?.header || null;
  return { count: 1, doc: { ...head, items, slips: uniq('SlipNo'), coupons: uniq('CouponNo'), plates: uniq('Plate'), company: header } };
}

// ช่องข้อมูลตามฟอร์มเริ่มต้นของ WinSpeed "ใบสั่งจ่ายสินค้า" (worldfertdaotai.pbl@dr_so_delivery_order_pre)
// ซึ่งพิมพ์เฉพาะข้อมูลลงกระดาษที่พิมพ์หัวไว้แล้ว · ใบที่ ClearSO = 'Y' ไม่แสดง เหมือนในฟอร์ม
// D/O = เลขตั๋วของใบนี้ต่อกันด้วยจุลภาค (เท่ากับ dbo.ufn_GetCouponNo) · ข้อความใต้ D/O มาจาก dbo.Define_104
async function load104(no, dataWindow, query = wfQuery) {
  const heads = rows(await query(`
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
           (SELECT CASE WHEN COUNT(*)=1 THEN CONVERT(varchar(10),MIN(src.DocuDate),120) ELSE NULL END FROM dbo.SOHD src WHERE src.DocuNo=h.RefNo) AS RefNoDocuDate,
           h.SumGoodAmnt, h.NetAmnt, h.DocuStatus,
           (SELECT RTRIM(r.Remark) FROM dbo.SOHDRemark r WHERE r.SOID=h.SOID AND r.ListNo=1) AS Remark1,
           (SELECT RTRIM(r.Remark) FROM dbo.SOHDRemark r WHERE r.SOID=h.SOID AND r.ListNo=2) AS Remark2,
           (SELECT RTRIM(r.Remark) FROM dbo.SOHDRemark r WHERE r.SOID=h.SOID AND r.ListNo=3) AS Remark3,
           (SELECT TOP 1 RTRIM(d4.difine1) FROM dbo.Define_104 d4 WHERE d4.ID=h.SOID) AS Define1,
           ISNULL((SELECT TOP 1 RTRIM(ISNULL(rh.CarLicense,'')) FROM dbo.WFRedemtionDT rd
                     LEFT JOIN dbo.WFRedemtionHD rh ON rh.RedemtionID=rd.RedemtionID
                     LEFT JOIN dbo.WFCoupon c ON c.CouponID=rd.CouponID
                    WHERE c.DocuID=h.SOID AND c.DocuType=104 AND rh.DocuType=116 AND rh.DocuDate>=@globalStartDate),'') AS CarLicense,
           STUFF((SELECT ', '+RTRIM(c.CouponNo) FROM dbo.SODT sd
                    JOIN dbo.WFCoupon c ON c.DocuID=h.SOID AND c.RefListNo=sd.ListNo
                   WHERE sd.SOID=h.SOID AND NULLIF(RTRIM(c.CouponNo),'') IS NOT NULL
                   ORDER BY sd.ListNo FOR XML PATH('')),1,2,'') AS CouponNo,
           (SELECT TOP 1 b.SOID FROM dbo.SODT sd JOIN dbo.SOHD b ON b.SOID=sd.RefSOID AND b.DocuType=103
             WHERE sd.SOID=h.SOID ORDER BY sd.ListNo) AS BookingSOID,
           (SELECT TOP 1 CONVERT(varchar(10),b.DocuDate,120) FROM dbo.SODT sd JOIN dbo.SOHD b ON b.SOID=sd.RefSOID AND b.DocuType=103
             WHERE sd.SOID=h.SOID ORDER BY sd.ListNo) AS BookingDocuDate
      FROM dbo.SOHD h
      LEFT JOIN dbo.EMCust cu ON cu.CustID=h.CustID
      LEFT JOIN dbo.EMEmp e ON e.EmpID=h.EmpID
     WHERE h.DocuType=104 AND h.DocuNo=@no AND ISNULL(h.ClearSO,'N')<>'Y'`, {
    ...noInput(no), globalStartDate: { type: sql.Date, value: dataWindow.businessDate },
  }));
  if (heads.length !== 1) return { count: heads.length };
  const head = heads[0];
  const items = rows(await query(`
    SELECT d.ListNo, d.GoodQty2, RTRIM(u.GoodUnitName) AS UnitName, RTRIM(g.GoodCode) AS GoodCode,
           RTRIM(COALESCE(d.GoodName, g.GoodName1)) AS GoodName, d.GoodPrice2, d.GoodAmnt
      FROM dbo.SODT d
      LEFT JOIN dbo.EMGood g ON g.GoodID=d.GoodID
      LEFT JOIN dbo.EMGoodUnit u ON u.GoodUnitID=d.GoodUnitID2
     WHERE d.SOID=@id ORDER BY d.ListNo`, idInput(head.SOID)));
  return { count: 1, doc: { ...head, items } };
}

const DOC_ID = { 104: 'SOID', 116: 'RedemtionID', 107: 'SOInvID' };

// ประวัติการพิมพ์จาก Sale-App (เทียบได้กับ SMAudit action P ของ WinSpeed) · อ่านไม่ได้ก็ไม่ขวางการพิมพ์
async function printHistory(type, docId) {
  try {
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const r = rows(await wfQuery(`
      SELECT COUNT(*) AS count, CONVERT(varchar(16),DATEADD(hour,7,MAX(PrintedAt)),120) AS lastAt
        FROM wf.NativePrintLog WHERE DocType=@type AND DocId=@id AND PrintedAt >= @globalStartUtc`, {
      type: { type: sql.SmallInt, value: type }, ...idInput(docId), globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant },
    }))[0];
    return { count: r?.count || 0, lastAt: r?.lastAt || null };
  } catch (e) {
    console.error('[native-print/log]', e.message);
    return null;
  }
}

// โหลดใบพร้อมตรวจสิทธิ์ ใช้ทั้งตอนเปิดดูและตอนบันทึกการพิมพ์ · ตอบ error เองแล้วคืน null
async function resolveDoc(type, loader, req, res, options = {}) {
  const no = String(req.params.docuNo || '').trim();
  if (!DOCU_NO.test(no)) { res.status(400).json({ code: 'DOC_NO_INVALID', message: 'เลขที่เอกสารไม่ถูกต้อง' }); return null; }
  const dataWindow = options.dataWindow || await require('../services/global-data-window-store').readGlobalDataWindow();
  const query = options.query || wfQuery;
  const r = await loader(no, dataWindow, query);
  if (r.count === 0) { res.status(404).json({ code: 'DOC_NOT_FOUND', message: `ไม่พบใบ ${type} เลขที่ ${no}` }); return null; }
  if (r.count > 1) { res.status(409).json({ code: 'DOC_AMBIGUOUS', message: `พบใบ ${type} เลขที่ ${no} มากกว่าหนึ่งใบ กรุณาตรวจใน WinSpeed` }); return null; }
  const date = r.doc?.DocuDate;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < dataWindow.businessDate) {
    res.status(404).json({ code: 'DOC_NOT_FOUND', message: `ไม่พบใบ ${type} เลขที่ ${no}` });
    return null;
  }
  const owners = type === 116
    ? (r.doc.items || []).map(item => ({ empId: item.SalesEmpID, bookingSoid: item.BookingSOID }))
    : [{ empId: r.doc.SalesEmpID, bookingSoid: type === 104 ? r.doc.BookingSOID : null }];
  if (!(await allowed(req.user, owners, query))) {
    res.status(404).json({ code: 'DOC_NOT_FOUND', message: `ไม่พบใบ ${type} เลขที่ ${no}` });
    return null;
  }
  // Older or undated references are not disclosed, but current transaction
  // quantities and amounts remain unchanged.
  const inWindow = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= dataWindow.businessDate;
  if (type === 116) {
    r.doc.items = (r.doc.items || []).map(item => {
      const copy = { ...item };
      if (!inWindow(copy.DeliveryDocuDate)) copy.DeliveryNo = null;
      if (!inWindow(copy.InvoiceDocuDate)) copy.InvoiceNo = null;
      if (!inWindow(copy.BookingDocuDate)) { copy.BookingNo = null; copy.BookingSOID = null; }
      delete copy.DeliveryDocuDate; delete copy.InvoiceDocuDate; delete copy.BookingDocuDate;
      return copy;
    });
  } else if (type === 104) {
    if (!inWindow(r.doc.RefNoDocuDate)) { r.doc.RefNo = null; r.doc.RefDate = null; }
    if (!inWindow(r.doc.BookingDocuDate)) r.doc.BookingSOID = null;
    delete r.doc.RefNoDocuDate; delete r.doc.BookingDocuDate;
  } else if (type === 107) {
    if (!inWindow(r.doc.SONoDocuDate)) r.doc.SONo = null;
    delete r.doc.SONoDocuDate;
    r.doc.items = (r.doc.items || []).map(item => {
      const copy = { ...item };
      if (!inWindow(copy.RefDocuDate)) copy.RefDocuNo = null;
      delete copy.RefDocuDate;
      return copy;
    });
  }
  return r.doc;
}

function handler(type, loader) {
  return async (req, res) => {
    try {
      const doc = await resolveDoc(type, loader, req, res);
      if (!doc) return;
      res.json({ type, ...doc, printLog: await printHistory(type, doc[DOC_ID[type]]) });
    } catch (e) {
      console.error(`[native-print/${type}]`, e.message);
      res.status(500).json({ code: 'DOC_PRINT_FAILED', message: 'โหลดเอกสารไม่สำเร็จ' });
    }
  };
}

// กดปุ่มพิมพ์หนึ่งครั้ง = หนึ่งแถว (WinSpeed เขียน SMAudit หนึ่งแถวต่อการพิมพ์เช่นกัน)
function printedHandler(type, loader) {
  return async (req, res) => {
    try {
      const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
      const ids = businessIds(req.user);
      if (!ids.effective || !ids.actor) throw Object.assign(new Error('IDENTITY_BINDING_INVALID'), { code: 'IDENTITY_BINDING_INVALID' });
      const docId = await wfTransaction(async tx => {
        const db = require('../db');
        if (String(db.getTarget()).toLowerCase() !== String(db.DEFAULT_TARGET).toLowerCase())
          throw Object.assign(new Error('PRIMARY_DATABASE_REQUIRED'), { code:'PRIMARY_DATABASE_REQUIRED' });
        await require('../services/coupon-manual-window-fence').assertPrimaryDatabase(tx);
        const query = async (text, inputs = {}) => {
          const request = tx.request();
          for (const [key, param] of Object.entries(inputs)) request.input(key, param.type, param.value);
          return request.query(text);
        };
        const { KEY } = require('../services/global-data-window-store');
        const { DEFAULT_START_DATE, isValidStartDate } = require('../services/data-window');
        const settings = rows(await query('SELECT SettingValue FROM wf.SystemSetting WITH (UPDLOCK,HOLDLOCK) WHERE SettingKey=@key',
          {key:{type:sql.NVarChar(100),value:KEY}}));
        if (settings.length > 1) throw Object.assign(new Error('DATA_WINDOW_UNAVAILABLE'), {code:'DATA_WINDOW_UNAVAILABLE'});
        const raw = settings[0]?.SettingValue;
        const current = raw == null || raw === '' ? DEFAULT_START_DATE : String(raw).trim();
        if (!isValidStartDate(current) || current !== dataWindow.businessDate)
          throw Object.assign(new Error('DATA_WINDOW_CHANGED'), {code:'DATA_WINDOW_CHANGED'});
        // Read the source and both scopes with SERIALIZABLE locks until the
        // print log commits; otherwise a document edit can race the audit.
        const doc = await resolveDoc(type, loader, req, res, { query, dataWindow });
        if (!doc) return null;
        const id = doc[DOC_ID[type]];
        await query(`INSERT INTO wf.NativePrintLog (DocType, DocId, DocuNo, PrintedBy, ActorUserId) VALUES (@type, @id, @no, @user, @actor)`, {
          type:{type:sql.SmallInt,value:type}, ...idInput(id), ...noInput(doc.DocuNo),
          user:{type:sql.Int,value:ids.effective}, actor:{type:sql.Int,value:ids.actor},
        });
        return id;
      }, {isolationLevel:sql.ISOLATION_LEVEL.SERIALIZABLE});
      if (docId == null) return;
      res.json({ ok: true, printLog: await printHistory(type, docId) });
    } catch (e) {
      console.error(`[native-print/${type}/printed]`, e.message);
      res.status(500).json({ code: 'PRINT_LOG_FAILED', message: 'บันทึกประวัติการพิมพ์ไม่สำเร็จ' });
    }
  };
}

// who may print: services/role-capabilities.js (native.print-104 / native.print-116 / native.print-107)
router.get('/104/:docuNo', requireCapability('native.print-104'), handler(104, load104));
router.get('/116/:docuNo', requireCapability('native.print-116'), handler(116, load116));
router.get('/107/:docuNo', requireCapability('native.print-107'), handler(107, load107));
router.post('/104/:docuNo/printed', requireCapability('native.print-104'), printedHandler(104, load104));
router.post('/116/:docuNo/printed', requireCapability('native.print-116'), printedHandler(116, load116));
router.post('/107/:docuNo/printed', requireCapability('native.print-107'), printedHandler(107, load107));

module.exports = router;
module.exports.__testing = { load104, load116, load107 };
