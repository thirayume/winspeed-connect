#!/usr/bin/env node
'use strict';
/**
 * trace-document.js — รัน sql/maintenance/trace-document.sql กับปลายทางที่ระบุ (อ่านอย่างเดียว)
 *
 * มีเพราะไฟล์ .sql ต้องรันบนฐานที่ต่อผ่าน SSH tunnel ด้วย ซึ่ง sqlcmd ธรรมดาทำเองไม่ได้
 * เรียกผ่าน migrate-targets เพื่อให้ได้ tunnel และ env ที่ถูกต้องของแต่ละปลายทาง
 *
 *   node scripts/migrate-targets.js --trace-document I69-02420 --targets remote_b
 *
 * เลขที่เอกสารส่งมาทาง env TRACE_DOCUNO — ไม่ได้ต่อสตริงเข้า SQL
 * แต่แทนค่าที่บรรทัด DECLARE เพื่อให้ไฟล์ .sql ยังเปิดรันมือใน SSMS ได้เหมือนเดิม
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { wfQuery } = require('../db');

async function main() {
  const docuNo = process.env.TRACE_DOCUNO;
  if (!docuNo) throw new Error('ต้องตั้ง TRACE_DOCUNO');
  if (!/^[A-Za-z0-9\-_/]{1,25}$/.test(docuNo)) {
    // กันการแทรกคำสั่ง เพราะค่านี้ถูกวางลงในตัว SQL ที่บรรทัด DECLARE
    throw new Error('เลขที่เอกสารมีอักขระที่ไม่อนุญาต');
  }

  const file = path.resolve(__dirname, '..', '..', 'sql', 'maintenance', 'trace-document.sql');
  let sqlText = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const before = sqlText;
  sqlText = sqlText.replace(/DECLARE @DocuNo VARCHAR\(25\) = '[^']*';/,
                            `DECLARE @DocuNo VARCHAR(25) = '${docuNo}';`);
  if (sqlText === before) throw new Error('หาบรรทัด DECLARE @DocuNo ในไฟล์ .sql ไม่เจอ');

  const out = await wfQuery(sqlText);
  const sets = out.recordsets || [out.recordset || out];

  for (const set of sets) {
    if (!set || !set.length) continue;
    const label = set[0]['ส่วน'] || set[0]['ผล'] || '(ไม่มีป้าย)';
    console.log(`\n===== ${label} · ${set.length} แถว =====`);
    console.log(JSON.stringify(set, null, 1));
  }
  const empty = sets.filter(s => !s || !s.length).length;
  if (empty) console.log(`\n(อีก ${empty} ชุดไม่มีข้อมูล)`);
  process.exit(0);
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
