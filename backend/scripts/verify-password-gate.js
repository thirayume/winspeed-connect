#!/usr/bin/env node
/**
 * verify-password-gate.js — พิสูจน์ว่าการบังคับเปลี่ยนรหัสผ่าน (D6-02) ทำงานจริง
 *
 * ตรวจสิ่งที่ตัดสินใจไว้ ไม่ใช่ตรวจว่าโค้ดทำอะไร
 *   1. บัญชีที่ยังใช้รหัสผ่านตั้งต้น เขียนข้อมูลไม่ได้ (403 PASSWORD_CHANGE_REQUIRED)
 *   2. แต่ยังอ่านได้ตามปกติ — คนที่มีงานค้างต้องเปิดดูงานตัวเองได้
 *   3. /api/auth ไม่ถูกบล็อก มิฉะนั้นจะเปลี่ยนรหัสผ่านไม่ได้เลย
 *   4. เปลี่ยนรหัสผ่านแล้วเขียนได้ทันที ไม่ต้องรอ token เดิมหมดอายุ
 *   5. บัญชีทดสอบ e2e_* ไม่ถูกบล็อก ไม่งั้นชุด E2E ล้มทั้งชุด
 *
 * สร้างบัญชีของตัวเองและลบทิ้งทุกครั้ง ไม่แตะบัญชีจริง
 *
 *   node backend/scripts/verify-password-gate.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcrypt');
const { sql, wfQuery } = require('../db');

const API = process.env.E2E_API_BASE?.replace(/\/api$/, '') || 'http://localhost:3000';
const USERNAME = 'pwgate_probe';
const START_PASSWORD = '***REMOVED-PASSWORD***';
const NEW_PASSWORD = 'Ch4nged!' + Date.now();

let failures = 0;
const ok   = (m, extra = '') => console.log(`  ok   ${m}${extra ? ' · ' + extra : ''}`);
const bad  = (m, extra = '') => { failures++; console.log(`  ผิด  ${m}${extra ? ' · ' + extra : ''}`); };
const check = (cond, m, extra) => (cond ? ok(m, extra) : bad(m, extra));

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* บาง endpoint ไม่คืน JSON */ }
  return { status: res.status, json };
}

async function login(username, password) {
  const r = await call('/api/auth/login', { method: 'POST', body: { username, password } });
  return r.json?.accessToken || null;
}

async function cleanup() {
  await wfQuery(`DELETE FROM wf.AppUser WHERE Username = @u`,
    { u: { type: sql.NVarChar(100), value: USERNAME } });
}

const ENFORCED = String(process.env.ENFORCE_PASSWORD_CHANGE || '').toLowerCase() === 'true';

