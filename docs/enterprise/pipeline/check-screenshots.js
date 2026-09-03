'use strict';
// ตรวจว่าภาพหน้าจอไม่มีภาพไหนถ่ายติดสถานะกำลังโหลด
//
// ตัวโหลดของแอปเป็นการ์ดขาวกลางจอบนพื้นมืดโปร่งแสง (bg-black/20 + backdrop-blur)
// ตรวจได้จากสองสัญญาณรวมกัน: จุดกึ่งกลางภาพสว่างมาก และขอบภาพถูกลดความสว่างลง
//
//   node docs/enterprise/pipeline/check-screenshots.js

const fs = require('fs');
const path = require('path');

// pngjs ติดตั้งอยู่ใน backend/node_modules ไม่ใช่ที่ราก จึงต้องหาให้เจอเองโดยไม่ต้องพึ่ง NODE_PATH
// และไม่ต้องสนใจว่าผู้ใช้รันจากโฟลเดอร์ไหน
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const { PNG } = (() => {
  const candidates = [
    'pngjs',
    path.join(REPO_ROOT, 'backend', 'node_modules', 'pngjs'),
    path.join(REPO_ROOT, 'node_modules', 'pngjs'),
    path.join(REPO_ROOT, 'WSSale-App', 'node_modules', 'pngjs'),
  ];
  for (const candidate of candidates) {
    try { return { PNG: require(candidate).PNG }; } catch { /* ลองตัวถัดไป */ }
  }
  return {};
})();

const DIR = path.join(__dirname, '..', '05-UI-SCREENSHOTS', 'generated');

function averageLuma(png, x0, y0, x1, y1) {
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      const index = (png.width * y + x) << 2;
      sum += 0.2126 * png.data[index] + 0.7152 * png.data[index + 1] + 0.0722 * png.data[index + 2];
      count++;
    }
  }
  return count ? sum / count : 0;
}

function looksLikeOverlay(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width: w, height: h } = png;
  // การ์ดโหลดอยู่กลางจอ ส่วนขอบล่างถูกคลุมด้วยพื้นมืด
  const centre = averageLuma(png, Math.floor(w * 0.42), Math.floor(h * 0.40), Math.floor(w * 0.58), Math.floor(h * 0.60));
  const bottom = averageLuma(png, Math.floor(w * 0.10), Math.floor(h * 0.80), Math.floor(w * 0.90), Math.floor(h * 0.95));
  return { suspect: centre > 225 && bottom < 200, centre: Math.round(centre), bottom: Math.round(bottom) };
}

if (!PNG) {
  console.log('ไม่พบไลบรารี pngjs — ติดตั้งด้วยคำสั่งนี้แล้วรันใหม่:');
  console.log('  cd ' + REPO_ROOT + ' && npm --prefix backend install pngjs');
  process.exit(2);
}

if (!fs.existsSync(DIR)) {
  console.log('ยังไม่มีโฟลเดอร์ภาพ: ' + DIR);
  console.log('สร้างภาพก่อนด้วย: node docs/enterprise/pipeline/capture-screenshots.js');
  process.exit(2);
}

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.png')) : [];
const suspects = [];
for (const file of files) {
  const result = looksLikeOverlay(path.join(DIR, file));
  if (result.suspect) suspects.push({ file, ...result });
}

console.log(`ตรวจภาพ ${files.length} ไฟล์`);
if (suspects.length) {
  console.log(`พบภาพที่น่าสงสัยว่าติดสถานะโหลด ${suspects.length} ไฟล์:`);
  for (const s of suspects) console.log(`  ${s.file}  (กลาง ${s.centre} · ล่าง ${s.bottom})`);
  process.exitCode = 1;
} else {
  console.log('ไม่พบภาพที่ติดสถานะกำลังโหลด');
}
