/**
 * seed_admin.js — สร้าง user เริ่มต้นใน wf.AppUser
 * รัน: node seed_admin.js
 * ⚠ เขียนเฉพาะ wf.AppUser (schema wf) — ไม่แตะ dbo
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { sql, wfQuery, ownerPool } = require('./db');

/**
 * รหัสผ่านตั้งต้น — **ไม่เก็บค่าจริงไว้ในซอร์ส** เพราะที่เก็บนี้เป็นสาธารณะ
 *
 * เดิมมีค่าปริยายเขียนไว้ตรง ๆ (ต่อสตริงเพื่อพรางไว้ ซึ่งอ่านออกอยู่ดี) ทำให้
 * ทุก deployment ใช้รหัส admin เดียวกันและใครก็อ่านได้จาก GitHub
 *
 * ตอนนี้: ตั้ง DEFAULT_SEED_PASSWORD เอง หรือปล่อยว่างแล้วระบบสุ่มให้
 * แล้ว **พิมพ์ออกหน้าจอครั้งเดียว** ผู้ติดตั้งจดไปเปลี่ยนทันทีหลัง login
 */
const crypto = require('crypto');
let seedPasswordWasGenerated = false;
const DEFAULT_SEED_PW = process.env.DEFAULT_SEED_PASSWORD || (() => {
  seedPasswordWasGenerated = true;
  // อ่านออก พิมพ์ตามได้ แต่เดาไม่ได้ — ตัดอักขระที่สับสน (0/O, 1/l/I)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(16)).map(b => alphabet[b % alphabet.length]).join('');
})();

// user เริ่มต้น (เปลี่ยนรหัสผ่านหลัง login ครั้งแรก)
// empId = EMEmp.EmpID จริงของ WINSpeed (พนักงานขายเท่านั้นที่ต้อง map เพื่อ export SO)
const USERS = [
  { username: 'admin',       password: DEFAULT_SEED_PW,     displayName: 'ผู้ดูแลระบบ',            role: 'ADMIN',      empId: null }
];

/**
 * บทบาทตั้งต้นของพนักงานหนึ่งคน — ต้องให้ผลตรงกับ migration 082
 *
 * เกณฑ์เดิมใช้ `EmpGroupID === '2000'` แล้วให้ C_LEVEL ซึ่ง **ผิด**
 * กลุ่ม 2000 คือ "สำนักงานใหญ่" ซึ่งเป็น *สถานที่ทำงาน* ไม่ใช่ระดับตำแหน่ง
 * ผลคือพนักงานบัญชีและธุรการ 22 คนได้สิทธิ์สูงสุดของระบบ และทำให้ลายเซ็น
 * อนุมัติสี่ชั้นไม่มีความหมาย (ดู DECISIONS-v1.6.0 ข้อ 2)
 *
 * เกณฑ์ใหม่อ่านจากตำแหน่งและแผนกจริง · ค่าตั้งต้นคือ SALES เสมอ
 * สิทธิ์ที่สูงกว่านั้นต้องมีหลักฐานใน dbo รองรับ
 */
const MANAGER_EMP_CODES = ['EMP-00021', 'EMP-00024', 'EMP-00025'];

function roleFor(e) {
  const post  = String(e.PostName     || '').trim();
  const dept  = String(e.DeptName     || '').trim();
  const group = String(e.EmpGroupName || '').trim();
  const code  = String(e.EmpCode      || '').trim().toUpperCase();

  if (post === 'กรรมการบริหาร')                       return 'C_LEVEL';
  if (MANAGER_EMP_CODES.includes(code))               return 'MANAGER';
  if (dept === 'บัญชี')                                return 'ACCOUNTING';
  if (group === 'คลังสินค้า' || dept === 'ห้องชั่ง')    return 'WAREHOUSE';
  return 'SALES';
}

