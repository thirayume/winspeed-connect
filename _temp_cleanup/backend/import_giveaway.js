/**
 * import_giveaway.js — โหลดข้อมูลของแถมจาก xls เข้า schema wf
 * รัน: node import_giveaway.js
 * ⚠ เขียนเฉพาะ wf (GiveawayItem/Budget/Withdrawal) — อ่าน dbo.EMEmp (read-only)
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { sql, query, wfQuery, ownerPool } = require('./db');

const XLS = 'L:/My Drive/World Fert/Requirements/สรุปเบิกเสื้อ-กระเป๋า รายภาค.xls';
const PERIOD_YEAR = 2569;

const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return isNaN(n) ? 0 : n; };
const txt = (v) => String(v ?? '').trim();

function classify(itemName) {
  if (/เสื้อ/.test(itemName)) return 'SHIRT';
  if (/แบนเนอร์|แบนเนอ/.test(itemName)) return 'BANNER';
  if (/^\d+-\d+-\d+/.test(itemName)) return 'BAG';     // สูตรปุ๋ย = ลายกระเป๋า
  return 'OTHER';
}
function parseMonth(v) {
  const s = txt(v);
  const m = s.match(/^([A-Za-z]{3})-?\d*/);
  if (m) return MONTHS[m[1].toLowerCase()] || null;
  return null;
}

async function run() {
  const wb = XLSX.readFile(XLS, { cellDates: true });
  const regionSheets = wb.SheetNames.filter(n => n.trim() !== 'Data');

  // clean import (idempotent)
  await wfQuery('DELETE FROM wf.GiveawayWithdrawal');
  await wfQuery('DELETE FROM wf.GiveawayBudget');
  await wfQuery('DELETE FROM wf.GiveawayItem');

  const items = new Map();      // "Brand||Item" -> {brand,item,type}
  let budgetCount = 0, wdCount = 0;

  for (const sheet of regionSheets) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '', raw: false, cellDates: true });
    const region = txt(sheet).replace(/ปี\s*69\s*$/, '').replace(/^สรุปการเบิก/, '').trim() || txt(sheet);

    // หาแถวรหัสพนักงาน
    let empCode = null, empName = null;
    for (const r of rows) {
      if (txt(r[0]) === 'รหัสพนักงาน') { empCode = txt(r[1]); empName = txt(r[2]); break; }
    }
    // resolve EmpCode -> EMEmp.EmpID -> AppUser.Id
    let empId = null, salesUserId = null;
    if (empCode) {
      const e = await query(`SELECT EmpID FROM dbo.EMEmp WHERE EmpCode = @c`, { c: { type: sql.NVarChar(20), value: empCode } });
      empId = e?.[0]?.EmpID != null ? String(e[0].EmpID) : null;
      if (empId) {
        const u = await wfQuery(`SELECT Id FROM wf.AppUser WHERE EmpId = @e`, { e: { type: sql.NVarChar(20), value: empId } });
        salesUserId = u.recordset?.[0]?.Id ?? null;
      }
    }

    // หา budget header (col0='งบ') และ withdrawal header (col0='เดือน')
    let budgetStart = -1, wdHeader = -1;
    for (let i = 0; i < rows.length; i++) {
      if (txt(rows[i][0]) === 'งบ') budgetStart = i + 1;
      if (txt(rows[i][0]) === 'เดือน') { wdHeader = i; break; }
    }

    // budget lines: col0=Brand, col1=Item, col2=BudgetQty (จนเจอแถว Brand ว่าง)
    if (budgetStart > 0) {
      for (let i = budgetStart; i < (wdHeader > 0 ? wdHeader : rows.length); i++) {
        const brand = txt(rows[i][0]), item = txt(rows[i][1]);
        if (!brand || !item) continue;            // ข้ามแถวรวม/ว่าง
        if (brand !== 'รถเกษตร' && brand !== 'ปุ๋ยเทพ') continue;
        const budgetQty = num(rows[i][2]);
        const type = classify(item);
        items.set(`${brand}||${item}`, { brand, item, type });
        await wfQuery(`
          INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
          VALUES (@su, @ei, @ec, @rg, @yr, @br, @it, @bq)`, {
            su: { type: sql.Int, value: salesUserId }, ei: { type: sql.NVarChar(20), value: empId },
            ec: { type: sql.NVarChar(20), value: empCode }, rg: { type: sql.NVarChar(60), value: region },
            yr: { type: sql.Int, value: PERIOD_YEAR }, br: { type: sql.NVarChar(50), value: brand },
            it: { type: sql.NVarChar(100), value: item }, bq: { type: sql.Decimal(12,2), value: budgetQty },
          });
        budgetCount++;
      }
    }

    // withdrawal log: เดือน(carry) | Brand | Item | Qty
    if (wdHeader > 0) {
      let lastMonth = null;
      for (let i = wdHeader + 1; i < rows.length; i++) {
        const mRaw = txt(rows[i][0]), brand = txt(rows[i][1]), item = txt(rows[i][2]), qty = num(rows[i][3]);
        if (!brand || !item) continue;
        const mo = parseMonth(mRaw); if (mo) lastMonth = mo;
        if (qty === 0) continue;
        const type = classify(item);
        items.set(`${brand}||${item}`, { brand, item, type });
        await wfQuery(`
          INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, IssueMonth, Brand, ItemName, Qty, Source)
          VALUES (@su, @ei, @ec, @rg, @yr, @mo, @br, @it, @qy, 'IMPORT')`, {
            su: { type: sql.Int, value: salesUserId }, ei: { type: sql.NVarChar(20), value: empId },
            ec: { type: sql.NVarChar(20), value: empCode }, rg: { type: sql.NVarChar(60), value: region },
            yr: { type: sql.Int, value: PERIOD_YEAR }, mo: { type: sql.Int, value: lastMonth },
            br: { type: sql.NVarChar(50), value: brand }, it: { type: sql.NVarChar(100), value: item },
            qy: { type: sql.Decimal(12,2), value: qty },
          });
        wdCount++;
      }
    }
    console.log(`✓ ${region}: emp=${empCode}(${empId}) user=${salesUserId}`);
  }

  // catalog
  for (const { brand, item, type } of items.values()) {
    await wfQuery(`INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (@b,@i,@t)`, {
      b: { type: sql.NVarChar(50), value: brand }, i: { type: sql.NVarChar(100), value: item }, t: { type: sql.NVarChar(20), value: type },
    });
  }

  console.log(`\n✓ Import done: ${items.size} items, ${budgetCount} budget lines, ${wdCount} withdrawals`);
  await ownerPool.close();
  process.exit(0);
}

run().catch(e => { console.error('✗ Import failed:', e); process.exit(1); });
