'use strict';
/**
 * build-drawio.js — รวมไดอะแกรมทุกภาพไว้ในไฟล์ .drawio เดียว (หลายหน้า)
 *
 * ทำไมต้องฝังเป็นภาพ ไม่ใช่โค้ด mermaid
 *   draw.io ไม่มีรูปทรงชนิด mermaid ที่เรนเดอร์ได้เอง — เมนู Insert > Mermaid
 *   เป็นการ "แปลงครั้งเดียวตอนวาง" ถ้าเก็บ mermaid ไว้ในเซลล์จะเห็นเป็นข้อความดิบ
 *   จึงฝัง PNG ที่เรนเดอร์แล้วเป็น data URI ทำให้เปิดไฟล์เดียวเห็นภาพครบ
 *   ไม่ต้องพึ่งไฟล์ภายนอก และยังย้าย/ปรับขนาด/เขียนทับได้ใน draw.io
 *
 * โค้ด mermaid ต้นฉบับใส่ไว้เป็นหมายเหตุของแต่ละหน้า เผื่อต้องแก้แล้วเรนเดอร์ใหม่
 *
 *   node docs/enterprise/pipeline/build-drawio.js
 */

const fs = require('fs');
const path = require('path');

const PIPELINE = __dirname;
const ENT = path.resolve(PIPELINE, '..');
const DIAG = path.join(PIPELINE, 'diagrams');
const OUT = path.join(ENT, '03-DRAWIO', 'worldfert-all-diagrams.drawio');

function diagramTitles() {
  try {
    const source = fs.readFileSync(path.join(PIPELINE, 'docgen', 'build_docx.py'), 'utf8');
    const match = /DIAG_TITLES=\{([\s\S]*?)\}/.exec(source);
    if (!match) return {};
    const titles = {};
    for (const pair of match[1].matchAll(/"([^"]+)":"([^"]+)"/g)) titles[pair[1]] = pair[2];
    return titles;
  } catch { return {}; }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function pngSize(buffer) {
  // อ่านความกว้าง/สูงจาก IHDR เพื่อวางกรอบให้ได้สัดส่วนถูกต้อง
  if (buffer.length < 24 || buffer.readUInt32BE(12) !== 0x49484452) return { width: 1200, height: 800 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// หน้าที่แปลงเป็นรูปทรงจริงได้ — ผู้ใช้ย้าย แก้ข้อความ เพิ่มลบโหนดได้ตามปกติ
function editablePage(stem, name, cells) {
  return `  <diagram id="${stem}" name="${escapeXml(name)}">
    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="${stem}-title" value="${escapeXml(name)}" style="text;html=1;fontSize=20;fontStyle=1;align=left;verticalAlign=middle;fontColor=#0C447C;" vertex="1" parent="1">
          <mxGeometry x="40" y="16" width="1500" height="34" as="geometry"/>
        </mxCell>
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>`;
}

function page(stem, name, png, mermaid) {
  const buffer = fs.readFileSync(png);
  const { width, height } = pngSize(buffer);
  // ย่อให้พอดีหน้ากระดาษแต่คงสัดส่วนเดิม
  const maxW = 1500, maxH = 900;
  const scale = Math.min(maxW / width, maxH / height, 1);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  // draw.io ใช้ ';' เป็นตัวคั่น style ดังนั้น data URI แบบมาตรฐาน 'data:image/png;base64,...'
  // จะทำให้ style ขาดตรง ';' และแสดงเป็นไอคอนภาพเสีย
  // รูปแบบที่ draw.io รับคือ 'data:image/png,<base64>' โดยไม่มี ';base64'
  const dataUri = 'data:image/png,' + buffer.toString('base64');

  return `  <diagram id="${stem}" name="${escapeXml(name)}">
    <mxGraphModel dx="1400" dy="900" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="${stem}-title" value="${escapeXml(name)}" style="text;html=1;fontSize=20;fontStyle=1;align=left;verticalAlign=middle;fontColor=#0C447C;" vertex="1" parent="1">
          <mxGeometry x="40" y="24" width="1500" height="40" as="geometry"/>
        </mxCell>
        <mxCell id="${stem}-img" value="" style="shape=image;html=1;imageAspect=1;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;image=${dataUri};" vertex="1" parent="1">
          <mxGeometry x="40" y="80" width="${w}" height="${h}" as="geometry"/>
        </mxCell>
        <mxCell id="${stem}-src" value="${escapeXml('ต้นฉบับ mermaid: pipeline/diagrams/' + stem + '.mmd — แก้ไฟล์นั้นแล้วสั่ง build-all.ps1 เพื่อเรนเดอร์ใหม่')}" style="text;html=1;fontSize=11;align=left;verticalAlign=middle;fontColor=#666666;" vertex="1" parent="1">
          <mxGeometry x="40" y="${100 + h}" width="1500" height="24" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>`;
}

function main() {
  if (!fs.existsSync(DIAG)) { console.error('ไม่พบโฟลเดอร์ diagrams: ' + DIAG); process.exitCode = 1; return; }
  const titles = diagramTitles();
  const stems = fs.readdirSync(DIAG)
    .filter(name => name.endsWith('.png'))
    .map(name => name.replace(/\.png$/, ''))
    .sort();

  if (!stems.length) {
    console.error('ไม่พบไฟล์ .png — สั่ง build-all.ps1 เพื่อเรนเดอร์ไดอะแกรมก่อน');
    process.exitCode = 1;
    return;
  }

  const { convert } = require('./mermaid-to-mxgraph');
  let editable = 0, imageOnly = [];

  const pages = stems.map(stem => {
    const name = titles[stem] ? `${stem} · ${titles[stem]}` : stem;
    const mmd = path.join(DIAG, stem + '.mmd');
    const mermaid = fs.existsSync(mmd) ? fs.readFileSync(mmd, 'utf8') : '';

    // แปลงเป็นรูปทรงจริงก่อนเสมอ ถอยไปใช้ภาพเฉพาะชนิดที่ยังแปลงไม่ได้
    const converted = mermaid ? convert(mermaid, stem) : null;
    if (converted) { editable++; return editablePage(stem, name, converted.cells); }

    imageOnly.push(stem);
    return page(stem, name, path.join(DIAG, stem + '.png'), mermaid);
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT,
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<mxfile host="app.diagrams.net" agent="WorldFert build-drawio.js" version="24.7.17" type="device" pages="${pages.length}">\n` +
    pages.join('\n') + '\n</mxfile>\n', 'utf8');

  const sizeMb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
  console.log('รวมไดอะแกรม ' + pages.length + ' หน้า — ' + sizeMb + ' MB');
  console.log('  แก้ไขได้จริง (รูปทรง draw.io): ' + editable + ' หน้า');
  if (imageOnly.length) {
    console.log('  ยังเป็นภาพ (ชนิดที่ตัวแปลงยังไม่รองรับ): ' + imageOnly.length + ' หน้า');
    for (const stem of imageOnly) console.log('    · ' + stem);
  }
  console.log('  ' + path.relative(process.cwd(), OUT));
}

main();
