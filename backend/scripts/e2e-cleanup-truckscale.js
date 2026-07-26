'use strict';
// ล้างข้อมูลที่ E2E สร้างขึ้น ออกจาก MySQL db_truckscale หลังจบการทดสอบทุกครั้ง
//
// ตั้งแต่ v1.4.0 การกด ship จะเขียนกลับเข้า tblscale และลบคิวใน tbl_keyone
// เทสต์ไม่ส่ง movebill จึงหาใบเปิดค้างไม่พบและระบบจะสร้างใบใหม่ให้ทุกครั้ง
// ถ้าไม่ล้าง ใบชั่งของเทสต์จะสะสมอยู่ในฐานข้อมูล UAT เรื่อยๆ
//
// ขอบเขต: ลบเฉพาะแถวที่ระบุตัวได้ว่าเป็นของเทสต์
//   - ทะเบียนรถขึ้นต้น UAT- หรือ CMP- (helpers.runSuffix)
//   - ใบที่แอปสร้างเองในรอบเทสต์: sequence ขึ้นต้น WF- และทะเบียนเป็นของเทสต์
// ไม่แตะข้อมูลชั่งจริงของโรงงานเด็ดขาด
//
//   node backend/scripts/e2e-cleanup-truckscale.js

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const TEST_PLATE_PREFIXES = ['UAT-', 'CMP-'];

async function main() {
  if (!process.env.MYSQL_HOST) {
    console.log('E2E cleanup (MySQL): ไม่ได้ตั้ง MYSQL_HOST — ข้ามการล้าง');
    return;
  }
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 1,
    connectTimeout: 8000,
  });

  const like = TEST_PLATE_PREFIXES.map(() => 'one_car_regis LIKE ?').join(' OR ');
  const params = TEST_PLATE_PREFIXES.map(prefix => prefix + '%');

  try {
    // แสดงสิ่งที่จะลบก่อน เพื่อให้ log ตรวจย้อนหลังได้
    const [preview] = await pool.query(
      `SELECT s_id, sequence, one_car_regis, Date_Out FROM tblscale WHERE ${like} ORDER BY s_id DESC LIMIT 20`,
      params
    );
    for (const row of preview) {
      console.log(`  ลบใบชั่ง s_id=${row.s_id} seq=${row.sequence} plate=${row.one_car_regis} out=${row.Date_Out}`);
    }

    const [scale] = await pool.query(`DELETE FROM tblscale WHERE ${like}`, params);
    const [queue] = await pool.query(`DELETE FROM tbl_keyone WHERE ${like}`, params);

    console.log(`E2E cleanup (MySQL): ลบ tblscale ${scale.affectedRows} แถว · tbl_keyone ${queue.affectedRows} แถว`);

    // ตรวจซ้ำว่าไม่มีตกค้าง
    const [left] = await pool.query(`SELECT COUNT(*) AS n FROM tblscale WHERE ${like}`, params);
    if (left[0].n > 0) {
      console.error(`E2E cleanup (MySQL): ยังเหลือ ${left[0].n} แถวที่ลบไม่ได้`);
      process.exitCode = 1;
    }
  } catch (error) {
    // ไม่ให้ล้มทั้ง pipeline แต่ต้องเห็นชัดใน log
    console.error('E2E cleanup (MySQL) ล้มเหลว: ' + error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