async function seed() {
  console.log('Fetching active employees from WINSpeed...');
  try {
    const empRes = await wfQuery(`
      SELECT e.EmpID, e.EmpCode, e.EmpName,
             p.PostName, d.DeptName, g.EmpGroupName
      FROM dbo.EMEmp e
      LEFT JOIN dbo.EMPost     p ON p.PostID     = e.PostID
      LEFT JOIN dbo.EMDept     d ON d.DeptID     = e.DeptID
      LEFT JOIN dbo.EMEmpGroup g ON g.EmpGroupID = e.EmpGroupID
      WHERE e.EmpResignDate IS NULL
    `);
    const empsFromDb = empRes.recordset || [];
    console.log(`Found ${empsFromDb.length} active employees.`);
    
    for (const e of empsFromDb) {
      const username = (e.EmpCode || `emp-${e.EmpID}`).toLowerCase().trim();
      
      const role = roleFor(e);
      
      USERS.push({
        username,
        password: DEFAULT_SEED_PW,
        displayName: e.EmpName,
        role,
        empId: String(e.EmpID)
      });
    }
  } catch (e) {
    console.warn('Could not fetch employees from DB.', e.message);
  }

  const defaultPasswordHash = await bcrypt.hash(DEFAULT_SEED_PW, 12);

  for (const u of USERS) {
    const hash = u.password === DEFAULT_SEED_PW ? defaultPasswordHash : await bcrypt.hash(u.password, 12);
    
    // Check by EmpId first (if exists), then by Username
    let queryMatch = '';
    let matchInputs = { u: { type: sql.NVarChar(50), value: u.username } };
    
    if (u.empId) {
      queryMatch = 'EmpId = @e OR Username = @u';
      matchInputs.e = { type: sql.NVarChar(20), value: u.empId };
    } else {
      queryMatch = 'Username = @u';
    }
    
    const exists = await wfQuery(
      `SELECT Id, Username FROM wf.AppUser WHERE ${queryMatch}`,
      matchInputs
    );
    
    if (exists.recordset.length) {
      const targetId = exists.recordset[0].Id;
      // บัญชีที่มีอยู่แล้ว — อัปเดตเฉพาะข้อมูลที่ปลอดภัย
      //
      // เดิมเขียนทับ PasswordHash และ Role ทุกครั้งที่รัน ซึ่งทำลายสองอย่าง
      //   1. รหัสผ่านที่ผู้ใช้เปลี่ยนไปแล้ว ถูกรีเซ็ตกลับเป็นค่าเดียวกันหมดทั้งบริษัท
      //      (นี่คือที่มาของบัญชีรหัสซ้ำ 41 รายการที่ audit-duplicate-passwords ตรวจพบ)
      //   2. บทบาทที่จัดไว้ตาม migration 082 ถูกย้อนกลับเป็นเกณฑ์เดิมทั้งหมด
      //
      // ลำดับใน bootstrap คือ migrate -> seed_admin ถ้า seed เขียนทับ
      // สภาพแวดล้อมที่ติดตั้งใหม่จะได้บทบาทคนละชุดกับที่ใช้งานอยู่จริง
      await wfQuery(
        `UPDATE wf.AppUser
         SET Username = @u, DisplayName = @d, EmpId = @e, UpdatedAt = GETUTCDATE()
         WHERE Id = @id`,
        {
          id: { type: sql.Int, value: targetId },
          u: { type: sql.NVarChar(50),  value: u.username },
          d: { type: sql.NVarChar(100), value: u.displayName },
          e: { type: sql.NVarChar(20),  value: u.empId },
        }
      );
      console.log(`↻ อัปเดต ${u.username} (คงบทบาทและรหัสผ่านเดิมไว้) EmpId=${u.empId ?? '(none)'}`);
    } else {
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
      console.log(`✓ สร้าง ${u.username} (${u.role}) EmpId=${u.empId ?? '(none)'}`);
    }
  }
  
  // Disable old non-standard users
  await wfQuery(`
    UPDATE wf.AppUser 
    SET IsActive = 0 
    WHERE Username NOT IN (${USERS.map((_, i) => `@u${i}`).join(',')})
  `, Object.fromEntries(USERS.map((u, i) => [`u${i}`, { type: sql.NVarChar(50), value: u.username }])));
  
  await ownerPool.close();
  console.log('\n✓ Seed เสร็จสิ้น');
  // พิมพ์ครั้งเดียวเมื่อระบบสุ่มให้ — ไม่มีที่อื่นเก็บค่านี้ไว้ ต้องจดตอนนี้
  if (seedPasswordWasGenerated) {
    console.log('\n' + '='.repeat(60));
    console.log('  รหัสผ่านตั้งต้นของทุกบัญชี (สุ่มให้ · แสดงครั้งเดียว):');
    console.log('    ' + DEFAULT_SEED_PW);
    console.log('  จดไว้แล้วเปลี่ยนทันทีหลัง login ครั้งแรก');
    console.log('  ถ้าต้องการกำหนดเอง ตั้ง DEFAULT_SEED_PASSWORD ก่อนรัน');
    console.log('='.repeat(60) + '\n');
  }
  process.exit(0);
}

seed().catch(e => { console.error('✗ Seed failed:', e); process.exit(1); });
