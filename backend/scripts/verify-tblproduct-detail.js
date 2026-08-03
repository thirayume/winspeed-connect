'use strict';
/**
 * verify-tblproduct-detail.js — T6-01
 * Verify that writeBackWeighOutTicket writes multiple product lines into tblproduct_detail
 * and that all required columns (pd_pro_weight, pd_pro_wantWeight, pd_pro_invoid, pd_pro_number, one_num)
 * are correctly populated without NULL values.
 *
 * Run: node backend/scripts/verify-tblproduct-detail.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { writeBackWeighOutTicket } = require('../services/truckscale-db');

const PLATE = 'UAT-VERIFY-PD';
const GROSS = 30000;
const TARE = 12000;

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
    // Cleanup any previous runs
    const [oldRows] = await pool.query('SELECT one_num FROM tblscale WHERE one_car_regis = ?', [PLATE]);
    for (const r of oldRows) {
      if (r.one_num) await pool.query('DELETE FROM tblproduct_detail WHERE one_num = ?', [r.one_num]);
    }
    await pool.query('DELETE FROM tblscale WHERE one_car_regis = ?', [PLATE]);

    // Simulate multi-formula truckload (3 items)
    const testLines = [
      { GoodId: 'FERT-01', GoodCode: '15-15-15', GoodName: 'ปุ๋ยเคมี 15-15-15', QtyTon: 10, QtyBag: 200 },
      { GoodId: 'FERT-02', GoodCode: '16-20-0', GoodName: 'ปุ๋ยเคมี 16-20-0', QtyTon: 5, QtyBag: 100 },
      { GoodId: 'FERT-03', GoodCode: '46-0-0', GoodName: 'ยูเรีย 46-0-0', QtyTon: 3, QtyBag: 60 },
    ];

    const result = await writeBackWeighOutTicket({
      soId: 'VERIFY-PD-1', wfRef: 'UAT-VERIFY-PD', truckPlate: PLATE, custName: 'Verification PD Run',
      gross: GROSS, tare: TARE, net: GROSS - TARE, scaleNo: 1, movebill: '',
      overrideReason: 'verification_pd', overrideApprovedByName: 'auto checker', operatorName: 'tester',
      lines: testLines,
    });

    check('คำสั่งเขียนกลับสำเร็จ', result.success === true, result.error || ('action=' + result.action));
    if (!result.success) return;

    check('รายงานจำนวน productLines ที่เขียนสำเร็จเป็น 3', result.productLines === 3, `got ${result.productLines}`);
    check('มีค่า one_num ที่สร้างขึ้น', Number(result.one_num) > 0, String(result.one_num));

    // Verify tblproduct_detail in MySQL
    const [rows] = await pool.query(
      'SELECT * FROM tblproduct_detail WHERE one_num = ? ORDER BY pd_pro_code ASC',
      [result.one_num]
    );

    check('มี 3 รายการใน tblproduct_detail', rows.length === 3, `got ${rows.length}`);

    const sortedLines = [...testLines].sort((a, b) => a.GoodCode.localeCompare(b.GoodCode));

    if (rows.length === 3) {
      for (let i = 0; i < 3; i++) {
        const row = rows[i];
        const line = sortedLines[i];
        check(`[Line ${i+1}] pd_pro_code ตรงกัน`, row.pd_pro_code === line.GoodCode, row.pd_pro_code);
        check(`[Line ${i+1}] pd_pro_wantWeight เป็นตัน`, Number(row.pd_pro_wantWeight) === line.QtyTon, String(row.pd_pro_wantWeight));
        check(`[Line ${i+1}] pd_pro_bag เป็นกระสอบ`, Number(row.pd_pro_bag) === line.QtyBag, String(row.pd_pro_bag));
        check(`[Line ${i+1}] pd_pro_weight ไม่เป็น NULL (กก./กระสอบ)`, Number(row.pd_pro_weight) === 50, String(row.pd_pro_weight));
        check(`[Line ${i+1}] pd_pro_invoid ไม่เป็น NULL`, row.pd_pro_invoid === 'UAT-VERIFY-PD', String(row.pd_pro_invoid));
        check(`[Line ${i+1}] pd_pro_number ไม่เป็น NULL`, row.pd_pro_number != null, String(row.pd_pro_number));
        check(`[Line ${i+1}] one_num ตรงกับหัวบิล`, Number(row.one_num) === Number(result.one_num), String(row.one_num));
      }
    }
  } catch (error) {
    console.error('  ✗ เกิดข้อผิดพลาด: ' + error.message);
    failures++;
  } finally {
    const [oldRows] = await pool.query('SELECT one_num FROM tblscale WHERE one_car_regis = ?', [PLATE]);
    for (const r of oldRows) {
      if (r.one_num) await pool.query('DELETE FROM tblproduct_detail WHERE one_num = ?', [r.one_num]);
    }
    const [del] = await pool.query('DELETE FROM tblscale WHERE one_car_regis = ?', [PLATE]);
    await pool.query('DELETE FROM tbl_keyone WHERE one_car_regis = ?', [PLATE]).catch(() => {});
    console.log(`  เก็บกวาด: ลบแถวทดสอบใน tblscale ${del.affectedRows} แถว และ tblproduct_detail แล้ว`);
    await pool.end();
  }

  console.log(failures === 0 ? '\nผลตรวจ: ผ่านทั้งหมด' : `\nผลตรวจ: ไม่ผ่าน ${failures} ข้อ`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
