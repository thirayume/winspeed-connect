'use strict';
/**
 * build_xlsx.js — สร้างสมุดงาน UAT จาก uat-cases.json ซึ่งเป็นแหล่งข้อมูลเดียว
 *
 * ออก 2 แบบ
 *   UAT-Master-Script-<version>.xlsx   ทุกเคส พร้อมชีตสรุป checklist และบันทึกข้อบกพร่อง
 *   UAT-<ROLE>-<version>.xlsx          เฉพาะเคสที่บทบาทนั้นต้องลงมือทำ
 *
 * ไม่ hardcode รายชื่อบทบาทและเคส ทุกอย่างอ่านจาก uat-cases.json และ docx-manifest.json
 *
 *   node docs/enterprise/pipeline/docgen/build_xlsx.js
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const HERE = __dirname;
const ENT = path.resolve(HERE, '..', '..');
const REPO = path.resolve(ENT, '..', '..');
const OUT = path.join(ENT, '06-XLSX', 'uat');

// xlsx ติดตั้งอยู่ใน backend ไม่ใช่ในโฟลเดอร์นี้ — resolve เองเพื่อให้สั่งรันจากที่ไหนก็ได้
function loadXlsx() {
  const candidates = [
    path.join(REPO, 'backend', 'node_modules', 'xlsx'),
    path.join(REPO, 'node_modules', 'xlsx'),
    process.env.NODE_PATH ? path.join(process.env.NODE_PATH, 'xlsx') : null,
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return createRequire(path.join(dir, 'package.json'))('xlsx');
  }
  try { return require('xlsx'); } catch { /* ตกไปที่ข้อความด้านล่าง */ }
  throw new Error('ไม่พบไลบรารี xlsx — ติดตั้งด้วย npm install xlsx ในโฟลเดอร์ backend');
}

const XLSX = loadXlsx();
const CASES = JSON.parse(fs.readFileSync(path.join(HERE, 'uat-cases.json'), 'utf8'));
const ROLES = JSON.parse(fs.readFileSync(path.join(HERE, 'docx-manifest.json'), 'utf8')).roles;

const APP_VERSION = (() => {
  try { return require(path.join(REPO, 'package.json')).version; }
  catch { return CASES.runtimeVersion || '0.0.0'; }
})();
const DOC_VERSION = 'v' + APP_VERSION;

