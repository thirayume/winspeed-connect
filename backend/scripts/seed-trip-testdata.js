/**
 * seed-trip-testdata.js — ข้อมูลทดสอบสำหรับกระดาน Sale Trip (เฟส 4)
 *
 * ทำอะไร
 *   สร้าง wf.SalesTrip 3 เที่ยว ให้ตรงกับรถทดสอบ 3 คันที่ seed-wgxx-testdata.js
 *   ใส่ไว้ใน dbo.WGHD แล้ว จากนั้นผูก SO ของ WINSpeed เข้าเที่ยวผ่าน
 *   wf.SalesOrderExt.TripId (คอลัมน์ที่ migration 104 เพิ่งเพิ่ม)
 *
 * ทำไมต้องมีสคริปต์นี้แยก
 *   SO ที่ seed-wgxx อ้างถึงเป็นใบที่เปิดจาก WINSpeed โดยตรง จึงไม่มีแถวใน
 *   wf.SalesOrderExt เลย กระดานที่อ่านจาก wf.v_TripMember จึงมองไม่เห็น
 *   สคริปต์นี้เติมแถวฝั่ง wf ให้ครบ เพื่อให้ทดสอบลำดับชั้น
 *   เที่ยว → ลูกค้า → ใบจอง → รายการ ได้จริง
 *
 * ⚠ เขียนเฉพาะ schema wf เท่านั้น ไม่แตะ dbo แม้แต่แถวเดียว
 * ⚠ ห้ามรันบน PROD-A (Azure) เด็ดขาด — เป็นระบบที่มีผู้ใช้งานจริง
 *
 * ล้างข้อมูล:  node scripts/seed-trip-testdata.js --clean
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sql, wfQuery, wfTransaction } = require('../db');

const TRIP_PREFIX = 'TEST-TRIP-';
const CLEAN = process.argv.includes('--clean');

// รถทดสอบ 3 คัน ตรงกับที่ seed-wgxx-testdata.js สร้างไว้
const TRIPS = [
  { code: 'TEST-TRIP-01', plate: 'TEST-01/0001', driver: 'คนขับทดสอบ 1', capacity: 50, tolerance: 5, preSling: 1,
    remark: 'เที่ยวทดสอบ — รถลงทะเบียนแล้ว รอโหลด', dueDays: 7 },
  { code: 'TEST-TRIP-02', plate: 'TEST-02/0002', driver: 'คนขับทดสอบ 2', capacity: 50, tolerance: 5, preSling: 0,
    remark: 'เที่ยวทดสอบ — กำลังโหลดสินค้า', dueDays: 15 },
  { code: 'TEST-TRIP-03', plate: 'TEST-03/0003', driver: 'คนขับทดสอบ 3', capacity: 50, tolerance: 5, preSling: 0,
    remark: 'เที่ยวทดสอบ — ชั่งออกครบแล้ว', dueDays: 7 }
];

async function main() {
  const env = (await wfQuery('SELECT DB_NAME() db, @@SERVERNAME srv')).recordset[0];
  console.log(`ฐานข้อมูล: ${env.db} @ ${env.srv}`);
  if (String(process.env.DB_MODE || '').toLowerCase() === 'remote') {
    console.error('หยุด: DB_MODE=remote คือ PROD-A ห้าม seed ข้อมูลทดสอบ');
    process.exit(1);
  }

  if (CLEAN) return clean();

  // ── หา SO ที่รถทดสอบแต่ละคันวิ่งอยู่ จาก WGHD ที่ seed ไว้ ────────
  const wg = await wfQuery(`
    SELECT DISTINCT w.CarNo, w.SPID
    FROM dbo.WGHD w
    WHERE w.UpdateBy = 'SEED-TEST'`);

  if (wg.recordset.length === 0) {
    console.error('ไม่พบข้อมูล WGHD ทดสอบ — ให้รัน seed-wgxx-testdata.js ก่อน');
    process.exit(1);
  }

  const soidsByPlate = new Map();
  for (const r of wg.recordset) {
    const p = String(r.CarNo).trim();
    if (!soidsByPlate.has(p)) soidsByPlate.set(p, []);
    soidsByPlate.get(p).push(r.SPID);
  }

  // ดึงเลขที่เอกสารจริงมาใช้เป็น WfRef เพื่อให้หน้าจอแสดงเลขเดียวกับ WINSpeed
  const allSoids = [...new Set(wg.recordset.map(r => r.SPID))];
  const so = await wfQuery(`
    SELECT SOID, RTRIM(DocuNo) AS DocuNo, CustID
    FROM dbo.SOHD WHERE SOID IN (${allSoids.join(',')}) AND DocuType = 103`);
  const soById = new Map(so.recordset.map(r => [String(r.SOID).trim(), r]));   // SOHD.SOID เป็น UDT u_ID กลับมาเป็นสตริง ส่วน WGHD.SPID เป็น int

  const admin = await wfQuery(`SELECT TOP 1 Id FROM wf.AppUser WHERE Role = 'ADMIN' ORDER BY Id`);
  const createdBy = admin.recordset[0] ? admin.recordset[0].Id : 1;

  let tripCount = 0, extCount = 0, lineCount = 0;

  await wfTransaction(async tx => {
    for (const t of TRIPS) {
      const soids = soidsByPlate.get(t.plate) || [];
      if (soids.length === 0) { console.log(`  ข้าม ${t.code} — ไม่พบ WGHD ของทะเบียน ${t.plate}`); continue; }

      const dup = await tx.request().input('code', sql.VarChar(50), t.code)
        .query(`SELECT TripId FROM wf.SalesTrip WHERE TripCode = @code`);
      if (dup.recordset[0]) { console.log(`  ข้าม ${t.code} — มีอยู่แล้ว (TripId ${dup.recordset[0].TripId})`); continue; }

      const ins = await tx.request()
        .input('code', sql.VarChar(50), t.code)
        .input('plate', sql.VarChar(50), t.plate)
        .input('driver', sql.VarChar(100), t.driver)
        .input('cap', sql.Decimal(18, 2), t.capacity)
        .input('tol', sql.Decimal(5, 2), t.tolerance)
        .input('psling', sql.Bit, t.preSling)
        .input('remark', sql.NVarChar(500), t.remark)
        .input('due', sql.Int, t.dueDays)
        .input('by', sql.Int, createdBy)
        .query(`
          INSERT INTO wf.SalesTrip
            (TripCode, TransRegistration, DriverName, TruckCapacityTon, TolerancePct,
             PreSlingRequired, TripRemark, PickupDueDate, Status, CreatedBy)
          OUTPUT inserted.TripId
          VALUES (@code, @plate, @driver, @cap, @tol,
                  @psling, @remark, DATEADD(DAY, @due, CAST(GETDATE() AS DATE)), 'PLANNED', @by)`);
      const tripId = ins.recordset[0].TripId;
      tripCount++;

      let linked = 0;
      let seqCursor = 0;   // ลำดับขึ้นของไล่ต่อเนื่องทั้งเที่ยว ไม่ใช่รีเซ็ตรายใบ
      for (const soid of soids) {
        const hd = soById.get(String(soid).trim());
        if (!hd) continue;
        const docuNo = String(hd.DocuNo || '').trim();
        const prefix = docuNo.charAt(0) || 'I';   // I หรือ K ตามเล่มจริง

        const exists = await tx.request().input('soid', sql.VarChar(50), String(soid))
          .query(`SELECT 1 FROM wf.SalesOrderExt WHERE SOID = @soid`);
        if (exists.recordset[0]) {
          await tx.request().input('soid', sql.VarChar(50), String(soid)).input('trip', sql.Int, tripId)
            .query(`UPDATE wf.SalesOrderExt SET TripId = @trip WHERE SOID = @soid`);
        } else {
          await tx.request()
            .input('soid', sql.VarChar(50), String(soid))
            .input('ref', sql.NVarChar(60), docuNo)
            .input('prefix', sql.NVarChar(10), prefix)
            .input('trip', sql.Int, tripId)
            .input('by', sql.Int, createdBy)
            .query(`
              INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix, TripId, SalesUserId, EnteredByUserId, TruckRemark)
              VALUES (@soid, @ref, @prefix, @trip, @by, @by, N'ข้อมูลทดสอบ SEED-TEST')`);
        }
        // ── รายละเอียดระดับบรรทัดที่ WINSpeed ไม่มี ──────────────
        // ลำดับขึ้นของ · ของแถม · แยกตัวแม่/ตัวลูก เก็บที่ wf.SalesOrderLineExt
        // ใส่ให้ครบเพื่อให้ผังการจัดของมีอะไรให้เรียงและให้เตือนจริง ๆ
        const dt = await tx.request().input('soid', sql.Int, Number(soid))
          .query(`SELECT ListNo, GoodQty2 FROM dbo.SODT WHERE SOID = @soid AND DocuType = 103 ORDER BY ListNo`);

        for (const [i, line] of dt.recordset.entries()) {
          const already = await tx.request()
            .input('soid', sql.VarChar(50), String(soid))
            .input('ln', sql.Int, line.ListNo)
            .query(`SELECT 1 FROM wf.SalesOrderLineExt WHERE SOID = @soid AND ListNo = @ln`);
          if (already.recordset[0]) continue;

          const qty = Number(line.GoodQty2 || 0);
          const isGiveaway = (seqCursor === 2) ? 1 : 0;          // ให้มีของแถม 1 บรรทัดในชุดทดสอบ
          const split      = (seqCursor === 1 && qty > 0);        // แยกแม่ 60 / ลูก 40 หนึ่งบรรทัด

          await tx.request()
            .input('soid', sql.VarChar(50), String(soid))
            .input('ln',   sql.Int, line.ListNo)
            .input('seq',  sql.Int, seqCursor + 1)
            .input('give', sql.Bit, isGiveaway)
            .input('mq',   sql.Decimal(18, 3), split ? Number((qty * 0.6).toFixed(3)) : null)
            .input('cq',   sql.Decimal(18, 3), split ? Number((qty * 0.4).toFixed(3)) : null)
            .query(`
              INSERT INTO wf.SalesOrderLineExt (SOID, ListNo, LoadSequence, IsGiveaway, MasterQty, ChildQty)
              VALUES (@soid, @ln, @seq, @give, @mq, @cq)`);
          seqCursor++;
          lineCount++;
          void i;
        }

        extCount++; linked++;
      }
      console.log(`  ${t.code}  ทะเบียน ${t.plate}  ผูก ${linked}/${soids.length} SO  (TripId ${tripId})`);
    }
  });

  console.log(`\nสร้างเที่ยว ${tripCount} เที่ยว · ผูกใบจอง ${extCount} ใบ · รายละเอียดบรรทัด ${lineCount} รายการ`);

  const chk = await wfQuery(`
    SELECT t.TripCode, t.TransRegistration,
           (SELECT COUNT(*) FROM wf.v_TripMember m WHERE m.TripId = t.TripId) AS Members,
           (SELECT COUNT(DISTINCT m.CustId) FROM wf.v_TripMember m WHERE m.TripId = t.TripId) AS Customers
    FROM wf.SalesTrip t WHERE t.TripCode LIKE '${TRIP_PREFIX}%' ORDER BY t.TripCode`);
  console.log('\nตรวจผ่าน wf.v_TripMember:');
  chk.recordset.forEach(r =>
    console.log(`   ${r.TripCode}  ${r.TransRegistration}  สมาชิก ${r.Members} ใบ  ลูกค้า ${r.Customers} ราย`));
}

async function clean() {
  const t = await wfQuery(`SELECT TripId FROM wf.SalesTrip WHERE TripCode LIKE '${TRIP_PREFIX}%'`);
  if (t.recordset.length === 0) return console.log('ไม่มีเที่ยวทดสอบให้ลบ');
  const ids = t.recordset.map(r => r.TripId).join(',');
  await wfQuery(`DELETE FROM wf.SalesOrderLineExt WHERE SOID IN (SELECT SOID FROM wf.SalesOrderExt WHERE TripId IN (${ids}) AND TruckRemark = N'ข้อมูลทดสอบ SEED-TEST')`);
  const e = await wfQuery(`DELETE FROM wf.SalesOrderExt WHERE TripId IN (${ids}) AND TruckRemark = N'ข้อมูลทดสอบ SEED-TEST'`);
  await wfQuery(`UPDATE wf.SalesOrderExt SET TripId = NULL WHERE TripId IN (${ids})`);
  const d = await wfQuery(`DELETE FROM wf.SalesTrip WHERE TripId IN (${ids})`);
  console.log(`ลบใบจองทดสอบ ${e.rowsAffected[0]} ใบ · ลบเที่ยว ${d.rowsAffected[0]} เที่ยว`);
}

main().then(() => process.exit(0)).catch(err => { console.error('ล้มเหลว:', err.message); process.exit(1); });
