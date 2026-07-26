'use strict';
// พิสูจน์ว่าการเขียนกลับ TruckScale ทำงานได้จริงกับฐานข้อมูลจริง แล้วเก็บกวาดให้เอง
//
// ทำไมต้องมี: ที่ผ่านมา writeBackWeighOutTicket ล้มเหลวเงียบมาสามรอบด้วยสาเหตุคนละอย่าง
//   1) เขียนคอลัมน์ one_App / Remark ที่ไม่มีอยู่ใน tblscale
//   2) เขียนวันที่เป็น ค.ศ. YYYY-MM-DD ขณะที่ตารางเก็บ พ.ศ. DD/MM/YYYY
//   3) สร้าง sequence ยาว 11 ตัวอักษรใส่คอลัมน์ varchar(10)
// การอ่านโค้ดอย่างเดียวจับไม่ได้ทั้งสามข้อ ต้องยิงจริงแล้วอ่านกลับมาตรวจ
//
//   node backend/scripts/verify-truckscale-writeback.js

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { writeBackWeighOutTicket } = require('../services/truckscale-db');

const PLATE = 'UAT-VERIFY';   // ขึ้นต้น UAT- เพื่อให้สคริปต์ cleanup เก็บกวาดได้ด้วย
const GROSS = 20000;
const TARE = 10000;

function expectedThaiDate(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear() + 543}`;
}

async function main() {
  if (!process.env.MYSQL_HOST) {
    console.log('ข้าม: ไม่ได้ตั้ง MYSQL_HOST');
    return;
  }
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE, connectionLimit: 1, connectTimeout: 8000,
  });

  let failures = 0;
  const check = (label, ok, detail) => {
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
    if (!ok) failures++;
  };

  try {
    await pool.query('DELETE FROM tblscale WHERE one_car_regis = ?', [PLATE]);

    const result = await writeBackWeighOutTicket({
      soId: 'VERIFY-1', wfRef: 'UAT-VERIFY', truckPlate: PLATE, custName: 'Verification run',
      gross: GROSS, tare: TARE, net: GROSS - TARE, scaleNo: 1, movebill: '',
      overrideReason: 'verification', overrideApprovedByName: 'automated check', operatorName: 'verify',
    });

    check('คำสั่งเขียนกลับสำเร็จ', result.success === true, result.error || ('action=' + result.action));
    if (!result.success) return;

    const [rows] = await pool.query(
      'SELECT * FROM tblscale WHERE one_car_regis = ? ORDER BY s_id DESC LIMIT 1', [PLATE]);
    check('มีแถวเกิดขึ้นจริงในตาราง', rows.length === 1);
    if (!rows.length) return;

    const row = rows[0];
    const today = expectedThaiDate();
    check('weight_out ถูกต้อง', Number(row.weight_out) === GROSS, String(row.weight_out));
    check('weight_net ถูกต้อง', Number(row.weight_net) === GROSS - TARE, String(row.weight_net));
    check('Date_Out เป็น พ.ศ. DD/MM/YYYY', row.Date_Out === today, `${row.Date_Out} (คาด ${today})`);
    check('Date_Out2 เป็นเลข serial', Number.isInteger(row.Date_Out2) && row.Date_Out2 > 40000, String(row.Date_Out2));
    check('s_day เป็น YYMM พ.ศ.', String(row.s_day).length === 4, String(row.s_day));
    check('s_num มีค่า', Number(row.s_num) > 0, String(row.s_num));
    check('sequence ยาวไม่เกิน 10', String(row.sequence).length <= 10, `"${row.sequence}"`);
    check('one_des บันทึกเลขอ้างอิงแอป', String(row.one_des || '').includes('WF-SO'), String(row.one_des));
    check('movebill ตรงรูปแบบเครื่องชั่ง', /^\d{8}$/.test(String(row.movebill)), String(row.movebill));
  } catch (error) {
    console.error('  ✗ เกิดข้อผิดพลาด: ' + error.message);
    failures++;
  } finally {
    const [del] = await pool.query('DELETE FROM tblscale WHERE one_car_regis = ?', [PLATE]);
    await pool.query('DELETE FROM tbl_keyone WHERE one_car_regis = ?', [PLATE]).catch(() => {});
    console.log(`  เก็บกวาด: ลบแถวทดสอบ ${del.affectedRows} แถว`);
    await pool.end();
  }

  console.log(failures === 0 ? '\nผลตรวจ: ผ่านทั้งหมด' : `\nผลตรวจ: ไม่ผ่าน ${failures} ข้อ`);
  // truckscale-db ถือ pool ของตัวเองไว้และไม่มี API ปิด ต้องออกเองมิฉะนั้น process ค้าง
  process.exit(failures === 0 ? 0 : 1);
}

main();