const sheet = (book, name, rows, widths) => {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (widths) ws['!cols'] = widths.map(w => ({ wch: w }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  // ชื่อชีตของ Excel ยาวได้ไม่เกิน 31 ตัวและห้ามอักขระบางตัว
  XLSX.utils.book_append_sheet(book, ws, name.replace(/[\\/?*[\]:]/g, '-').slice(0, 31));
};

const CASE_HEADER = [
  'Case ID', 'ชนิด', 'วิกฤต', 'ด้านที่ทดสอบ', 'ผู้ทดสอบ (บทบาท)', 'สิ่งที่ต้องพิสูจน์',
  'เงื่อนไขก่อนเริ่ม', 'ข้อมูลทดสอบ', 'ขั้นตอน', 'ผลที่คาดหวัง', 'อ้างอิงข้อกำหนด', 'หลักฐานขั้นต่ำ',
  'สคริปต์อัตโนมัติ', 'ผล', 'ผลที่เกิดขึ้นจริง', 'เลขข้อบกพร่อง', 'ผู้ทดสอบ', 'วันที่ทดสอบ',
  'ผู้ตรวจทาน', 'วันที่ตรวจทาน', 'หมายเหตุ',
];
const CASE_WIDTH = [14, 10, 7, 22, 22, 46, 34, 30, 60, 46, 18, 34, 34, 9, 34, 14, 14, 12, 14, 12, 26];

const caseRow = c => ([
  c.id,
  c.type === 'Automated' ? 'อัตโนมัติ' : 'ทำมือ',
  c.critical ? 'ใช่' : 'ไม่ใช่',
  c.area,
  c.actor,
  c.titleTh,
  c.preconditions || '',
  c.testData || '',
  (c.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n'),
  c.expected || '',
  (c.requirementIds || []).join(', '),
  c.evidence || '',
  c.automationRef || '',
  c.status || 'Not Run',
  '', '', '', '', '', '',
  c.knownIssue ? 'ข้อบกพร่องที่ทราบแล้ว — ต้องยืนยันว่าแก้แล้วก่อนลงนาม' : '',
]);

function summarySheet(book, cases, scope) {
  const total = cases.length;
  const auto = cases.filter(c => c.type === 'Automated').length;
  const rows = [
    ['สมุดงาน UAT — WS-Sale-App'], [],
    ['ขอบเขต', scope],
    ['เวอร์ชันเอกสาร', DOC_VERSION],
    ['เวอร์ชันระบบที่ทดสอบ', APP_VERSION],
    ['จำนวนเคสทั้งหมด', total],
    ['ทำมือ', total - auto],
    ['อัตโนมัติ', auto],
    ['เคสวิกฤต (ต้องผ่านทุกข้อ)', cases.filter(c => c.critical).length],
    ['ข้อบกพร่องที่ทราบแล้ว', cases.filter(c => c.knownIssue).length],
    [],
    ['สถานะที่ใช้ได้', (CASES.statusValues || []).join(' · ')],
    [],
    ['กติกา'],
    ['1', 'ห้ามเปลี่ยน Fail เป็น Pass โดยไม่มีหลักฐานการทดสอบซ้ำ'],
    ['2', 'ทุก Fail ต้องมีเลขข้อบกพร่อง ผู้รับผิดชอบ และกำหนดวันแก้'],
    ['3', 'เคสวิกฤตที่ไม่ผ่าน = ไม่ผ่านเกณฑ์ปล่อยระบบ'],
    ['4', 'ทุกการทดสอบต้องล้างข้อมูลทดสอบของตัวเองเมื่อจบ'],
    [],
    ['สรุปตามด้านที่ทดสอบ'],
    ['ด้าน', 'จำนวน', 'ทำมือ', 'อัตโนมัติ'],
  ];
  const areas = [...new Set(cases.map(c => c.area))].sort();
  for (const area of areas) {
    const list = cases.filter(c => c.area === area);
    rows.push([area, list.length, list.filter(c => c.type === 'Manual').length, list.filter(c => c.type === 'Automated').length]);
  }
  sheet(book, 'สรุป', rows, [34, 44, 12, 12]);
}

function checklistSheet(book) {
  const rows = [
    ['รายการตรวจก่อนเริ่มรอบทดสอบ (Entry checklist)', 'ผู้รับผิดชอบ', 'ผ่าน', 'หลักฐาน'],
    ['ตรึงเวอร์ชันที่จะทดสอบและบันทึก commit hash', 'QA', '', ''],
    ['ใช้ migration ครบทุกตัวและ ledger ไม่มี drift', 'DBA', '', ''],
    ['seed บัญชีทดสอบครบทั้ง 9 บทบาท', 'DBA', '', ''],
    ['ตรวจว่าเชื่อมต่อฐานเครื่องชั่ง (MySQL) ได้', 'IT', '', ''],
    ['เตรียมข้อมูลทดสอบ ลูกค้า สินค้า และทะเบียนรถ', 'QA + Business', '', ''],
    ['สำรองฐานข้อมูลก่อนเริ่ม และทดสอบว่ากู้คืนได้', 'DBA', '', ''],
    ['ยืนยันว่าใช้ฐานข้อมูลทดสอบ ไม่ใช่ฐานจริง', 'IT + QA', '', ''],
    ['เตรียมแบบฟอร์มบันทึกหลักฐานและที่เก็บไฟล์', 'QA', '', ''],
    [],
    ['รายการตรวจก่อนลงนาม (Exit checklist)', 'ผู้รับผิดชอบ', 'ผ่าน', 'หลักฐาน'],
    ['เคสวิกฤตผ่านครบทุกข้อ', 'QA', '', ''],
    ['ข้อบกพร่องระดับ Sev-1 และ Sev-2 ปิดครบ', 'QA + Dev', '', ''],
    ['ข้อบกพร่องที่ทราบแล้วได้รับการยืนยันว่าแก้แล้ว', 'QA', '', ''],
    ['ล้างข้อมูลทดสอบครบทั้งสองฐาน และตรวจนับแล้ว', 'QA + DBA', '', ''],
    ['เปลี่ยนรหัสผ่านบัญชีที่ใช้ซ้ำกันก่อนเปิดใช้จริง', 'IT Security', '', ''],
    ['มีแผนสำรองข้อมูลของฐานเครื่องชั่งพร้อมเจ้าภาพ', 'IT', '', ''],
    ['รวบรวมหลักฐานครบตามรายการใน UAT plan ข้อ 10', 'QA', '', ''],
    ['ผู้มีอำนาจลงนามครบทุกฝ่าย', 'Business Sponsor', '', ''],
    [],
    ['รายการตรวจประจำวันระหว่างรอบทดสอบ', 'ผู้รับผิดชอบ', 'ผ่าน', 'หลักฐาน'],
    ['ทบทวนผลของวันและบันทึกข้อบกพร่องใหม่', 'QA', '', ''],
    ['ตรวจว่าไม่มีข้อมูลทดสอบค้างจากวันก่อนหน้า', 'QA', '', ''],
    ['ยืนยันว่าเวอร์ชันที่ทดสอบยังเป็นตัวเดิม', 'QA', '', ''],
  ];
  sheet(book, 'Checklist', rows, [58, 20, 8, 34]);
}

function defectSheet(book) {
  sheet(book, 'บันทึกข้อบกพร่อง', [
    ['เลขข้อบกพร่อง', 'Case ID', 'ระดับ', 'อาการที่พบ', 'ผลที่ควรเป็น', 'หลักฐาน', 'ผู้รับผิดชอบ', 'กำหนดแก้', 'ผลทดสอบซ้ำ', 'ผู้ตรวจ', 'วันที่ปิด'],
    ['', '', 'Sev-1 = ข้อมูลเสียหาย/ความปลอดภัย/ทำงานต่อไม่ได้', '', '', '', '', '', '', '', ''],
    ['', '', 'Sev-2 = control หรือการเชื่อมต่อผิด ทางเลี่ยงไม่ปลอดภัย', '', '', '', '', '', '', '', ''],
    ['', '', 'Sev-3 = ทำงานผิดแต่มีทางเลี่ยงที่ปลอดภัย', '', '', '', '', '', '', '', ''],
    ['', '', 'Sev-4 = ความสวยงาม/เอกสาร/ใช้งานไม่สะดวกเล็กน้อย', '', '', '', '', '', '', '', ''],
  ], [16, 14, 46, 40, 40, 30, 18, 14, 30, 16, 12]);
}

function signoffSheet(book) {
  const rows = [['ฝ่าย', 'ชื่อผู้ลงนาม', 'ตำแหน่ง', 'ผลการตัดสิน', 'วันที่', 'เงื่อนไข/ข้อสงวน']];
  for (const party of ['ฝ่ายขาย', 'ตรวจซ้ำหน้าร้าน', 'ผู้จัดการ', 'ผู้อนุมัติ', 'คลังสินค้า', 'เครื่องชั่ง', 'บัญชีและการเงิน', 'ผู้ดูแลระบบ / IT', 'QA', 'ผู้บริหาร (C-Level)']) {
    rows.push([party, '', '', '', '', '']);
  }
  rows.push([], ['เว้นว่างช่องชื่อ วันที่ หรือหลักฐาน = ยังไม่ผ่านด่านนี้']);
  sheet(book, 'ลงนาม', rows, [26, 26, 24, 18, 14, 40]);
}

// commit ที่ทดสอบคือสาระสำคัญของสมุดงานรอบทดสอบ ต้องบันทึกไว้ ไม่ใช่ให้คนจำเอง
function sourceCommit() {
  try {
    return require('child_process').execSync('git rev-parse HEAD', { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch { return '(อ่านไม่ได้ — กรอกเอง)'; }
}

function readmeSheet(book, scope) {
  sheet(book, 'วิธีใช้', [
    ['สมุดงาน UAT — WS-Sale-App'],
    ['สร้างอัตโนมัติจาก pipeline/docgen/uat-cases.json ซึ่งเป็นแหล่งข้อมูลเดียว — ห้ามแก้เนื้อหาเคสในไฟล์นี้'],
    [],
    ['Document ID', 'WF-QA-022-XLSX'],
    ['ผลิตภัณฑ์', CASES.product || 'WS-Sale-App'],
    ['ลูกค้า', CASES.client || 'บริษัท เวิลด์ เฟอท จำกัด'],
    ['ขอบเขตสมุดงานนี้', scope],
    ['เวอร์ชันระบบที่ทดสอบ', APP_VERSION],
    ['commit ที่ใช้ทดสอบ', sourceCommit()],
    ['สร้างเมื่อ', new Date().toISOString()],
    ['ชั้นความลับ', CASES.confidentiality || ''],
    [],
    ['ลำดับการใช้งาน'],
    ['1', 'ควบคุมรอบทดสอบ', 'กรอกสภาพแวดล้อม build ผู้รับผิดชอบ และสถานะระบบที่พึ่งพา ก่อนเริ่ม'],
    ['2', 'เคสทั้งหมด', 'มอบหมายผู้ทดสอบ ทำตามขั้นตอน แล้วบันทึกผลที่เกิดขึ้นจริง สถานะ ข้อบกพร่อง และหลักฐาน'],
    ['3', 'ลำดับข้ามบทบาท', 'ใช้คุมลำดับการส่งงานระหว่างบทบาทและจุดหยุดตรวจของกระบวนการหลัก'],
    ['4', 'บันทึกข้อบกพร่อง / ทะเบียนหลักฐาน', 'ทุก Fail ต้องมีเลขข้อบกพร่อง และทุก Pass ต้องมีหลักฐานที่ตรวจย้อนได้'],
    ['5', 'แดชบอร์ด', 'ตรวจอัตราผ่านของเคสวิกฤตและข้อบกพร่องที่ยังเปิดอยู่ ก่อนเสนอให้ลงนาม'],
    ['6', 'ลงนาม', 'ผู้มีอำนาจลงชื่อ วันที่ และหลักฐาน — ระบบสร้างเอกสารไม่มีสิทธิ์อนุมัติแทน'],
    [],
    ['ข้อควบคุมสำคัญ'],
    ['•', 'ผลการทดสอบอัตโนมัติเป็นหลักฐานประกอบ ต้องรันใหม่เมื่อโค้ดหรือชุดทดสอบเปลี่ยน'],
    ['•', 'เคสวิกฤตต้องผ่าน 100% · ห้ามเปลี่ยน Fail เป็น Pass โดยไม่มีหลักฐานการทดสอบซ้ำ'],
    ['•', 'ด่านที่ต้องให้คนตัดสิน (manual gate) ให้ระบบอัตโนมัติผ่านแทนไม่ได้'],
    ['•', 'ใช้ข้อมูลจำลองหรือปกปิดแล้วเท่านั้น ห้ามใส่ความลับหรือข้อมูลส่วนบุคคลที่ไม่จำเป็น'],
    ['•', 'ทุกการทดสอบต้องล้างข้อมูลทดสอบของตัวเองเมื่อจบ'],
    ['•', 'สมุดงานนี้ยังไม่ถือว่าผ่าน จนกว่าจะมีชื่อ วันที่ ผลการตัดสิน และหลักฐานครบ'],
  ], [26, 30, 76]);
}

function runControlSheet(book) {
  const rows = [
    ['ควบคุมรอบทดสอบ'],
    ['กรอกให้ครบก่อนเริ่ม — ช่องที่ว่างหมายความว่ายังไม่ผ่านด่านเริ่มต้น'],
    [],
    ['ข้อมูลรอบทดสอบและสภาพแวดล้อม'],
    ['รหัสรอบทดสอบ', '', 'สภาพแวดล้อม', 'UAT', 'เวอร์ชันระบบ', APP_VERSION],
    ['commit ที่ทดสอบ', sourceCommit(), 'ชุดข้อมูลทดสอบ', '', 'ค่าตั้งต้นที่ใช้', ''],
    ['URL หน้าจอ', '', 'URL ของ API', '', 'SQL Server', ''],
    ['MySQL เครื่องชั่ง', '', 'การเชื่อมต่อ WINSpeed', '', 'รหัสสำรองข้อมูล', ''],
    ['ที่เก็บหลักฐาน', '', 'ระบบติดตามข้อบกพร่อง', '', 'ผู้นำการทดสอบ (QA)', ''],
    ['เจ้าของกระบวนการธุรกิจ', '', 'เริ่มเมื่อ', '', 'สิ้นสุดเมื่อ', ''],
    ['เป็นตัวเลือกที่จะปล่อยจริง', 'ยังไม่ใช่', 'ตรึงการเปลี่ยนแปลงแล้ว', 'ยังไม่ตรึง', 'ผลการตัดสินด่านเริ่มต้น', 'ยังไม่พร้อม'],
    [],
    ['รายการตรวจก่อนเริ่ม', 'ผู้รับผิดชอบ', 'สถานะ', 'หลักฐาน/อ้างอิง', 'ผู้ตรวจทาน', 'วันที่ตรวจทาน', 'หมายเหตุ'],
  ];
  for (const control of CASES.entryControls || []) {
    rows.push([`${control.id} · ${control.control}`, control.owner, 'ยังไม่ตรวจ', '', '', '', '']);
  }
  rows.push([]);
  rows.push(['ด่านที่ต้องให้คนตัดสิน (ให้ระบบอัตโนมัติผ่านแทนไม่ได้)', 'สถานะ', 'ผู้ตัดสิน', 'วันที่', 'หลักฐาน']);
  for (const gate of CASES.manualGates || []) rows.push([gate, 'รอดำเนินการ', '', '', '']);
  sheet(book, 'ควบคุมรอบทดสอบ', rows, [56, 22, 16, 30, 18, 14, 26]);
}

function fullLoopSheet(book, cases) {
  const byId = new Map(cases.map(c => [c.id, c]));
  const order = (CASES.fullLoop || []).filter(id => byId.has(id));
  if (!order.length) return;
  const rows = [
    ['ลำดับการทดสอบข้ามบทบาท'],
    ['ทำตามลำดับและหยุดตรวจที่จุดหยุดของแต่ละขั้น — ห้ามข้ามขั้นเพื่อความรวดเร็ว'],
    [],
    ['ลำดับ', 'Case ID', 'บทบาทที่ลงมือ', 'สิ่งที่ต้องทำ', 'จุดหยุดตรวจ', 'หลักฐาน', 'ผล', 'ข้อบกพร่อง', 'ผู้ทดสอบ', 'วันที่'],
  ];
  order.forEach((id, index) => {
    const c = byId.get(id);
    rows.push([index + 1, c.id, c.actor, c.titleTh, c.expected, c.evidence, c.status || 'Not Run', '', '', '']);
  });
  const missing = (CASES.fullLoop || []).filter(id => !byId.has(id));
  if (missing.length) {
    rows.push([]);
    rows.push(['เคสในลำดับที่ไม่อยู่ในขอบเขตสมุดงานนี้', missing.join(', ')]);
  }
  sheet(book, 'ลำดับข้ามบทบาท', rows, [8, 14, 26, 50, 50, 34, 10, 14, 14, 12]);
}

function dashboardSheet(book, cases) {
  const critical = cases.filter(c => c.critical).length;
  const rows = [
    ['แดชบอร์ดสรุปผล'],
    ['กรอกช่อง "จำนวน" จากชีตเคสทั้งหมดเมื่อทดสอบเสร็จแต่ละวัน — ตัวเลขนี้ไม่ใช่การอนุมัติ ต้องทบทวนหลักฐานเสมอ'],
    [],
    ['สถานะเคส', 'จำนวน', '', 'เกณฑ์คุณภาพ', 'เป้าหมาย', 'ผล'],
    ['ทั้งหมด', cases.length, '', 'เคสวิกฤตผ่าน', '100%', 'ยังไม่พร้อม'],
    ['ผ่าน', '', '', 'ผ่านโดยรวม', 'ไม่ต่ำกว่า 90%', 'ยังไม่พร้อม'],
    ['ไม่ผ่าน', '', '', 'Sev-1 ที่ยังเปิด', '0', ''],
    ['ติดขัด', '', '', 'Sev-2 ที่ยังเปิด', '0', ''],
    ['ยังไม่ทดสอบ', cases.length, '', 'ความพร้อมขั้นสุดท้าย', 'ผ่านด่านคนตัดสินครบ + ลงนามครบ', 'รอดำเนินการ'],
    [],
    ['เคสวิกฤตทั้งหมด', critical],
    ['ข้อบกพร่องที่ทราบแล้วและต้องยืนยันว่าแก้แล้ว', cases.filter(c => c.knownIssue).length],
    [],
    ['ด่านที่ต้องให้คนตัดสิน', 'สถานะ'],
  ];
  for (const gate of CASES.manualGates || []) rows.push([gate, 'รอดำเนินการ']);
  sheet(book, 'แดชบอร์ด', rows, [44, 12, 4, 34, 32, 16]);
}

function evidenceSheet(book, cases) {
  const rows = [
    ['ทะเบียนหลักฐาน'],
    ['ทุกเคสที่บันทึกว่า Pass ต้องมีหลักฐานอย่างน้อยหนึ่งรายการที่เปิดย้อนดูได้'],
    [],
    ['ลำดับ', 'Case ID', 'ชนิดหลักฐาน', 'หลักฐานขั้นต่ำที่กำหนด', 'ชื่อไฟล์/ที่เก็บจริง', 'ผู้เก็บ', 'วันที่', 'ผู้ตรวจทาน', 'หมายเหตุ'],
  ];
  cases.forEach((c, index) => rows.push([index + 1, c.id, '', c.evidence || '', '', '', '', '', '']));
  sheet(book, 'ทะเบียนหลักฐาน', rows, [8, 14, 24, 44, 40, 16, 12, 16, 24]);
}

function lookupsSheet(book) {
  const names = Object.keys(CASES.lookups || {});
  if (!names.length) return;
  const depth = Math.max(...names.map(n => CASES.lookups[n].length));
  const rows = [
    ['ค่าที่ใช้เป็นตัวเลือก'],
    ['ใช้ค่าเหล่านี้เท่านั้นในช่องที่เกี่ยวข้อง — แก้ได้ที่ uat-cases.json เท่านั้น'],
    [],
    names,
  ];
  for (let i = 0; i < depth; i++) rows.push(names.map(n => CASES.lookups[n][i] || ''));
  sheet(book, 'ค่าที่ใช้ได้', rows, names.map(() => 24));
}

function build(name, cases, scope) {
  const book = XLSX.utils.book_new();
  readmeSheet(book, scope);
  summarySheet(book, cases, scope);
  runControlSheet(book);
  sheet(book, 'เคสทั้งหมด', [CASE_HEADER, ...cases.map(caseRow)], CASE_WIDTH);
  const manual = cases.filter(c => c.type === 'Manual');
  const auto = cases.filter(c => c.type === 'Automated');
  if (manual.length) sheet(book, 'ทำมือ', [CASE_HEADER, ...manual.map(caseRow)], CASE_WIDTH);
  if (auto.length) sheet(book, 'อัตโนมัติ', [CASE_HEADER, ...auto.map(caseRow)], CASE_WIDTH);
  fullLoopSheet(book, cases);
  checklistSheet(book);
  dashboardSheet(book, cases);
  defectSheet(book);
  evidenceSheet(book, cases);
  signoffSheet(book);
  lookupsSheet(book);
  const file = path.join(OUT, `${name}-${DOC_VERSION}.xlsx`);
  XLSX.writeFile(book, file);
  return file;
}

fs.mkdirSync(OUT, { recursive: true });
const built = [build('UAT-Master-Script', CASES.cases, 'ทุกบทบาท ทุกด้าน')];

// สมุดงานรายบทบาท: คัดเฉพาะเคสที่ระบุรหัสบทบาทนั้นไว้ในช่องผู้ทดสอบ
for (const [key, info] of Object.entries(ROLES)) {
  const rbac = info.rbac || key;
  const mine = CASES.cases.filter(c => String(c.actor).toUpperCase().includes(rbac));
  if (!mine.length) continue;
  built.push(build(`UAT-${rbac}`, mine, `บทบาท ${info.titleTh || key} (${rbac})`));
}

console.log('สร้างสมุดงาน UAT', built.length, 'ไฟล์');
for (const file of built) {
  const cases = file.includes('Master') ? CASES.cases.length : '';
  console.log('  -', path.basename(file), cases ? `(${cases} เคส)` : '');
}
console.log(' ', path.relative(process.cwd(), OUT));
