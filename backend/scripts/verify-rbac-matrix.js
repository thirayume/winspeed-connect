'use strict';
/**
 * verify-rbac-matrix.js — ตรวจสิทธิ์ตามบทบาทด้วยการ "ยิง API จริง" ไม่ใช่การอ่านโค้ด
 *
 * ทำไมต้องยิงจริง: requireRole() ในโค้ดบอกได้แค่ว่าตั้งใจให้ใครเข้าได้ แต่บอกไม่ได้ว่า
 * middleware ลำดับก่อนหน้า (auth, context, object authorization) จะตัดสิทธิ์ก่อนหรือไม่
 * ข้อบกพร่องสิทธิ์ที่เคยเจอในโปรเจกต์นี้ ล้วนหาไม่เจอจากการอ่านโค้ดอย่างเดียว
 *
 * เกณฑ์ตัดสิน — สนใจเฉพาะ "ถูกปฏิเสธเพราะสิทธิ์" เท่านั้น
 *   allow : ต้องไม่ได้ 401/403  (400/404/409/422 ถือว่าผ่านด่านสิทธิ์แล้ว ติดที่ข้อมูลทดสอบ)
 *   deny  : ต้องได้ 403
 *
 * ใช้ payload ที่ตั้งใจให้ไม่ผ่าน validation และอ้าง id ที่ไม่มีจริง เพื่อไม่ให้เกิดผลข้างเคียง
 * กับฐานข้อมูล การทดสอบนี้จึงไม่สร้างข้อมูลค้างและไม่ต้องมีขั้นตอนล้างข้อมูล
 *
 *   node backend/scripts/verify-rbac-matrix.js
 *   WF_API=http://localhost:3000 node backend/scripts/verify-rbac-matrix.js
 */

const API = process.env.WF_API || 'http://localhost:3000';
const PASSWORD = process.env.E2E_PASSWORD;
if (!PASSWORD) {
  // ไม่ใส่ค่าปริยายเป็นรหัสจริง — ที่เก็บซอร์สนี้เป็นสาธารณะ
  console.error('ต้องตั้ง E2E_PASSWORD ก่อนรัน (ใส่ใน backend/.env ซึ่งไม่ถูก commit)');
  process.exit(1);
}
const GHOST = 999999999;   // id ที่ไม่มีจริง ใช้กันผลข้างเคียง

