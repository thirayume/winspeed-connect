'use strict';
/**
 * audit-duplicate-passwords.js — D6-01 / D6-02
 * ตรวจสอบบัญชีผู้ใช้ที่มี PasswordHash ซ้ำกันในระบบ และเพิ่ม flag MustChangePassword
 *
 * การใช้งาน:
 *   node backend/scripts/audit-duplicate-passwords.js           # สรุปบัญชีที่รหัสผ่านซ้ำกัน
 *   node backend/scripts/audit-duplicate-passwords.js --fix     # สร้างคอลัมน์ MustChangePassword และตั้งค่า = 1 สำหรับบัญชีที่ซ้ำ
 */

require('dotenv').config({ quiet: true });
const { sql, wfQuery, dboWrite } = require('../db');

async function ensureMustChangePasswordColumn() {
  await dboWrite(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'wf' AND TABLE_NAME = 'AppUser' AND COLUMN_NAME = 'MustChangePassword'
    )
    BEGIN
      ALTER TABLE wf.AppUser ADD MustChangePassword BIT NOT NULL DEFAULT 0;
      PRINT 'Added MustChangePassword column to wf.AppUser';
    END
  `);
}

async function main() {
  const isFixMode = process.argv.includes('--fix');

  console.log('=== ตรวจสอบบัญชีผู้ใช้ที่มีรหัสผ่านซ้ำกัน (Duplicate Password Audit) ===');

  const groupsRes = await wfQuery(`
    SELECT 
      PasswordHash,
      COUNT(*) AS Cnt,
      STRING_AGG(Username, ', ') AS Usernames,
      STRING_AGG(Role, ', ') AS Roles
    FROM wf.AppUser
    WHERE IsActive = 1 AND PasswordHash IS NOT NULL AND PasswordHash <> ''
    GROUP BY PasswordHash
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `);

  const groups = groupsRes.recordset || [];

  if (groups.length === 0) {
    console.log('✔ ไม่พบบัญชีที่ใช้ PasswordHash ซ้ำกัน');
    process.exit(0);
    return;
  }

  let totalDuplicateUsers = 0;
  console.log(`\nพบกลุ่มรหัสผ่านซ้ำทั้งหมด: ${groups.length} กลุ่ม`);
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    totalDuplicateUsers += g.Cnt;
    console.log(`  กลุ่มที่ ${i + 1}: ซ้ำ ${g.Cnt} บัญชี -> [${g.Usernames}] (${g.Roles})`);
  }
  console.log(`\nรวมบัญชีที่มีรหัสผ่านซ้ำกันทั้งสิ้น: ${totalDuplicateUsers} บัญชี`);

  if (isFixMode) {
    console.log('\n[MODE: --fix] กำลังเพิ่ม MustChangePassword และตั้งค่าเป็น 1 ให้กับบัญชีที่ใช้รหัสผ่านซ้ำ...');
    await ensureMustChangePasswordColumn();

    const updateRes = await dboWrite(`
      UPDATE wf.AppUser
      SET MustChangePassword = 1, UpdatedAt = GETUTCDATE()
      WHERE IsActive = 1
        AND PasswordHash IN (
          SELECT PasswordHash
          FROM wf.AppUser
          WHERE IsActive = 1 AND PasswordHash IS NOT NULL AND PasswordHash <> ''
          GROUP BY PasswordHash
          HAVING COUNT(*) > 1
        )
    `);

    const affected = Number(updateRes?.rowsAffected?.[0] || 0);
    console.log(`✔ ตั้งค่า MustChangePassword = 1 เรียบร้อยสำหรับ ${affected} บัญชี`);
  } else {
    console.log('\nคำแนะนำ: รัน "node backend/scripts/audit-duplicate-passwords.js --fix" เพื่อเปิด flag MustChangePassword = 1');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error in audit-duplicate-passwords:', err);
  process.exit(1);
});
