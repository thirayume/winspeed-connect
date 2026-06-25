/**
 * WINSpeed SO Import File Generator
 * สร้าง SOHD.TXT + SODT.TXT (Tab-delimited, UTF-16LE)
 * DocuType=104, VATType=3 (ปุ๋ยยกเว้น VAT)
 * อ้างอิง: wf/out/winspeed_import_spec.md + คู่มือ Export-Import Document.pdf
 */
const fs = require('fs');
const path = require('path');

function formatDate(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * สร้างไฟล์ SOHD.TXT + SODT.TXT สำหรับ WINSpeed Import
 * @param {Object} so - SalesOrder object จาก wf.SalesOrder
 * @param {Array}  lines - SalesOrderLine[] (ไม่รวม isGiveaway)
 * @returns {string} dirPath ที่สร้างไฟล์
 */
function generateImportFiles(so, lines) {
  const yyyymmdd = formatDate(new Date()).replace(/-/g, '');
  const baseDir = process.env.EXPORT_OUTPUT_PATH || 'C:\\wssale-exports';
  const dir = path.join(baseDir, yyyymmdd, so.WfRef);
  fs.mkdirSync(dir, { recursive: true });

  // ── SOHD.TXT (1 แถว) ─────────────────────────────────────
  // Field order จาก WINSpeed Import spec:
  // CustID, DocuType, BrchID, EmpID, DocuDate, DeliveryDate,
  // TransRegistration, Desc1(ControlTicketNo), Remark, RefNo
  const hdRow = [
    so.CustId       || '',
    '104',            // DocuType = ใบสั่งขาย
    '1',              // BrchID = สาขาเดียว
    so.EmpId        || '1',  // EmpID
    formatDate(so.DeliveryDate || new Date()),
    formatDate(so.DeliveryDate || new Date()),
    so.TruckPlate   || '',
    so.ControlTicketNo || '',
    so.Remark       || '',
    so.WfRef,         // RefNo = WF ref ของเรา
  ].join('\t');

  fs.writeFileSync(path.join(dir, 'SOHD.TXT'), '﻿' + hdRow, { encoding: 'utf16le' });

  // ── SODT.TXT (หลายแถว) ────────────────────────────────────
  // Field order: GoodID, GoodQty1, GoodUnitID, GoodPrice1, VATType, InveID, LocaID
  const dtRows = lines
    .filter(l => !l.IsGiveaway)
    .map(l => [
      l.GoodId,
      Number(l.QtyTon).toFixed(3),
      '1002',          // GoodUnitID = ตัน
      Number(l.PricePerTon).toFixed(2),
      '3',             // VATType = ยกเว้น VAT (ปุ๋ย)
      '1',             // InveID = คลังเดียว
      '1',             // LocaID
    ].join('\t'))
    .join('\r\n');

  fs.writeFileSync(path.join(dir, 'SODT.TXT'), '﻿' + dtRows, { encoding: 'utf16le' });

  return dir;
}

module.exports = { generateImportFiles };
