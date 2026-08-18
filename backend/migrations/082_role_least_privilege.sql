-- =============================================================
-- 082_role_least_privilege.sql
--
-- ทำให้ลายเซ็น 4 ชั้นมีความหมายจริง — จัดบทบาทให้ตรงกับตำแหน่งงาน
--
-- ที่มา
--   DECISIONS-v1.6.0 ข้อ 2 เลือกทางเลือก 2ก (บีบชั้น 3 ให้เหลือกรรมการบริหาร)
--   แต่ตรวจฐานจริงเมื่อ 15 ส.ค. 2569 พบว่าแก้โค้ดอย่างเดียวจะไม่เกิดผลใด ๆ
--   เพราะ `C_LEVEL` ถูกแจกให้ 20 บัญชี ทั้งที่กรรมการบริหารมีสองคน
--
--       บทบาทที่มีจริงในฐาน   SALES 32 · C_LEVEL 23 · WAREHOUSE 6 · ADMIN 2
--       บทบาทที่โค้ดอ้างถึง    MANAGER 0 · APPROVER 0 · MARKETING 0
--
--   ผลคือชั้น 2 ชั้น 3 ชั้น 4 รับคนกลุ่มเดียวกันทั้งหมด 22 คน
--
-- เกณฑ์ที่ใช้ตัดสิน — จากข้อมูลใน dbo ไม่ใช่การเดา
--   กรรมการบริหาร     dbo.EMPost.PostName = 'กรรมการบริหาร'          -> C_LEVEL
--   ผู้จัดการภาค       ตามที่ DECISIONS-v1.6.0 ข้อ 1 ระบุไว้            -> MANAGER
--   ฝ่ายบัญชี         dbo.EMDept.DeptName = 'บัญชี'                  -> ACCOUNTING
--   ออกใบสั่งขายจริง   มีแถวใน dbo.SOHD ที่ EmpID ตรงกับบัญชีนั้น       -> SALES
--   ไม่มีหลักฐานใด ๆ   ไม่เคยออกเอกสาร ไม่มีตำแหน่ง ไม่มีแผนก           -> SALES
--
--   บัญชีกลุ่มสุดท้ายลดสิทธิ์ลงเสมอ ไม่เคยเพิ่ม — สิทธิ์สูงสุดต้องมีหลักฐานรองรับ
--   ถ้าภายหลังพบว่าคนใดควรได้บทบาทอื่น แก้จากหน้าจอจัดการผู้ใช้ได้ทันที
--
-- อ้างอิงด้วย Username ไม่ใช่ Id เพราะ Id เป็น IDENTITY ที่ต่างกันได้ในแต่ละปลายทาง
-- ไม่แตะ schema dbo — อ่านอย่างเดียว
-- =============================================================

-- 1. กรรมการบริหารสองคน — ชั้นที่ 3 และ 4
UPDATE wf.AppUser SET Role = 'C_LEVEL', UpdatedAt = GETUTCDATE()
WHERE Username IN ('emp-00016', 'emp-00059') AND Role <> 'C_LEVEL';
GO

-- 2. ผู้จัดการภาคสามคน — ชั้นที่ 2
--    ตามตารางใน DECISIONS-v1.6.0 ข้อ 1 ซึ่งเจ้าของระบบอนุมัติแล้วเมื่อ 4 ส.ค. 2569
UPDATE wf.AppUser SET Role = 'MANAGER', UpdatedAt = GETUTCDATE()
WHERE Username IN ('emp-00021', 'emp-00024', 'emp-00025') AND Role <> 'MANAGER';
GO

-- 3. ฝ่ายบัญชี
UPDATE wf.AppUser SET Role = 'ACCOUNTING', UpdatedAt = GETUTCDATE()
WHERE Username IN ('emp-00012', 'emp-00045') AND Role <> 'ACCOUNTING';
GO

-- 4. บัญชี C_LEVEL ที่เหลือทั้งหมด -> SALES
--    ทำหลังสามข้อบน จึงไม่แตะคนที่เพิ่งตั้งไว้ข้างต้น
UPDATE wf.AppUser SET Role = 'SALES', UpdatedAt = GETUTCDATE()
WHERE Role = 'C_LEVEL'
  AND Username NOT IN ('emp-00016', 'emp-00059');
GO

-- 5. คืนผู้อนุมัติรายภาค — wf.UserSaleArea ว่างเปล่าหลัง restore ฐาน
--    ชั้นที่ 2 ตรวจตารางนี้ก่อนบทบาท ถ้าว่างจะเหลือแต่การตรวจด้วยบทบาทอย่างเดียว
--    ค่าที่ใส่มาจาก DECISIONS-v1.6.0 ข้อ 1 ตารางเดียวกับข้อ 2 ข้างบน
WITH Assign(Username, RegionCode) AS (
    SELECT 'emp-00021', '01' UNION ALL
    SELECT 'emp-00024', '02' UNION ALL
    SELECT 'emp-00025', '03' UNION ALL
    SELECT 'emp-00024', '04' UNION ALL
    SELECT 'emp-00024', '05' UNION ALL
    SELECT 'emp-00024', '06' UNION ALL
    SELECT 'emp-00025', '99'
)
INSERT INTO wf.UserSaleArea (UserId, RegionCode, IsPrimary)
SELECT u.Id, a.RegionCode, 1
FROM Assign a
JOIN wf.AppUser u ON u.Username = a.Username
WHERE NOT EXISTS (
    SELECT 1 FROM wf.UserSaleArea x WHERE x.UserId = u.Id AND x.RegionCode = a.RegionCode
);
GO

PRINT '✓ WF migration 082 complete (roles now match real job titles; regional approvers restored)'
GO