// ความคาดหวังมาจากการตัดสินใจของเจ้าของระบบ ไม่ใช่จากการอ่านโค้ด
// (มิฉะนั้นการทดสอบจะเห็นด้วยกับโค้ดเสมอ แม้โค้ดจะผิด)
const CASES = [
  // WEIGHBRIDGE — ทำได้ถึงชั่งออก/ส่งของ และงานเครื่องชั่ง
  { role: 'WEIGHBRIDGE', expect: 'allow', name: 'ชั่งออก/ส่งของ',        method: 'PATCH', path: `/api/so/${GHOST}/ship`, body: {} },
  { role: 'WEIGHBRIDGE', expect: 'allow', name: 'บันทึกน้ำหนักรายรายการ', method: 'POST',  path: `/api/so/${GHOST}/weigh-item`, body: {} },
  { role: 'WEIGHBRIDGE', expect: 'allow', name: 'sync TruckScale',       method: 'POST',  path: '/api/truckscale/sync/run', body: {} },
  { role: 'WEIGHBRIDGE', expect: 'allow', name: 'จับคู่ Weigh Inbox',     method: 'POST',  path: `/api/truckscale/inbox/${GHOST}/match/${GHOST}`, body: {} },
  // WEIGHBRIDGE — ห้ามทำงานคลัง
  { role: 'WEIGHBRIDGE', expect: 'deny',  name: 'จัดของ (picking)',       method: 'PATCH', path: `/api/so/${GHOST}/picking`, body: {} },
  { role: 'WEIGHBRIDGE', expect: 'deny',  name: 'ขึ้นของ (load)',         method: 'PATCH', path: `/api/so/${GHOST}/load`, body: {} },
  // WEIGHBRIDGE — ห้ามงานเงินและงานระบบ
  // เดิมเคสนี้ยิง PATCH ซึ่งไม่มี route รองรับตั้งแต่ตอนทำอนุมัติ 4 ชั้น (route เปลี่ยนเป็น POST
  // และย้ายการตรวจสิทธิ์เข้าไปตรวจรายชั้นข้างใน) จึงได้ 404 ของ Express ทุกครั้งโดยไม่เคยแตะโค้ดจริง
  // — เป็นการทดสอบที่เขียวปลอมมาตลอด
  //
  // เมื่อยิง POST ด้วยรหัสใบที่ไม่มีจริง ทุกบทบาทจะได้ 404 เหมือนกันหมด เพราะ handler
  // หาใบก่อนแล้วค่อยตรวจสิทธิ์รายชั้น เคสนี้จึงพิสูจน์การปฏิเสธตามบทบาทไม่ได้ด้วยรหัสผี
  // การปฏิเสธจริงพิสูจน์ใน verify-rebate-4tier.js ซึ่งใช้ใบจริง
  { role: 'WEIGHBRIDGE', expect: 'allow', name: 'อนุมัติเคลมรีเบท (ดูหมายเหตุ)', method: 'POST', path: `/api/rebate/claims/${GHOST}/approve`, body: {} },
  { role: 'WEIGHBRIDGE', expect: 'deny',  name: 'แก้ไขนโยบายอนุมัติ',     method: 'POST',  path: '/api/policy', body: {} },

  // WAREHOUSE — ยังทำงานคลังได้ครบเหมือนเดิม (กันการแก้สิทธิ์ WEIGHBRIDGE ไปกระทบของเดิม)
  { role: 'WAREHOUSE',   expect: 'allow', name: 'จัดของ (picking)',       method: 'PATCH', path: `/api/so/${GHOST}/picking`, body: {} },
  { role: 'WAREHOUSE',   expect: 'allow', name: 'ขึ้นของ (load)',         method: 'PATCH', path: `/api/so/${GHOST}/load`, body: {} },
  { role: 'WAREHOUSE',   expect: 'allow', name: 'ชั่งออก/ส่งของ',        method: 'PATCH', path: `/api/so/${GHOST}/ship`, body: {} },

  // C_LEVEL — สิทธิ์ธุรกิจเต็ม
  { role: 'C_LEVEL',     expect: 'allow', name: 'แก้ไขนโยบายอนุมัติ',     method: 'POST',  path: '/api/policy', body: {} },
  { role: 'C_LEVEL',     expect: 'allow', name: 'อนุมัติเคลมรีเบท',       method: 'POST',  path: `/api/rebate/claims/${GHOST}/approve`, body: {} },

  // SALES — ห้ามข้ามไปทำงานคลังและงานอนุมัติ
  { role: 'SALES',       expect: 'deny',  name: 'จัดของ (picking)',       method: 'PATCH', path: `/api/so/${GHOST}/picking`, body: {} },
  { role: 'SALES',       expect: 'deny',  name: 'ชั่งออก/ส่งของ',        method: 'PATCH', path: `/api/so/${GHOST}/ship`, body: {} },
  { role: 'SALES',       expect: 'deny',  name: 'แก้ไขนโยบายอนุมัติ',     method: 'POST',  path: '/api/policy', body: {} },

  // COUNTER_SALES — ตรวจซ้ำได้ แต่ไม่ใช่ผู้ปิดน้ำหนัก
  { role: 'COUNTER_SALES', expect: 'allow', name: 'จับคู่ Weigh Inbox',   method: 'POST',  path: `/api/truckscale/inbox/${GHOST}/match/${GHOST}`, body: {} },
  { role: 'COUNTER_SALES', expect: 'deny',  name: 'ชั่งออก/ส่งของ',       method: 'PATCH', path: `/api/so/${GHOST}/ship`, body: {} },

  // APPROVER — อนุมัติปลดล็อกได้ แต่ไม่ใช่ผู้ปฏิบัติงาน
  { role: 'APPROVER',    expect: 'allow', name: 'ดูคำขอปลดล็อก',         method: 'GET',   path: '/api/so/unlock-requests' },
  { role: 'APPROVER',    expect: 'deny',  name: 'จัดของ (picking)',       method: 'PATCH', path: `/api/so/${GHOST}/picking`, body: {} },

  // ACCOUNTING — งานเงิน ไม่ใช่งานคลัง
  { role: 'ACCOUNTING',  expect: 'allow', name: 'อนุมัติเคลมรีเบท',       method: 'PATCH', path: `/api/rebate/claims/${GHOST}/approve`, body: {} },
  { role: 'ACCOUNTING',  expect: 'deny',  name: 'ขึ้นของ (load)',         method: 'PATCH', path: `/api/so/${GHOST}/load`, body: {} },

  // MANAGER — ตรวจซ้ำได้ แต่ไม่ใช่ผู้ปฏิบัติงานคลัง
  { role: 'MANAGER',     expect: 'allow', name: 'ตรวจซ้ำใบสั่งขาย',       method: 'PATCH', path: `/api/so/${GHOST}/verify`, body: {} },
  { role: 'MANAGER',     expect: 'deny',  name: 'จัดของ (picking)',       method: 'PATCH', path: `/api/so/${GHOST}/picking`, body: {} },
];

const USERNAME = {
  ADMIN: 'e2e_admin', SALES: 'e2e_sales', COUNTER_SALES: 'e2e_counter',
  WAREHOUSE: 'e2e_warehouse', MANAGER: 'e2e_manager', APPROVER: 'e2e_approver',
  ACCOUNTING: 'e2e_accounting', WEIGHBRIDGE: 'e2e_weighbridge', C_LEVEL: 'e2e_clevel',
};

async function login(role) {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME[role], password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`เข้าระบบเป็น ${role} ไม่สำเร็จ (${response.status})`);
  const data = await response.json();
  const token = data.token || data.accessToken || data?.data?.token;
  if (!token) throw new Error(`ไม่พบ token ในคำตอบของ ${role}`);
  return token;
}

async function main() {
  const tokens = new Map();
  for (const role of new Set(CASES.map(c => c.role))) tokens.set(role, await login(role));

  let failed = 0;
  let currentRole = null;
  for (const testCase of CASES) {
    if (testCase.role !== currentRole) { currentRole = testCase.role; console.log(`\n${currentRole}`); }

    const response = await fetch(API + testCase.path, {
      method: testCase.method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.get(testCase.role)}` },
      body: testCase.body === undefined ? undefined : JSON.stringify(testCase.body),
    });
    const status = response.status;
    const blocked = status === 401 || status === 403;
    const ok = testCase.expect === 'allow' ? !blocked : status === 403;

    if (!ok) failed++;
    const verdict = ok ? 'ok  ' : 'FAIL';
    const wanted = testCase.expect === 'allow' ? 'ต้องผ่านด่านสิทธิ์' : 'ต้องถูกปฏิเสธ 403';
    console.log(`  ${verdict} ${testCase.name.padEnd(26)} ${testCase.method.padEnd(6)} ${String(status).padEnd(4)} (${wanted})`);
  }

  console.log(failed
    ? `\n${failed} จาก ${CASES.length} กรณีไม่เป็นไปตามที่กำหนด`
    : `\nสิทธิ์ถูกต้องครบ ${CASES.length} กรณี`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
