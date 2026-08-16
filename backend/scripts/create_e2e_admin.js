/**
 * สร้าง/รีเซ็ตบัญชี e2e_admin สำหรับชุดทดสอบอัตโนมัติ
 *
 * รหัสผ่านอ่านจาก E2E_PASSWORD ใน .env เท่านั้น — **ห้ามเขียนค่าจริงลงไฟล์นี้**
 * ที่เก็บซอร์สนี้เป็นสาธารณะ รหัสที่เคยหลุดไปต้องล้าง git history ทั้งชุดเพื่อเอาออก
 * (ดู SECURITY-HISTORY-PURGE.md) จึงกันไว้ตั้งแต่ต้นทางว่าไม่มีค่าจริงในโค้ดเลย
 */
require('dotenv').config({ quiet: true });
const { wfQuery, sql } = require('../db');
const bcrypt = require('bcrypt');

async function run() {
  const password = process.env.E2E_PASSWORD;
  if (!password) {
    console.error('✗ ไม่พบ E2E_PASSWORD ใน .env — ตั้งค่าก่อนแล้วรันใหม่');
    process.exit(1);
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    await wfQuery(
      `IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username = 'e2e_admin')
       INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, IsActive)
       VALUES ('e2e_admin', @h, 'E2E Testing Admin', 'ADMIN', 1)
       ELSE
       UPDATE wf.AppUser SET PasswordHash = @h WHERE Username = 'e2e_admin'`,
      { h: { type: sql.NVarChar, value: hash } }
    );
    // ไม่พิมพ์รหัสออก log — log ถูกเก็บและส่งต่อได้ง่ายกว่าที่คิด
    console.log('✓ ตั้งค่าบัญชี e2e_admin แล้ว (รหัสจาก E2E_PASSWORD)');
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}
run();