(async () => {
  console.log('ตรวจการบังคับเปลี่ยนรหัสผ่าน (D6-02)');
  console.log(ENFORCED
    ? '  โหมด: บังคับ (ENFORCE_PASSWORD_CHANGE=true) — ตรวจว่าบล็อกการเขียนจริง\n'
    : '  โหมด: ไม่บังคับ (ค่าปริยายของเครื่องนักพัฒนา) — ตรวจว่าไม่ไปกีดขวางการทำงาน\n');

  await cleanup();
  const hash = await bcrypt.hash(START_PASSWORD, 12);
  const empId = (await wfQuery(`SELECT TOP 1 EmpId FROM wf.AppUser WHERE EmpId IS NOT NULL`)).recordset?.[0]?.EmpId || null;
  await wfQuery(
    `INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId, IsActive, MustChangePassword)
     VALUES (@u, @p, N'บัญชีตรวจการบังคับเปลี่ยนรหัส', 'SALES', @e, 1, 1)`,
    { u: { type: sql.NVarChar(100), value: USERNAME },
      p: { type: sql.NVarChar(255), value: hash },
      e: { type: sql.NVarChar(50),  value: empId } });

  try {
    const token = await login(USERNAME, START_PASSWORD);
    check(Boolean(token), 'เข้าระบบได้ทั้งที่ยังไม่เปลี่ยนรหัส (ไม่ล็อกออก)');
    if (!token) throw new Error('เข้าระบบไม่สำเร็จ ตรวจต่อไม่ได้');

    const me = await call('/api/auth/me', { token });
    check(me.status === 200 && me.json?.mustChangePassword === ENFORCED,
      ENFORCED ? 'ระบบบอกหน้าจอว่าบัญชีนี้ต้องเปลี่ยนรหัส (จะขึ้นหน้าบังคับ)'
               : 'ระบบไม่สั่งหน้าจอให้บังคับเปลี่ยนรหัส (โหมดไม่บังคับ)',
      `mustChangePassword=${me.json?.mustChangePassword}`);

    // 1 · เขียนได้หรือไม่ ตามโหมดที่ตั้งไว้
    const write = await call('/api/so', { method: 'POST', token, body: {} });
    const del = await call('/api/rebate/claims/999999999', { method: 'DELETE', token });
    if (ENFORCED) {
      check(write.status === 403 && write.json?.code === 'PASSWORD_CHANGE_REQUIRED',
        'คำสั่งเขียนถูกบล็อกด้วย 403 PASSWORD_CHANGE_REQUIRED', `ได้ ${write.status} ${write.json?.code || ''}`);
      check(del.status === 403 && del.json?.code === 'PASSWORD_CHANGE_REQUIRED',
        'DELETE ก็ถูกบล็อกเช่นกัน', `ได้ ${del.status}`);
    } else {
      check(write.json?.code !== 'PASSWORD_CHANGE_REQUIRED',
        'ไม่บล็อกการเขียนบนเครื่องที่ไม่ได้เปิดบังคับ', `ได้ ${write.status}`);
      check(del.json?.code !== 'PASSWORD_CHANGE_REQUIRED',
        'DELETE ก็ไม่ถูกบล็อกเช่นกัน', `ได้ ${del.status}`);
    }

    // 2 · อ่านได้
    const read = await call('/api/so?limit=1', { token });
    check(read.status === 200, 'ยังอ่านข้อมูลได้ตามปกติ', `ได้ ${read.status}`);

    // 3 · /api/auth ไม่ถูกบล็อก — ถ้าบล็อกจะเปลี่ยนรหัสไม่ได้เลย
    const wrongOld = await call('/api/auth/profile/password', {
      method: 'PUT', token, body: { oldPassword: 'ผิดแน่นอน', newPassword: NEW_PASSWORD } });
    check(wrongOld.status === 401,
      'เส้นทาง /api/auth ไม่ถูกบล็อก (รหัสเดิมผิดจึงได้ 401 ไม่ใช่ 403)', `ได้ ${wrongOld.status}`);

    // 4 · เปลี่ยนรหัสแล้วเขียนได้ทันทีด้วย token ใหม่
    const changed = await call('/api/auth/profile/password', {
      method: 'PUT', token, body: { oldPassword: START_PASSWORD, newPassword: NEW_PASSWORD } });
    check(changed.status === 200 && Boolean(changed.json?.accessToken),
      'เปลี่ยนรหัสผ่านสำเร็จและได้ token ใหม่กลับมา', `ได้ ${changed.status}`);

    const flag = (await wfQuery(`SELECT MustChangePassword FROM wf.AppUser WHERE Username=@u`,
      { u: { type: sql.NVarChar(100), value: USERNAME } })).recordset[0];
    check(Number(flag?.MustChangePassword) === 0, 'ธงในฐานข้อมูลถูกล้างเป็น 0');

    const freshToken = changed.json?.accessToken;
    const afterWrite = await call('/api/so', { method: 'POST', token: freshToken, body: {} });
    check(afterWrite.json?.code !== 'PASSWORD_CHANGE_REQUIRED',
      'token ใหม่เขียนได้แล้ว ไม่ต้องรอ token เดิมหมดอายุ',
      `ได้ ${afterWrite.status} (400 = ผ่านด่านนี้แล้ว ติดที่ข้อมูลว่าง ซึ่งถูกต้อง)`);

    if (ENFORCED) {
      const staleWrite = await call('/api/so', { method: 'POST', token, body: {} });
      check(staleWrite.status === 403,
        'token เดิมยังถูกบล็อกอยู่ตามที่ควรเป็น (ต้องใช้ใบใหม่)', `ได้ ${staleWrite.status}`);
    }

    // ผู้ดูแลตั้งรหัสให้คนอื่น ต้องบังคับให้เจ้าของบัญชีตั้งใหม่เอง
    const adminToken = await login('e2e_admin', '***REMOVED-PASSWORD***');
    const probeId = (await wfQuery(`SELECT Id FROM wf.AppUser WHERE Username=@u`,
      { u: { type: sql.NVarChar(100), value: USERNAME } })).recordset[0]?.Id;
    if (adminToken && probeId) {
      const reset = await call(`/api/auth/users/${probeId}`, {
        method: 'PATCH', token: adminToken, body: { password: 'Adm1nSet!' + Date.now() } });
      const after = (await wfQuery(`SELECT MustChangePassword FROM wf.AppUser WHERE Id=@id`,
        { id: { type: sql.Int, value: probeId } })).recordset[0];
      check(reset.status === 200 && Number(after?.MustChangePassword) === 1,
        'ผู้ดูแลรีเซ็ตรหัสให้คนอื่น แล้วธงถูกตั้งกลับเป็น 1 อัตโนมัติ',
        `สถานะ ${reset.status} · ธง=${after?.MustChangePassword}`);
    } else {
      bad('ทดสอบการรีเซ็ตรหัสโดยผู้ดูแลไม่ได้ (ไม่พบบัญชี e2e_admin)');
    }

    // 5 · บัญชีทดสอบต้องไม่ถูกบล็อก
    const e2eFlag = (await wfQuery(
      `SELECT COUNT(*) AS n FROM wf.AppUser WHERE Username LIKE 'e2e[_]%' AND MustChangePassword = 1`)).recordset[0];
    check(Number(e2eFlag.n) === 0, 'บัญชีทดสอบ e2e_* ไม่ถูกตั้งธง ชุด E2E จึงยังรันได้',
      `พบที่ยังตั้งธง ${e2eFlag.n} บัญชี`);
  } finally {
    await cleanup();
    console.log('\nล้างบัญชีทดสอบแล้ว');
  }

  console.log(failures ? `\nไม่ผ่าน ${failures} ข้อ` : '\nผ่านทุกข้อ');
  process.exit(failures ? 1 : 0);
})().catch(async (e) => {
  console.error('\nข้อผิดพลาด:', e.message);
  await cleanup().catch(() => {});
  process.exit(1);
});
