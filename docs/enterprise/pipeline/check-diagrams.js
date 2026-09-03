'use strict';
/**
 * check-diagrams.js — ตรวจว่าไดอะแกรมที่แปลงเป็นรูปทรง draw.io แล้ว "ครบและอ่านได้"
 *
 * ที่ต้องมีตัวตรวจนี้เพราะข้อผิดพลาดของตัวแปลงไม่ทำให้ build ล้ม มันเงียบ ๆ แล้วได้ไฟล์
 * ที่เปิดได้แต่เนื้อหาหาย เช่น เส้นที่เขียนต่อกันในบรรทัดเดียว (A --> B --> C) ได้แค่เส้นเดียว
 * หรือ Note/alt ในผังลำดับหายไปทั้งบล็อก — ต้องเทียบกับ .mmd ต้นฉบับเท่านั้นถึงจะเห็น
 *
 *   node docs/enterprise/pipeline/check-diagrams.js
 *
 * ออกรหัส 1 เมื่อพบปัญหา เพื่อให้ build-all.ps1 หยุดได้
 */

const fs = require('fs');
const path = require('path');

const DIAG = path.join(__dirname, 'diagrams');
const { convert } = require('./mermaid-to-mxgraph');

// กล่องที่ "ตั้งใจ" ให้คลุมทับของอื่น ไม่นับว่าซ้อนกันผิด
const CONTAINER = /shape=umlFrame|shape=note|umlLifeline|-grp-|shape=table;|swimlane;fontStyle/;

function boxes(xml, only) {
  const found = [];
  const re = /<mxCell id="([^"]*)" value="([^"]*)" style="([^"]*)"[^>]*vertex="1" parent="1">\s*<mxGeometry x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/g;
  let hit;
  while ((hit = re.exec(xml))) {
    const isContainer = CONTAINER.test(hit[1] + hit[3]);
    const isGroup = hit[1].includes('-grp-');
    if (only === 'group' ? !isGroup : isContainer) continue;
    found.push({ label: hit[2] || hit[1], x: +hit[4], y: +hit[5], w: +hit[6], h: +hit[7] });
  }
  return found;
}

function collisions(list) {
  const hits = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) hits.push(`${a.label} × ${b.label}`);
    }
  }
  return hits;
}

// นับลูกศรใน mermaid โดยตัดข้อความในวงเล็บ/ปีกกา/อัญประกาศออกก่อน กันการนับเครื่องหมายในป้าย
function countArrows(source) {
  let total = 0;
  for (let line of source.split('\n').map(l => l.trim())) {
    if (!line || /^(flowchart|graph|stateDiagram|subgraph|end|%%|classDef|class |style |linkStyle|direction)/i.test(line)) continue;
    line = line.replace(/\[[^\]]*\]/g, 'N').replace(/\{[^}]*\}/g, 'N').replace(/\([^)]*\)/g, 'N').replace(/"[^"]*"/g, 'Q');
    total += (line.match(/-{2,3}>|-\.-*>|={2,3}>|\.-{1,2}>/g) || []).length;
  }
  return total;
}

function main() {
  const files = fs.readdirSync(DIAG).filter(name => name.endsWith('.mmd')).sort();
  if (!files.length) { console.error('ไม่พบไฟล์ .mmd ใน ' + DIAG); process.exitCode = 1; return; }

  let failed = 0;
  for (const file of files) {
    const stem = file.replace(/\.mmd$/, '');
    const source = fs.readFileSync(path.join(DIAG, file), 'utf8');
    const lines = source.split('\n').map(l => l.trim()).filter(Boolean);
    const kind = (lines.find(l => !l.startsWith('%%')) || '').split(/[\s-]/)[0];

    const out = convert(source, stem);
    if (!out) { console.error(`FAIL ${stem} (${kind}) — แปลงเป็นรูปทรงไม่ได้ จะกลายเป็นภาพฝังที่แก้ไม่ได้`); failed++; continue; }
    const xml = out.cells.join('\n');
    const problems = [];

    if (/^(flowchart|graph|stateDiagram)/i.test(kind)) {
      const want = countArrows(source);
      if (out.edgeCount !== want) problems.push(`ลูกศรหาย: mmd มี ${want} แปลงได้ ${out.edgeCount}`);
    }

    if (/^sequenceDiagram/i.test(kind)) {
      const notes = lines.filter(l => /^note\s/i.test(l)).length;
      const frags = lines.filter(l => /^(alt|opt|loop|par|critical|break)\b/i.test(l)).length;
      const elses = lines.filter(l => /^(else|and|option)\b/i.test(l)).length;
      const gotNotes = (xml.match(/shape=note;/g) || []).length;
      const gotFrames = (xml.match(/shape=umlFrame;/g) || []).length;
      const gotElses = (xml.match(/-d\d+" value=""/g) || []).length;
      if (gotNotes !== notes) problems.push(`Note หาย: ${gotNotes}/${notes}`);
      if (gotFrames !== frags) problems.push(`บล็อก alt/loop หาย: ${gotFrames}/${frags}`);
      if (gotElses !== elses) problems.push(`เส้นแบ่ง else หาย: ${gotElses}/${elses}`);
    }

    const overlap = collisions(boxes(xml, 'content'));
    if (overlap.length) problems.push(`กล่องทับกัน ${overlap.length}: ${overlap.slice(0, 3).join(' | ')}`);

    const groupOverlap = collisions(boxes(xml, 'group'));
    if (groupOverlap.length) problems.push(`กรอบ subgraph ทับกัน ${groupOverlap.length}: ${groupOverlap.slice(0, 3).join(' | ')}`);

    // หัวเรื่องของหน้าอยู่ที่ y=16 สูง 34 เนื้อหาทุกชิ้นต้องอยู่ต่ำกว่านั้น
    const tooHigh = [...xml.matchAll(/<mxGeometry x="-?\d+" y="(-?\d+)"/g)].filter(m => +m[1] < 52).length;
    if (tooHigh) problems.push(`มี ${tooHigh} ชิ้นวางทับหัวเรื่องของหน้า`);

    if (problems.length) { failed++; console.error(`FAIL ${stem} (${kind})\n       - ` + problems.join('\n       - ')); }
    else console.log(`ok   ${stem.padEnd(34)} ${kind.padEnd(16)} รูปทรง ${out.nodeCount} · เส้น ${out.edgeCount}`);
  }

  if (failed) { console.error(`\n${failed} ไดอะแกรมมีปัญหา`); process.exitCode = 1; }
  else console.log(`\nไดอะแกรมผ่านครบ ${files.length} รายการ`);
}

main();
