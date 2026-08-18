-- =============================================================
-- 083_warehouse_group_role.sql
--
-- ทำให้สภาพแวดล้อมที่ใช้งานอยู่ตรงกับสภาพแวดล้อมที่ติดตั้งใหม่
--
-- ที่มา
--   migration 082 จัดบทบาทตามตำแหน่งงานจริง แต่ตัดสินจาก dbo.EMPost / dbo.EMDept
--   ซึ่งพนักงานส่วนใหญ่ไม่ได้กรอกไว้ บัญชีที่ไม่มีหลักฐานจึงตกไปเป็น SALES ทั้งหมด
--
--   ต่อมาแก้ seed_admin.js ให้ใช้เกณฑ์ชุดเดียวกัน และเพิ่มสัญญาณอีกหนึ่งตัวคือ
--   EMEmpGroup 'คลังสินค้า' ซึ่งบอกได้ว่าเป็นพนักงานคลัง
--
--   ผลคือเครื่องที่ติดตั้งใหม่ (Docker/on-prem ที่รัน bootstrap.sh) จะได้
--   WAREHOUSE 7 คน ส่วนเครื่องที่ผ่าน 082 มาแล้วได้ 6 คน — ต่างกันหนึ่งบัญชี
--
--   ความต่างนี้เล็กแต่ต้องปิด เพราะเป้าหมายคือ local / remote / remote_b / docker
--   ต้องเหมือนกันทุกประการ ไม่งั้นผลการทดสอบบนเครื่องหนึ่งไม่ยืนยันอีกเครื่อง
--
-- ไม่แตะ schema dbo — อ่านอย่างเดียว
-- =============================================================

UPDATE u
SET u.Role = 'WAREHOUSE', u.UpdatedAt = GETUTCDATE()
FROM wf.AppUser u
JOIN dbo.EMEmp e     ON RTRIM(CONVERT(NVARCHAR(20), e.EmpID)) = RTRIM(u.EmpId)
JOIN dbo.EMEmpGroup g ON g.EmpGroupID = e.EmpGroupID
LEFT JOIN dbo.EMPost p ON p.PostID = e.PostID
LEFT JOIN dbo.EMDept d ON d.DeptID = e.DeptID
WHERE RTRIM(g.EmpGroupName) = N'คลังสินค้า'
  AND u.Role = 'SALES'
  -- ต้องไม่แย่งบัญชีที่มีหลักฐานชัดกว่าไปจากบทบาทที่ถูกต้องแล้ว
  AND ISNULL(RTRIM(p.PostName), '') <> N'กรรมการบริหาร'
  AND ISNULL(RTRIM(d.DeptName), '') <> N'บัญชี'
  AND u.Username NOT IN ('emp-00021', 'emp-00024', 'emp-00025');
GO

PRINT '✓ WF migration 083 complete (warehouse group aligned with fresh-install seeding)'
GO
