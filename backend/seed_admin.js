/**
 * seed_admin.js — สร้าง user เริ่มต้นใน wf.AppUser
 * รัน: node seed_admin.js
 * ⚠ เขียนเฉพาะ wf.AppUser (schema wf) — ไม่แตะ dbo
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { sql, wfQuery, ownerPool } = require('./db');

// user เริ่มต้น (เปลี่ยนรหัสผ่านหลัง login ครั้งแรก)
// empId = EMEmp.EmpID จริงของ WINSpeed (พนักงานขายเท่านั้นที่ต้อง map เพื่อ export SO)
const USERS = [
  { username: 'admin',       password: 'Admin@2026',     displayName: 'ผู้ดูแลระบบ',            role: 'ADMIN',      empId: null },
  { username: 'sales1',      password: 'Sales@2026',     displayName: 'ชูชาติ (พนักงานขาย)',    role: 'SALES',      empId: '4000' },
  { username: 'sales2',      password: 'Sales@2026',     displayName: 'มนัส (พนักงานขาย)',      role: 'SALES',      empId: '4001' },
  { username: 'surachai',    password: 'Approve@2026',   displayName: 'สุรชัย (อนุมัติปลดล็อก)', role: 'APPROVER',   empId: null },
  { username: 'warehouse1',  password: 'Whouse@2026',    displayName: 'พนักงานคลัง 1',          role: 'WAREHOUSE',  empId: null },
  { username: 'acct1',       password: 'Acct@2026',      displayName: 'บัญชี 1',                role: 'ACCOUNTING', empId: null },
];

async function seed() {
  for (const u of USERS) {
    const exists = await wfQuery(
      `SELECT Id FROM wf.AppUser WHERE Username = @u`,
      { u: { type: sql.NVarChar(50), value: u.username } }
    );
    if (exists.recordset.length) {
      // อัปเดต EmpId (map พนักงาน) สำหรับ user ที่มีอยู่แล้ว
      await wfQuery(
        `UPDATE wf.AppUser SET EmpId = @e, UpdatedAt = GETUTCDATE() WHERE Username = @u`,
        { e: { type: sql.NVarChar(20), value: u.empId }, u: { type: sql.NVarChar(50), value: u.username } }
      );
      console.log(`↻ ${u.username} มีอยู่แล้ว — อัปเดต EmpId=${u.empId ?? '(none)'}`);
      continue;
    }
    const hash = await bcrypt.hash(u.password, 12);
    await wfQuery(
      `INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId)
       VALUES (@u, @h, @d, @r, @e)`,
      {
        u: { type: sql.NVarChar(50),  value: u.username },
        h: { type: sql.NVarChar(255), value: hash },
        d: { type: sql.NVarChar(100), value: u.displayName },
        r: { type: sql.NVarChar(30),  value: u.role },
        e: { type: sql.NVarChar(20),  value: u.empId },
      }
    );
    console.log(`✓ สร้าง ${u.username} (${u.role}) EmpId=${u.empId ?? '(none)'} — รหัส: ${u.password}`);
  }
  await ownerPool.close();
  console.log('\n✓ Seed เสร็จสิ้น');
  process.exit(0);
}

seed().catch(e => { console.error('✗ Seed failed:', e); process.exit(1); });
