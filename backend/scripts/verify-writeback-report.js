#!/usr/bin/env node
'use strict';
/**
 * verify-writeback-report.js — พิสูจน์ว่ารายงานกระทบยอด R-3 จับได้ครบทุกกรณี
 *
 * ทำไมต้องมี: บั๊กสามชั้นของ writeBackWeighOutTicket ไม่มีชั้นไหนที่การอ่านโค้ดจับได้
 * รายงานที่อ่านสองฐานข้อมูลก็เช่นกัน จึงต้องสร้างสถานการณ์จริงแล้วตรวจผลลัพธ์
 *
 * สร้างใบชั่งจำลองในสถานะต่างๆ → เรียกรายงาน → ยืนยันว่าจัดกรณีถูก → ลบข้อมูลทดสอบ
 * ใช้ทะเบียนขึ้นต้น UAT- เพื่อให้สคริปต์ cleanup ตามเก็บได้ด้วยหากสคริปต์นี้ล้มกลางคัน
 *
 *   node backend/scripts/verify-writeback-report.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { sql, wfQuery } = require('../db');

const PLATE_PREFIX = 'UAT-RPT';
const CASES = [
  { key: 'A', plate: `${PLATE_PREFIX}A`, action: 'inserted', sid: 999000001, seq: 'WF99000001', net: 10000, expect: 'A' },
  { key: 'B', plate: `${PLATE_PREFIX}B`, action: 'updated',  sid: 999000002, seq: '02999002',  net: 10000, expect: 'B' },
  { key: 'C', plate: `${PLATE_PREFIX}C`, action: 'failed',   sid: null,      seq: null,        net: 10000, expect: 'C' },
  { key: 'C2', plate: `${PLATE_PREFIX}D`, action: null,      sid: null,      seq: null,        net: 10000, expect: 'C' },
];

async function cleanup() {
  await wfQuery(
    `DELETE FROM wf.WeighTicket WHERE TruckPlate LIKE @p`,
    { p: { type: sql.NVarChar(40), value: PLATE_PREFIX + '%' } }
  );
}

async function main() {
  const reports = require('../routes/reports');
  const runner = reports.__testing && reports.__testing.runTruckScaleWritebackReport;
  if (!runner) throw new Error('reports.js ไม่ได้ export __testing.runTruckScaleWritebackReport');

  let failures = 0;
  const check = (label, ok, detail) => {
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
    if (!ok) failures++;
  };

  await cleanup();
  const now = new Date();

  try {
    for (const testCase of CASES) {
      await wfQuery(`
        INSERT INTO wf.WeighTicket
          (SoId, WfRef, TruckPlate, GrossKg, TareKg, NetKg, ScaleNo, WeighOutAt, Status, CreatedBy,
           ScaleWriteAction, ScaleSid, ScaleSequence, ScaleWrittenAt, ScaleError)
        VALUES
          (@so, @ref, @plate, 20000, 10000, @net, 1, @at, 'DONE', 1,
           @action, @sid, @seq, CASE WHEN @action IN ('updated','inserted') THEN @at ELSE NULL END, @err)`,
        {
          so:     { type: sql.NVarChar(50), value: 'RPT-' + testCase.key },
          ref:    { type: sql.NVarChar(30), value: 'UAT-RPT-' + testCase.key },
          plate:  { type: sql.NVarChar(30), value: testCase.plate },
          net:    { type: sql.Decimal(10, 2), value: testCase.net },
          at:     { type: sql.DateTime2, value: now },
          action: { type: sql.VarChar(10), value: testCase.action },
          sid:    { type: sql.Int, value: testCase.sid },
          seq:    { type: sql.VarChar(10), value: testCase.seq },
          err:    { type: sql.NVarChar(500), value: testCase.action === 'failed' ? 'simulated failure' : null },
        });
    }

    // ต้องใช้วันที่ตามเวลาท้องถิ่น ไม่ใช่ toISOString() ซึ่งให้วัน UTC
    // ผู้ใช้เลือกวันจากปฏิทินท้องถิ่น รายงานจึงแปลงเป็นช่วงเวลาท้องถิ่นให้ถูกต้องอยู่แล้ว
    const pad = value => String(value).padStart(2, '0');
    const localDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const rows = await runner({ from: localDate, to: localDate });
    const byPlate = new Map(rows.map(row => [row.TruckPlate, row]));

    for (const testCase of CASES) {
      const row = byPlate.get(testCase.plate);
      const got = row ? String(row.Case).charAt(0) : '(ไม่พบ)';
      check(`กรณี ${testCase.key} → คาด ${testCase.expect}`, got === testCase.expect, `ได้ ${got}`);
    }

    check('รายงานคืนคอลัมน์ครบ', rows.length > 0 && 'NetKgApp' in rows[0] && 'DiffKg' in rows[0]);
    check('เรียงกรณีที่ต้องรีบดูขึ้นก่อน', rows.length > 1 && ['A', 'C', 'D'].includes(String(rows[0].Case).charAt(0)),
      rows.length ? String(rows[0].Case) : '');
  } catch (error) {
    console.error('  ✗ เกิดข้อผิดพลาด: ' + error.message);
    failures++;
  } finally {
    await cleanup();
    console.log('  เก็บกวาด: ลบใบชั่งทดสอบแล้ว');
  }

  console.log(failures === 0 ? '\nผลตรวจ: ผ่านทั้งหมด' : `\nผลตรวจ: ไม่ผ่าน ${failures} ข้อ`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => { console.error('ERROR: ' + error.message); process.exit(1); });
