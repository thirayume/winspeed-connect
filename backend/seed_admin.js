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
  { username: 'admin',       password: 'W0rldF3rt',     displayName: 'ผู้ดูแลระบบ',            role: 'ADMIN',      empId: null }
];

async function seed() {
  console.log('Fetching active employees from WINSpeed...');
  try {
    const empRes = await wfQuery(`
      SELECT EmpID, EmpCode, EmpName, DeptID, EmpGroupID 
      FROM dbo.EMEmp 
      WHERE EmpResignDate IS NULL
    `);
    const empsFromDb = empRes.recordset || [];
    console.log(`Found ${empsFromDb.length} active employees.`);
    
    for (const e of empsFromDb) {
      const username = (e.EmpCode || `emp-${e.EmpID}`).toLowerCase().trim();
      
      let role = 'SALES'; // Default
      const g = String(e.EmpGroupID).trim();
      const d = String(e.DeptID).trim();
      const eId = String(e.EmpID).trim();
      
      if (g === '2000' || ['1018', '9005', '8008'].includes(eId) || e.EmpCode === 'EMP-00012' || e.EmpCode === 'EMP-00059' || e.EmpCode === 'EMP-00008') {
        role = 'MANAGER';
      } else if (g === '2001' || d === '2004' || d === '2005') {
        role = 'WAREHOUSE';
      } else if (d === '2000' || d === '2001') {
        role = 'ACCOUNTING';
      }
      
      USERS.push({
        username,
        password: 'W0rldF3rt',
        displayName: e.EmpName,
        role,
        empId: String(e.EmpID)
      });
    }
  } catch (e) {
    console.warn('Could not fetch employees from DB.', e.message);
  }

  const defaultPasswordHash = await bcrypt.hash('W0rldF3rt', 12);

  for (const u of USERS) {
    const hash = u.password === 'W0rldF3rt' ? defaultPasswordHash : await bcrypt.hash(u.password, 12);
    
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
      await wfQuery(
        `UPDATE wf.AppUser 
         SET Username = @u, PasswordHash = @h, DisplayName = @d, Role = @r, EmpId = @e, UpdatedAt = GETUTCDATE() 
         WHERE Id = @id`,
        {
          id: { type: sql.Int, value: targetId },
          u: { type: sql.NVarChar(50),  value: u.username },
          h: { type: sql.NVarChar(255), value: hash },
          d: { type: sql.NVarChar(100), value: u.displayName },
          r: { type: sql.NVarChar(30),  value: u.role },
          e: { type: sql.NVarChar(20),  value: u.empId },
        }
      );
      console.log(`↻ อัปเดต ${u.username} (${u.role}) EmpId=${u.empId ?? '(none)'}`);
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
  process.exit(0);
}

seed().catch(e => { console.error('✗ Seed failed:', e); process.exit(1); });
