'use strict';
/**
 * sync_uat_markdown.js — เขียนคลังเคสจาก uat-cases.json ลงในแผน UAT เป็นบล็อก GENERATED
 *
 * ทำไมต้อง sync ไม่ใช่พิมพ์ซ้ำ: uat-cases.json เป็นแหล่งข้อมูลเดียวของทั้ง XLSX และ DOCX
 * ถ้าปล่อยให้ตารางในมาร์กดาวน์เขียนมือ มันจะค้างทันทีที่เพิ่มเคส แล้วเอกสารสองฉบับ
 * จะบอกจำนวนเคสไม่ตรงกันในการตรวจ ISO
 *
 *   node docs/enterprise/pipeline/docgen/sync_uat_markdown.js
 */

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ENT = path.resolve(HERE, '..', '..');
const PLAN = path.join(ENT, '06-QUALITY-OPERATIONS', 'UAT-FULL-LOOP-RUN-PLAN.md');
const START = '<!-- BEGIN GENERATED:UAT-CASE-CATALOGUE -->';
const END = '<!-- END GENERATED:UAT-CASE-CATALOGUE -->';

const doc = JSON.parse(fs.readFileSync(path.join(HERE, 'uat-cases.json'), 'utf8'));
const cases = doc.cases.slice().sort((a, b) => a.id.localeCompare(b.id));

// อักขระ | ในเนื้อหาจะทำให้ตารางมาร์กดาวน์เพี้ยน ต้อง escape ก่อนเสมอ
const cell = value => String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function render() {
  const manual = cases.filter(c => c.type === 'Manual');
  const auto = cases.filter(c => c.type === 'Automated');
  const lines = [START, ''];

  lines.push('> บล็อกนี้สร้างจาก `pipeline/docgen/uat-cases.json` โดยอัตโนมัติ — แก้ที่ไฟล์นั้น ห้ามแก้ตรงนี้');
  lines.push('');
  lines.push(`**รวม ${cases.length} เคส** · ทำมือ ${manual.length} · อัตโนมัติ ${auto.length} · เคสวิกฤต ${cases.filter(c => c.critical).length} · ข้อบกพร่องที่ทราบแล้ว ${cases.filter(c => c.knownIssue).length}`);
  lines.push('');

  lines.push('### สรุปตามด้านที่ทดสอบ');
  lines.push('');
  lines.push('| ด้านที่ทดสอบ | ทั้งหมด | ทำมือ | อัตโนมัติ |');
  lines.push('|---|---:|---:|---:|');
  for (const area of [...new Set(cases.map(c => c.area))].sort()) {
    const list = cases.filter(c => c.area === area);
    lines.push(`| ${cell(area)} | ${list.length} | ${list.filter(c => c.type === 'Manual').length} | ${list.filter(c => c.type === 'Automated').length} |`);
  }
  lines.push('');

  const table = (title, list, note) => {
    lines.push(`### ${title}`);
    lines.push('');
    if (note) { lines.push(note); lines.push(''); }
    lines.push('| Case ID | วิกฤต | ด้าน | ผู้ทดสอบ | สิ่งที่ต้องพิสูจน์ | ผลที่คาดหวัง | หลักฐานขั้นต่ำ | สคริปต์ |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const c of list) {
      lines.push('| `' + c.id + '` | ' + (c.critical ? '✅' : '') + ' | ' + cell(c.area) + ' | ' + cell(c.actor)
        + ' | ' + cell(c.titleTh) + ' | ' + cell(c.expected) + ' | ' + cell(c.evidence)
        + ' | ' + (c.automationRef ? '`' + cell(c.automationRef) + '`' : '—') + ' |');
    }
    lines.push('');
  };

  table('เคสอัตโนมัติ', auto, 'รันได้ด้วยสคริปต์ที่ระบุ ผลลัพธ์ใช้เป็นหลักฐานได้โดยตรง');
  table('เคสที่ต้องทำมือ', manual, 'ต้องมีผู้ทดสอบจริงและเก็บหลักฐานเอง ระบุชื่อผู้ทดสอบและวันที่ทุกครั้ง');

  const known = cases.filter(c => c.knownIssue);
  if (known.length) {
    lines.push('### ข้อบกพร่องที่ทราบแล้ว — ต้องยืนยันว่าแก้แล้วก่อนลงนาม');
    lines.push('');
    for (const c of known) lines.push(`- \`${c.id}\` ${cell(c.titleTh)}`);
    lines.push('');
  }

  lines.push('### ขั้นตอนโดยละเอียดของแต่ละเคส');
  lines.push('');
  for (const c of cases) {
    lines.push(`#### ${c.id} — ${cell(c.titleTh)}`);
    lines.push('');
    lines.push(`- **ชนิด:** ${c.type === 'Automated' ? 'อัตโนมัติ' : 'ทำมือ'}${c.critical ? ' · **เคสวิกฤต**' : ''}`);
    lines.push(`- **ผู้ทดสอบ:** ${cell(c.actor)}`);
    if (c.preconditions) lines.push(`- **เงื่อนไขก่อนเริ่ม:** ${cell(c.preconditions)}`);
    if (c.testData) lines.push(`- **ข้อมูลทดสอบ:** ${cell(c.testData)}`);
    if ((c.requirementIds || []).length) lines.push(`- **อ้างอิงข้อกำหนด:** ${c.requirementIds.join(', ')}`);
    lines.push('');
    (c.steps || []).forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    lines.push('');
    lines.push(`**ผลที่คาดหวัง:** ${cell(c.expected)}`);
    lines.push('');
    lines.push(`**หลักฐานขั้นต่ำ:** ${cell(c.evidence)}`);
    lines.push('');
  }

  lines.push(END);
  return lines.join('\n');
}

let text = fs.readFileSync(PLAN, 'utf8');
const block = render();
if (text.includes(START) && text.includes(END)) {
  text = text.slice(0, text.indexOf(START)) + block + text.slice(text.indexOf(END) + END.length);
} else {
  // แทรกไว้ก่อนหัวข้อตารางเวลา เพื่อให้อ่านต่อจากรายการเคสได้ทันที
  const anchor = '## 8. Suggested run schedule';
  const at = text.indexOf(anchor);
  const section = '## 7.1 คลังเคสทดสอบทั้งหมด (สร้างอัตโนมัติ)\n\n' + block + '\n\n';
  text = at < 0 ? text + '\n\n' + section : text.slice(0, at) + section + text.slice(at);
}
fs.writeFileSync(PLAN, text, 'utf8');
console.log(`เขียนคลังเคส ${cases.length} เคสลง ${path.relative(process.cwd(), PLAN)}`);
