#!/usr/bin/env node
/**
 * verify-reports.js — รันรายงานทุกฉบับและสั่ง export จริงทุกฉบับ
 *
 * ทำไมต้องมี: รายงานเป็น SQL ที่เขียนไว้ในโค้ด ไม่มีอะไรตรวจว่าชื่อคอลัมน์ยังตรงกับ
 * ฐานข้อมูลอยู่ไหม การอ่านโค้ดแล้วเห็นว่า "มี key นี้อยู่" ไม่ได้แปลว่ารายงานทำงานได้
 * — รายงานสองฉบับเคยพังอยู่นานโดยไม่มีใครรู้ เพราะ LineNo เป็นคำสงวนของ SQL Server
 * และ wf.WeighTicket ไม่มีคอลัมน์ WeightIn/WeightOut อย่างที่คิด
 *
 * ตรวจสองอย่างต่อหนึ่งรายงาน
 *   1. GET /api/reports/:type          → ต้องได้ 200
 *   2. GET /api/reports/:type/export   → ต้องได้ 200 และไฟล์ต้องเป็น xlsx จริง
 *      (ตรวจ 2 ไบต์แรกว่าเป็น PK ซึ่งเป็นหัวไฟล์ zip ที่ xlsx ใช้)
 *
 * อ่านอย่างเดียว ไม่สร้างข้อมูลใด ๆ จึงไม่ต้องล้าง
 *
 *   node backend/scripts/verify-reports.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const API = process.env.WF_API || 'http://localhost:3000';
const PASSWORD = process.env.E2E_PASSWORD;
if (!PASSWORD) {
  // ไม่ใส่ค่าปริยายเป็นรหัสจริง — ที่เก็บซอร์สนี้เป็นสาธารณะ
  console.error('ต้องตั้ง E2E_PASSWORD ก่อนรัน (ใส่ใน backend/.env ซึ่งไม่ถูก commit)');
  process.exit(1);
}

let failed = 0;

async function login(username) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`เข้าระบบเป็น ${username} ไม่สำเร็จ (${r.status})`);
  return (await r.json()).accessToken;
}

const message = async (res) => {
  try { return (await res.json()).message || ''; } catch { return ''; }
};

(async () => {
  const token = await login('e2e_admin');
  const headers = { Authorization: `Bearer ${token}` };

  const types = await (await fetch(`${API}/api/reports/types`, { headers })).json();
  if (!Array.isArray(types) || !types.length) {
    console.error('ไม่พบรายการรายงานเลย'); process.exit(1);
  }
  console.log(`ตรวจรายงาน ${types.length} ฉบับ\n`);

  for (const { key, title } of types) {
    const label = `${key.padEnd(26)} ${String(title).slice(0, 30)}`;

    const run = await fetch(`${API}/api/reports/${key}`, { headers });
    if (!run.ok) {
      failed++;
      console.log(`  FAIL ${label}\n         เปิดรายงานไม่ได้ (${run.status}) ${await message(run)}`);
      continue;
    }
    const rowCount = ((await run.json()).rows || []).length;

    const exp = await fetch(`${API}/api/reports/${key}/export`, { headers });
    if (!exp.ok) {
      failed++;
      console.log(`  FAIL ${label}\n         export ไม่ได้ (${exp.status}) ${await message(exp)}`);
      continue;
    }
    const buf = Buffer.from(await exp.arrayBuffer());
    if (buf[0] !== 0x50 || buf[1] !== 0x4B) {
      failed++;
      console.log(`  FAIL ${label}\n         ไฟล์ที่ได้ไม่ใช่ xlsx (${exp.headers.get('content-type')})`);
      continue;
    }
    console.log(`  ok   ${label}  ${String(rowCount).padStart(4)} แถว · ${(buf.length / 1024).toFixed(0)} KB`);
  }

  console.log(failed ? `\nไม่ผ่าน ${failed} จาก ${types.length} ฉบับ` : `\nผ่านครบ ${types.length} ฉบับ`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\nข้อผิดพลาด:', e.message); process.exit(1); });
